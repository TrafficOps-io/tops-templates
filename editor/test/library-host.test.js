import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, runHostConformance, readZipProject } from '@trafficops/template-editor-core';
import { createLibraryHost } from '../src/hosts/LibraryHost.js';
import { createStudioProject, validateStudioProject } from '../src/studio-library.js';

const source = '@template "Local"\n@section content "Content"\n@param title String = "Hello"\n@endsection\n@layout\n<h1>{{title}}</h1>\n@endlayout';
function fixture(options = {}) {
  const record = { ...createStudioProject({ kind: 'landing', name: 'Local landing', files: { 'index.tpl': source, 'image.png': new Uint8Array([0, 1, 255]) }, folders: ['empty'], settings: { title: 'Saved title' }, ...options }), revision: 1 };
  const records = new Map([[record.id, structuredClone(record)]]), writes = [];
  let failure;
  const storage = {
    async get(id) { return structuredClone(records.get(id) || null); },
    async save(value, { expectedRevision } = {}) {
      if (failure) { const error = failure; failure = null; throw error; }
      const previous = records.get(value.id);
      if (expectedRevision === null ? previous : previous?.revision !== expectedRevision) throw new ConflictError();
      const saved = validateStudioProject({ ...value, revision: (previous?.revision || 0) + 1 });
      records.set(saved.id, structuredClone(saved)); writes.push(structuredClone(saved));
      return saved;
    },
  };
  return { record, records, writes, storage, fail(error) { failure = error; }, host(overrides = {}) { return createLibraryHost({ record, storage, ...overrides }); } };
}
const ai = { settings: { owner: 'user', load: async () => ({ configured: false, model: '', imageModel: '' }), save: async value => value, remove: async () => {}, test: async () => ({ message: 'OK' }) }, begin: async () => { throw new Error('No provider call should be made.'); }, finish: async () => {} };

test('library host conforms and persists exact text, binary assets, folders and field values', async () => {
  const local = fixture();
  const result = await runHostConformance(() => local.host(), { knownIds: ['safe-html-v1', 'fast-landings-v1'], faults: {
    policy: host => host.lifecycle.run('publish', {}, { locale: 'en' }),
    validation: async host => host.project.save({ ...await host.project.open(), files: { '../outside': 'unsafe' } }),
  } });
  assert.ok(result.checks.includes('concurrency'));
  const host = local.host(), opened = await host.project.open();
  assert.deepEqual(opened.folders, ['empty']);
  assert.deepEqual(opened.translations.en, { title: 'Saved title' });
  assert.equal(opened.status, 'Landing · Saved on this device');
  assert.equal(host.capabilities.autosave, true);
  assert.deepEqual(opened.actions.map(action => action.id), ['save-template']);
  assert.equal('preview' in host, false);
  assert.equal('ai' in host, false);
});

test('fresh opens see another tab and stale saves never recreate deleted records', async () => {
  const local = fixture(), first = local.host(), second = local.host();
  const original = await first.project.open(), other = await second.project.open();
  await second.project.save({ ...other, name: 'Changed in another tab' });
  await assert.rejects(first.project.save({ ...original, name: 'Stale overwrite' }), error => error.code === 'conflict');
  assert.equal((await first.project.open()).name, 'Changed in another tab');
  const latest = await first.project.open();
  local.records.delete(local.record.id);
  await assert.rejects(first.project.save(latest), error => error.code === 'conflict');
  await assert.rejects(first.project.open(), error => error.code === 'policy');
  assert.equal(local.records.size, 0);
});

test('storage failures retain the optimistic revision so edits can be retried', async () => {
  const local = fixture(), host = local.host();
  const original = await host.project.open(), dirty = { ...original, name: 'My retained edits' };
  local.fail(new Error('Browser storage is full.'));
  await assert.rejects(host.project.save(dirty), error => error.code === 'transport' && /storage is full/.test(error.message));
  assert.equal(local.records.get(local.record.id).name, 'Local landing');
  assert.equal((await host.project.save(dirty)).name, dirty.name);
});

test('save as template copies unsaved files, values and binary assets without modifying the landing', async () => {
  const local = fixture({ aiPrompt: 'Initial idea', aiStarted: true }), notices = [], host = local.host({ onSaved: value => notices.push(value) });
  const original = await host.project.open();
  const dirty = { ...original, files: { ...original.files, 'styles.css': 'body { color: green; }' }, translations: { en: { title: 'Unsaved title', group: { enabled: true } } } };
  const result = await host.lifecycle.run('save-template', dirty, { locale: 'en', inputValue: '  Reusable kit  ' });
  const copy = notices[0];
  assert.equal(copy.kind, 'template'); assert.equal(copy.name, 'Reusable kit'); assert.notEqual(copy.id, local.record.id);
  assert.equal(copy.aiPrompt, undefined); assert.equal(copy.aiStarted, undefined);
  assert.deepEqual(copy.folders, ['empty']);
  assert.equal(copy.settings.title, 'Unsaved title');
  assert.equal(result.persisted, false); assert.deepEqual(result.state, dirty);
  assert.deepEqual(local.records.get(local.record.id), local.record);
  dirty.files['image.png'][0] = 128; dirty.translations.en.group.enabled = false;
  assert.deepEqual(local.records.get(copy.id).files['image.png'], new Uint8Array([0, 1, 255]));
  assert.equal(local.records.get(copy.id).settings.group.enabled, true);
  assert.equal(local.records.get(copy.id).files['styles.css'], 'body { color: green; }');
});

