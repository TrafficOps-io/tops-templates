import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, readZipProject } from '@trafficops/template-editor-core';
import { createLibraryHost } from '../src/hosts/LibraryHost.js';
import { createStudioProject, validateStudioProject } from '../src/studio-library.js';
import { validateAiRecovery } from '../src/studio-ai-recovery.js';

const source = '@layout\n<h1>Saved project</h1>\n@endlayout';
const ai = { settings: { owner: 'user', load: async () => ({ configured: false, model: '', imageModel: '' }) }, begin: async () => { throw new Error('No paid calls.'); }, finish: async () => {} };
function fixture() {
  let project = { ...createStudioProject({ kind: 'landing', name: 'Recovery test', files: { 'index.tpl': source }, settings: { title: 'Saved title' }, aiPrompt: 'Create a page' }), revision: 1 }, pending = null, failure = null, deleteFailure = null;
  const storage = { get: async () => structuredClone(project), save: async (next, { expectedRevision }) => {
    if (failure) throw failure;
    if (project.revision !== expectedRevision) throw new ConflictError();
    return project = validateStudioProject({ ...next, revision: project.revision + 1 });
  } };
  const recoveryStorage = { get: async () => structuredClone(pending), save: async next => pending = validateAiRecovery(next), delete: async (_id, { expectedToken }) => {
    if (deleteFailure) throw deleteFailure;
    if (pending && pending.token !== expectedToken) throw new ConflictError(); pending = null;
  } };
  return { host: () => createLibraryHost({ record: project, ai, autoStart: true, storage, recoveryStorage }), read: () => ({ project, pending }), failSave: error => failure = error,
    failDelete: error => deleteFailure = error, replace: value => project = value, setPending: value => pending = value };
}
const draft = { token: 'run', kind: 'create', prompt: 'Full brief', files: { 'index.tpl': '@layout\n<h1>Completed draft</h1>\n@endlayout', 'images/photo.png': new Uint8Array([137, 80, 78, 71, 255]) }, values: { title: 'Completed title' }, valid: true, steps: 52, attachments: [], summary: 'Complete' };

test('claim metadata revision becomes recovery baseline without changing committed project files', async () => {
  const local = fixture(), host = local.host(); await host.project.open();
  assert.equal(await host.ai.initialRequest.claim(), true);
  const saved = await host.ai.recovery.save(draft);
  assert.equal(saved.baseRevision, 2); assert.equal(local.read().project.files['index.tpl'], source);
  const restored = await local.host().ai.recovery.load(); assert.equal(restored.conflict, false); assert.deepEqual(restored.record.files, draft.files);
});

test('applied recovery clears only after a successful durable project save, not at apply or a failed save', async () => {
  const local = fixture(), host = local.host(), state = await host.project.open();
  await host.ai.recovery.save(draft); await host.ai.recovery.applied('run');
  assert.ok(local.read().pending);
  local.failSave(new Error('Quota full'));
  await assert.rejects(host.project.save({ ...state, files: draft.files, translations: { en: draft.values } }), /Quota/);
  assert.ok(local.read().pending); assert.equal(local.read().project.files['index.tpl'], source);
  local.failSave(null); await host.project.save({ ...state, files: draft.files, translations: { en: draft.values } });
  assert.equal(local.read().pending, null); assert.equal(local.read().project.settings.title, 'Completed title');
});

test('stale recovery never overlays saved state and exports complete source plus values until explicit discard', async () => {
  const local = fixture(), host = local.host(), state = await host.project.open(); await host.ai.recovery.save(draft);
  local.replace({ ...local.read().project, revision: 2, files: { 'index.tpl': source + '\n<!-- newer -->' } });
  const fresh = local.host(), loaded = await fresh.ai.recovery.load();
  assert.equal(loaded.conflict, true); assert.match((await fresh.project.open()).files['index.tpl'], /newer/);
  const exported = readZipProject((await fresh.ai.recovery.export('run')).bytes);
  assert.deepEqual({ ...exported.files }, draft.files); assert.deepEqual(exported.settings, draft.values);
  assert.ok(local.read().pending); await fresh.ai.recovery.discard('run'); assert.equal(local.read().pending, null);
  await assert.rejects(host.project.save(state), error => error.code === 'conflict');
});

test('stale token is not overwritten or deleted; clear failures remain visible without misreporting a durable save', async () => {
  const local = fixture(), host = local.host(), state = await host.project.open(), notices = [];
  host.ai.recovery.subscribe(message => notices.push(message)); await host.ai.recovery.save(draft);
  await assert.rejects(host.ai.recovery.save({ ...draft, token: 'other' }), error => error.code === 'conflict');
  await assert.rejects(host.ai.recovery.discard('other'), error => error.code === 'conflict');
  await host.ai.recovery.applied('run'); local.failDelete(new Error('Recovery deletion failed'));
  const saved = await host.project.save({ ...state, files: draft.files }); assert.equal(saved.revision, 2);
  assert.ok(local.read().pending); assert.deepEqual(notices, ['Recovery deletion failed']);
  assert.equal((await local.host().ai.recovery.load()).conflict, true);
});

test('memory-only quota fallback exports source without writing either store', async () => {
  const local = fixture(), host = local.host(); const exported = readZipProject((await host.ai.recovery.download(draft)).bytes);
  assert.deepEqual({ ...exported.files }, draft.files); assert.deepEqual(exported.settings, draft.values);
  assert.equal(local.read().pending, null); assert.equal(local.read().project.files['index.tpl'], source);
});
