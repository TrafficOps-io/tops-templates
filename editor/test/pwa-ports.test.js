import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyError, readZipProject } from '@trafficops/template-editor-core';
import { createStudioAiPort } from '../src/hosts/StudioAiPort.js';
import { createStudioHost } from '../src/hosts/StudioHost.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const connection = { apiKey: 'user-owned-test-key', model: 'model', imageModel: '' };
const source = '@layout\n<h1>Local project</h1>\n@endlayout';
const aiDenied = error => error instanceof PolicyError && error.code === 'policy' && error.message === 'AI is available only in the installed Studio app.';
const folderDenied = error => error instanceof PolicyError && error.code === 'policy' && /installed Studio app/.test(error.message);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function aiSpies(isEnabled) {
  const calls = [];
  const storage = {
    load: async () => { calls.push('load'); return connection; },
    save: async value => { calls.push('save'); return value; },
    remove: async () => { calls.push('remove'); },
  };
  const fetchImpl = async () => { calls.push('fetch'); return Response.json({}); };
  return { calls, ai: createStudioAiPort({ storage, fetchImpl, isEnabled }) };
}

function folderSpies() {
  const directory = new MemoryDirectoryHandle('Campaign', { 'index.tpl': source });
  const calls = [];
  for (const method of ['values', 'getDirectoryHandle', 'getFileHandle', 'removeEntry']) {
    const original = directory[method];
    directory[method] = function (...args) { calls.push(method); return original.apply(this, args); };
  }
  const file = directory.entries.get('index.tpl');
  for (const method of ['getFile', 'createWritable']) {
    const original = file[method];
    file[method] = function (...args) { calls.push(method); return original.apply(this, args); };
  }
  return { directory, calls };
}

test('browser-mode AI rejects every operation before storage or network access', async () => {
  const { ai, calls } = aiSpies(() => false);
  for (const operation of [
    () => ai.settings.load(),
    () => ai.settings.save(connection),
    () => ai.settings.remove(),
    () => ai.settings.test(),
    () => ai.begin(),
  ]) await assert.rejects(operation, aiDenied);
  await ai.finish();
  assert.deepEqual(calls, []);
});

test('installed-mode AI works and retained connections stop transport after mode revocation', async () => {
  let enabled = true;
  const { ai, calls } = aiSpies(() => enabled);
  assert.equal((await ai.settings.load()).configured, true);
  await ai.settings.save(connection);
  await ai.settings.test();
  const retained = await ai.begin();
  await retained.fetchImpl('https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(calls, ['load', 'save', 'load', 'fetch', 'load', 'fetch']);
  enabled = false;
  await assert.rejects(retained.fetchImpl('https://openrouter.ai/api/v1/chat/completions'), aiDenied);
  await assert.rejects(ai.settings.remove(), aiDenied);
  await assert.rejects(ai.begin(), aiDenied);
  assert.equal(calls.length, 6);
  await ai.finish();
  enabled = true;
  await ai.begin();
  await ai.finish();
  await ai.settings.remove();
  assert.deepEqual(calls.slice(6), ['load', 'remove']);
});

for (const operation of ['load', 'save', 'test', 'begin']) {
  test(`AI ${operation} rechecks installed mode after awaiting storage`, async () => {
    let enabled = true, fetches = 0;
    const pending = deferred();
    const ai = createStudioAiPort({
      isEnabled: () => enabled,
      storage: { load: () => pending.promise, save: () => pending.promise, remove: async () => {} },
      fetchImpl: async () => { fetches++; return Response.json({}); },
    });
    const result = operation === 'begin' ? ai.begin() : ai.settings[operation](operation === 'save' ? connection : undefined);
    enabled = false;
    pending.resolve(connection);
    await assert.rejects(result, aiDenied);
    assert.equal(fetches, 0);
    await ai.finish();
  });
}

test('browser-mode folder host rejects open and save without touching the handle', async () => {
  const { directory, calls } = folderSpies();
  const host = createStudioHost({ directory, isDirectoryEnabled: () => false });
  await assert.rejects(host.project.open(), folderDenied);
  await assert.rejects(host.project.save({}), folderDenied);
  assert.deepEqual(calls, []);
});

test('cached folder sessions cannot reopen or save after revocation but can export memory', async () => {
  let enabled = true;
  const { directory, calls } = folderSpies();
  const host = createStudioHost({ directory, isDirectoryEnabled: () => enabled });
  const state = await host.project.open();
  const callCount = calls.length;
  enabled = false;
  await assert.rejects(host.project.open(), folderDenied);
  await assert.rejects(host.project.save({ ...state, files: { 'index.tpl': source.replace('Local', 'Updated') } }), folderDenied);
  const exported = await host.project.export(state, { format: 'source', locale: 'en' });
  assert.equal(readZipProject(exported.bytes).files['index.tpl'], source);
  const rendered = await host.project.export(state, { format: 'html', locale: 'en' });
  assert.match(readZipProject(rendered.bytes).files['index.html'], /<h1>Local project<\/h1>/);
  assert.equal(calls.length, callCount);
});

test('folder saves recheck installed mode after an asynchronous settings read', async () => {
  let enabled = true;
  const { directory, calls } = folderSpies();
  const host = createStudioHost({ directory, isDirectoryEnabled: () => enabled });
  const state = await host.project.open();
  const original = directory.getDirectoryHandle;
  directory.getDirectoryHandle = async function (...args) { enabled = false; return original.apply(this, args); };
  const callCount = calls.length;
  await assert.rejects(host.project.save({ ...state, files: { 'index.tpl': source.replace('Local', 'Updated') } }), folderDenied);
  assert.deepEqual(calls.slice(callCount), ['getDirectoryHandle']);
  assert.equal(new TextDecoder().decode(directory.entries.get('index.tpl').value), source);
});

test('queued folder saves recheck installed mode after the preceding save settles', async () => {
  let enabled = true;
  const { directory, calls } = folderSpies();
  const enteredRecovery = deferred(), releaseRecovery = deferred();
  const host = createStudioHost({ directory, isDirectoryEnabled: () => enabled, recovery: async () => {
    enteredRecovery.resolve();
    await releaseRecovery.promise;
  } });
  const state = await host.project.open();
  const first = host.project.save(state);
  await enteredRecovery.promise;
  const queued = host.project.save({ ...state, revision: state.revision + 1 });
  const callCount = calls.length;
  enabled = false;
  releaseRecovery.resolve();
  await first;
  await assert.rejects(queued, folderDenied);
  assert.equal(calls.length, callCount);
});

test('browser-mode memory projects retain open, save, import and ZIP export', async () => {
  const host = createStudioHost({ isDirectoryEnabled: () => false, initial: { files: { 'index.tpl': source }, folders: [] } });
  const state = await host.project.open();
  const saved = await host.project.save({ ...state, name: 'Browser project' });
  const exported = await host.project.export(saved, { format: 'source', locale: 'en' });
  assert.equal(exported.name, 'Browser project-source.zip');
  assert.equal((await host.project.import(exported.bytes)).files['index.tpl'], source);
});