test('template copy rejects stale source state, invalid names and template owners', async () => {
  const local = fixture(), host = local.host(), original = await host.project.open();
  for (const name of [undefined, null, 123, '', ' ', 'x'.repeat(201)]) await assert.rejects(host.lifecycle.run('save-template', original, { locale: 'en', inputValue: name }), error => error.code === 'validation');
  await host.project.save(original);
  await assert.rejects(host.lifecycle.run('save-template', original, { locale: 'en', inputValue: 'Stale copy' }), error => error.code === 'conflict');
  assert.equal(local.records.size, 1);
  const template = fixture({ kind: 'template' }), templateHost = template.host();
  const state = await templateHost.project.open();
  assert.equal(state.status, 'Template · Saved on this device'); assert.deepEqual(state.actions, []);
  await assert.rejects(templateHost.lifecycle.run('save-template', state, { locale: 'en', inputValue: 'Another template' }), error => error.code === 'policy');
});

test('source and generated exports reuse Studio compilation and retain selected values', async () => {
  const local = fixture(), host = local.host(), state = await host.project.open();
  const editable = await host.project.export(state, { format: 'source', locale: 'en' });
  const sourceArchive = readZipProject(editable.bytes);
  assert.equal(sourceArchive.files['index.tpl'], source); assert.equal(sourceArchive.settings.title, 'Saved title');
  assert.deepEqual(sourceArchive.folders, ['empty']);
  const generated = await host.project.export(state, { format: 'html', locale: 'en' });
  assert.match(readZipProject(generated.bytes).files['index.html'], /<h1>Saved title<\/h1>/);
});

test('AI request claims once across hosts before generation and keeps the open editor revision valid', async () => {
  const local = fixture({ aiPrompt: 'Make a product landing' }), first = local.host({ ai, autoStart: true }), second = local.host({ ai, autoStart: true });
  const initialStates = await Promise.all([first.project.open(), second.project.open()]);
  const claims = await Promise.all([first.ai.initialRequest.claim(), second.ai.initialRequest.claim()]);
  assert.deepEqual([...claims].sort(), [false, true]);
  const index = claims.findIndex(Boolean), winner = [first, second][index], opened = initialStates[index];
  assert.equal(await winner.ai.initialRequest.claim(), false);
  assert.equal(local.records.get(local.record.id).aiStarted, true);
  assert.equal(local.writes.length, 1);
  const saved = await winner.project.save({ ...opened, files: { ...opened.files, 'styles.css': 'body {}' } });
  assert.equal(saved.revision, 3); assert.equal(saved.files['styles.css'], 'body {}');
  assert.equal(winner.ai.initialRequest.prompt, 'Make a product landing');
});

test('restored projects keep the brief but never restart generation automatically', async () => {
  const local = fixture({ aiPrompt: 'Saved brief' });
  const restored = local.host({ ai });
  assert.equal(restored.ai.initialRequest.autoStart, false); assert.equal(restored.ai.initialRequest.mode, 'edit');
  assert.equal(restored.ai.initialRequest.prompt, 'Saved brief'); assert.equal(await restored.ai.initialRequest.claim(), false);
  const changed = local.host({ ai, autoStart: true }), opened = await changed.project.open();
  await changed.project.save({ ...opened, name: 'Edited before AI started' });
  assert.equal(await changed.ai.initialRequest.claim(), false);
  assert.equal(local.records.get(local.record.id).aiStarted, true);
});

test('AI claim storage errors and cancellation never authorize an initial run', async () => {
  const local = fixture({ aiPrompt: 'Pending brief' }), host = local.host({ ai, autoStart: true });
  local.fail(new Error('Storage unavailable'));
  await assert.rejects(host.ai.initialRequest.claim(), error => error.code === 'transport');
  assert.equal(local.records.get(local.record.id).aiStarted, undefined);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(host.ai.initialRequest.claim({ signal: controller.signal }), error => error.code === 'abort');
  assert.equal(local.writes.length, 0);
  assert.equal(await host.ai.initialRequest.claim(), true);
});

test('view refresh errors cannot report a durable save as failed', async () => {
  const local = fixture(), host = local.host({ onSaved: () => { throw new Error('Unmounted view'); } });
  const state = await host.project.open();
  assert.equal((await host.project.save({ ...state, name: 'Saved anyway' })).name, 'Saved anyway');
  assert.equal(local.records.get(local.record.id).name, 'Saved anyway');
});
