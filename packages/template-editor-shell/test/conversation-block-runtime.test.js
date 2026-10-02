import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationSession } from '../src/conversation-runtime.js';
import { createBlockEditScope, blockScopeFiles } from '../src/block-edit-scope.js';

async function until(predicate) {
  for (let count = 0; count < 200; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Timed out waiting for scoped conversation state');
}
function fixture(projectId = crypto.randomUUID(), initial) {
  const fragment = '<section data-block="Hero"><h1>{{title}}</h1></section>', rawValues = { retired: 'Raw key stays' };
  const state = { name: 'Landing', revision: 3, files: { 'index.tpl': `${fragment}\n<aside>{{shared}}</aside>` }, folders: [], entrypoint: 'index.html', locale: 'en', translations: { en: rawValues, de: { title: 'Deutsch', shared: 'Deutsch shared' } } };
  const scope = createBlockEditScope({ version: 1, page: 'index.html', locale: 'en', blockSources: [{ id: 'hero', path: 'index.tpl', start: 0, end: fragment.length, content: fragment }],
    blockInstances: [{ id: 'hero-1', sourceId: 'hero', page: 'index.html', valuePaths: [['title']] }],
    valueUses: [{ path: ['title'], instanceIds: ['hero-1'], page: 'index.html' }, { path: ['shared'], instanceIds: [], page: 'index.html' }], selectedInstanceIds: ['hero-1'] },
  { files: state.files, rawValues, values: { ...rawValues, title: 'Original', shared: 'Keep' } });
  let document = initial || { schema: 1, projectId, revision: 0, legacyMigrated: true, threads: [], runs: [] };
  const subscribers = new Set(), saved = [], calls = [];
  const host = { conversations: { projectId, load: async () => structuredClone(document), save: async (next, { expectedRevision }) => {
    assert.equal(expectedRevision, document.revision); document = structuredClone({ ...next, revision: document.revision + 1 }); saved.push(document);
    for (const subscriber of subscribers) subscriber(structuredClone(document)); return structuredClone(document);
  }, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); } },
  project: { open: async () => structuredClone(state) }, analyzer: { analyze: async snapshot => ({ definition: { sections: [{ id: 'content', fields: [{ name: 'title', type: 'text', default: 'Original' }, { name: 'shared', type: 'text', default: 'Keep' }] }] }, entrypoint: 'index.html', sourceDiagnostics: snapshot.files['index.tpl'].includes('BADTPL') ? [{ message: 'Invalid TPL' }] : [], diagnostics: [] }), render: async snapshot => snapshot.files },
  ai: { begin: async options => { calls.push(options); return { model: 'mock', apiKey: 'unused' }; }, finish: async () => {} } };
  return { host, state, scope, rawValues, saved, calls, read: () => structuredClone(document) };
}
const workflows = block => ({ block, project: () => assert.fail('Scoped continuation must never use the project workflow'), file: () => assert.fail(), discussion: () => assert.fail(), intent: () => assert.fail() });

test('scoped conversations pass effective and raw values separately and persist fixed intent in every completed snapshot', async t => {
  const local = fixture(); let input;
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: workflows(async options => {
    input = options;
    assert.deepEqual(options.rawValues, local.rawValues); assert.equal(options.values.title, 'Original'); assert.equal(options.values.shared, 'Keep');
    assert.match(options.takeInstructions()[0], /Earlier messages/); assert.deepEqual(options.takeInstructions(), []);
    const editScope = { ...options.editScope, intent: 'source' }, files = blockScopeFiles(editScope, { hero: options.editScope.blockSources[0].content.replace('<section ', '<section style="padding: 10px" ') });
    options.onProgress({ type: 'scope', editScope }); options.onProgress({ type: 'file-set', files, values: options.rawValues, editScope });
    return { files, values: options.rawValues, editScope, valid: true, summary: 'Hero updated' };
  }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Increase hero padding', scope: { kind: 'block', editScope: local.scope }, snapshot: local.state, generateImages: true });
  await until(() => session.getSnapshot().runs[0]?.state === 'ready');
  const run = session.getSnapshot().runs[0];
  assert.equal(input.mode, 'edit'); assert.equal(input.generateImages, false);
  assert.equal(run.scope.editScope.intent, 'source'); assert.equal(run.checkpoint.editScope.intent, 'source'); assert.equal(run.result.editScope.intent, 'source');
  assert.deepEqual(run.result.values, local.rawValues); assert.deepEqual(run.base.translations.en, local.rawValues);
  assert.ok(local.saved.some(doc => doc.runs[0]?.scope.editScope.intent === 'source' && !doc.runs[0].checkpoint));
});

test('cancelled checkpoints reload and clarification continuation preserve content intent, raw defaults and original locale', async t => {
  const local = fixture(); let firstOptions;
  const first = createConversationSession(local.host, { locks: null, sessionId: 'first', workflows: workflows(options => {
    firstOptions = options; const editScope = { ...options.editScope, intent: 'content' };
    options.onProgress({ type: 'scope', editScope }); options.onProgress({ type: 'values-set', files: options.files, values: { ...options.rawValues, title: 'Changed selected' }, editScope });
    return new Promise(() => {});
  }) }); t.after(() => first.dispose()); await first.ready;
  await first.submit({ prompt: 'Change hero copy', scope: { kind: 'block', editScope: local.scope }, snapshot: local.state });
  await until(() => local.read().runs[0]?.checkpoint?.values.title === 'Changed selected'); await first.stop(first.getSnapshot().runs[0].id);
  await until(() => first.getSnapshot().runs[0].state === 'cancelled'); assert.equal(firstOptions.signal.aborted, true); first.dispose();
  const resumed = createConversationSession(local.host, { locks: null, sessionId: 'restored', workflows: workflows(async options => {
    assert.equal(options.editScope.intent, 'content'); assert.equal(options.rawValues.title, 'Changed selected');
    assert.equal(options.editScope.locale, 'en'); assert.equal(options.editScope.baselineRawValues.title, undefined);
    return { files: local.state.files, values: options.values, editScope: options.editScope, valid: false, needsClarification: true, clarification: 'Which copy should replace the selected hero?' };
  }) }); t.after(() => resumed.dispose()); await resumed.ready; assert.equal(local.calls.length, 1);
  await resumed.continue(resumed.getSnapshot().runs[0].id, { prompt: 'Explain the requested copy', snapshot: { ...local.state, locale: 'de' }, locale: 'de' });
  await until(() => resumed.getSnapshot().runs[1]?.state === 'failed');
  const run = resumed.getSnapshot().runs[1]; assert.equal(run.locale, 'en'); assert.equal(run.scope.editScope.intent, 'content'); assert.equal(run.result.needsClarification, true);
  assert.deepEqual(run.result.values, { ...local.rawValues, title: 'Changed selected' }); assert.match(run.result.summary, /Which copy/);
  assert.equal(run.result.editScope.intent, 'content'); assert.equal(run.result.values.shared, undefined);
});

test('malicious checkpoint and final scope widening never enter saved conversation drafts', async t => {
  for (const operation of ['checkpoint', 'intent', 'result', 'invalid-tpl']) {
    const local = fixture(); const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: workflows(async options => {
      const editScope = { ...options.editScope, intent: operation === 'invalid-tpl' ? 'source' : 'content' }; options.onProgress({ type: 'scope', editScope });
      if (operation === 'intent') options.onProgress({ type: 'scope', editScope: { ...editScope, intent: 'source' } });
      if (operation === 'checkpoint') options.onProgress({ type: 'file-set', files: { 'index.tpl': options.files['index.tpl'].replace('<aside>', '<aside class="bad">') }, values: options.rawValues, editScope });
      if (operation === 'invalid-tpl') return { files: { 'index.tpl': options.files['index.tpl'].replace('<h1>', '<h1>BADTPL') }, values: options.rawValues, valid: true, editScope };
      return { files: options.files, values: { ...options.rawValues, shared: 'Bad' }, valid: true, editScope };
    }) }); t.after(() => session.dispose()); await session.ready;
    await session.submit({ prompt: 'Update only selected hero', scope: { kind: 'block', editScope: local.scope }, snapshot: local.state });
    await until(() => session.getSnapshot().runs[0]?.state === 'failed'); const run = session.getSnapshot().runs[0];
    assert.equal(run.checkpoint, undefined); assert.equal(run.result, undefined); assert.equal(run.scope.editScope.intent, operation === 'invalid-tpl' ? 'source' : 'content');
    if (operation === 'invalid-tpl') assert.match(run.error, /Invalid TPL/);
    assert.ok(local.saved.every(doc => !doc.runs[0]?.checkpoint && !doc.runs[0]?.result)); session.dispose();
  }
});

test('tampered scoped recovery is rejected before any draft is published', async t => {
  const local = fixture(), scope = { ...local.scope, intent: 'content' }, run = { id: 'saved-run', threadId: 'saved-thread', messageId: 'saved-message', state: 'ready', locale: 'en', base: local.state, scope: { kind: 'block', editScope: scope }, result: { files: local.state.files, values: { ...local.rawValues, shared: 'Bad' }, valid: true, editScope: scope } };
  local.host.conversations.load = async () => ({ schema: 1, projectId: local.host.conversations.projectId, revision: 1, legacyMigrated: true, threads: [{ id: 'saved-thread', messages: [] }], runs: [run] });
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: workflows(() => assert.fail()) }); t.after(() => session.dispose());
  await assert.rejects(session.ready, /Unselected field/); assert.deepEqual(session.getSnapshot().runs, []); assert.equal(local.calls.length, 0);
});
