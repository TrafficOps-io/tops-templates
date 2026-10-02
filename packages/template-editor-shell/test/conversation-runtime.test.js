import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryConversationStore, createStoreConversationPort, validateConversationDocument } from '@trafficops/template-editor-core';
import { generateEditorPreview, parseProject } from '@trafficops/template-runtime';
import { inputValues } from '@trafficops/template-editor-core';
import { createConversationSession } from '../src/conversation-runtime.js';

const state = () => ({ name: 'Landing', revision: 3, files: { 'index.html': '<h1>Old</h1>', 'style.css': 'red' }, folders: [], entrypoint: 'index.html', locale: 'en', translations: { en: { title: 'Old' } } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(predicate) { for (let count = 0; count < 200; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Timed out waiting for runtime state'); }
function fixture(projectId = 'project', initial) {
  let document = initial || { schema: 1, projectId, revision: 0, legacyMigrated: true, threads: [], runs: [] };
  const subscribers = new Set(), connections = [], saved = [];
  const conversations = { projectId, load: async () => structuredClone(document), save: async (next, { expectedRevision }) => {
    if (expectedRevision !== document.revision) throw Object.assign(new Error('Concurrent write'), { code: 'conflict' });
    document = validateConversationDocument({ ...next, revision: document.revision + 1 }); saved.push(document);
    for (const subscriber of subscribers) subscriber(structuredClone(document)); return structuredClone(document);
  }, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); } };
  const host = { conversations, project: { open: async () => state() }, analyzer: {
    analyze: async snapshot => ({ definition: { name: snapshot.name, sections: [{ id: 'content', fields: [{ name: 'title', type: 'String' }] }] }, entrypoint: 'index.html', sourceDiagnostics: [], diagnostics: [] }), render: async snapshot => snapshot.files,
  }, ai: { begin: async options => { assert.ok(document.threads.some(thread => thread.messages.length)); connections.push(options.runId); return { apiKey: 'secret-never-persist', model: 'test/model', imageModel: '' }; }, finish: async () => {} } };
  return { host, saved, connections, read: () => structuredClone(document) };
}
const basicWorkflows = project => ({ intent: async () => ({ intent: 'source' }), project, file: project, block: project, discussion: async options => ({ files: options.files, values: options.values, valid: true, discussion: true, summary: 'Explanation only.' }) });

test('two runs execute independently, cancellation is addressed, and messages precede paid connections', async t => {
  const local = fixture(), calls = [], pending = [];
  const workflows = basicWorkflows(options => { calls.push(options); const wait = deferred(); pending.push(wait); return wait.promise; });
  const session = createConversationSession(local.host, { workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose()); await session.ready;
  const first = await session.submit({ prompt: 'Change styles', snapshot: state() }), second = await session.submit({ prompt: 'Change title', snapshot: state() });
  await until(() => calls.length === 2);
  const doc = session.getSnapshot(), a = doc.runs.find(run => run.threadId === first), b = doc.runs.find(run => run.threadId === second);
  assert.deepEqual(new Set(local.connections), new Set([a.id, b.id]));
  await session.stop(b.id); await until(() => session.getSnapshot().runs.find(run => run.id === b.id).state === 'cancelled');
  assert.equal(calls[0].signal.aborted, false); assert.equal(calls[1].signal.aborted, true);
  pending[0].resolve({ files: { ...calls[0].files, 'style.css': 'blue' }, values: calls[0].values, valid: true, summary: 'Styles updated' });
  await until(() => session.getSnapshot().runs.find(run => run.id === a.id).state === 'ready');
  pending[1].resolve({ files: { ...calls[1].files, 'style.css': 'late' }, values: calls[1].values, valid: true });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(session.getSnapshot().runs.find(run => run.id === b.id).result, undefined);
  assert.equal(JSON.stringify(local.read()).includes('secret-never-persist'), false);
});

test('the app-wide scheduler admits two runs and the same thread receives bounded steering', async t => {
  const local = fixture('queue'), calls = [], pending = [], session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(options => { calls.push(options); const wait = deferred(); pending.push(wait); return wait.promise; }) });
  t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'First', snapshot: state() });
  await session.submit({ prompt: 'Second', snapshot: state() }); await session.submit({ prompt: 'Third', snapshot: state() });
  await until(() => calls.length === 2);
  await session.submit({ threadId, prompt: 'Keep header', snapshot: state() });
  assert.equal(session.getSnapshot().runs.length, 3); assert.deepEqual(calls[0].takeInstructions(), ['Keep header']); assert.deepEqual(calls[0].takeInstructions(), []);
  assert.equal(session.getSnapshot().runs.filter(run => run.state === 'queued').length, 1);
  pending[0].resolve({ files: calls[0].files, values: calls[0].values, valid: true }); await until(() => calls.length === 3);
  for (let index = 1; index < pending.length; index++) pending[index].resolve({ files: calls[index].files, values: calls[index].values, valid: true });
  await until(() => session.getSnapshot().runs.every(run => run.state === 'ready'));
});

test('completed checkpoints survive cancellation and reload never repeats provider calls', async t => {
  const local = fixture('recovery'), waiting = deferred(); let options;
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async value => { options = value; value.onProgress({ type: 'file-set', path: 'style.css', files: { ...value.files, 'style.css': 'blue' }, values: value.values }); await waiting.promise; }) });
  t.after(() => session.dispose()); await session.ready; await session.submit({ prompt: 'Edit', snapshot: state() });
  await until(() => local.read().runs[0]?.checkpoint?.files['style.css'] === 'blue');
  await session.stop(session.getSnapshot().runs[0].id); await until(() => session.getSnapshot().runs[0].state === 'cancelled');
  assert.equal(session.getSnapshot().runs[0].result.files['style.css'], 'blue'); waiting.resolve(); assert.equal(options.signal.aborted, true);
  const restored = createConversationSession(local.host, { locks: null, sessionId: 'new-owner', workflows: basicWorkflows(() => assert.fail('Reload must not issue a provider call')) }); t.after(() => restored.dispose()); await restored.ready;
  assert.equal(restored.getSnapshot().runs[0].result.files['style.css'], 'blue'); assert.equal(local.connections.length, 1);
});

test('orphan recovery and ownership fencing reject late results', async t => {
  const local = fixture('fence'), pending = deferred(), session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => pending.promise) });
  t.after(() => session.dispose()); await session.ready; await session.submit({ prompt: 'Edit', snapshot: state() }); await until(() => local.connections.length === 1);
  const replacement = local.read(); replacement.runs[0].owner = { sessionId: 'other', fence: 50, expiresAt: 0 };
  await local.host.conversations.save(replacement, { expectedRevision: replacement.revision });
  const restored = createConversationSession(local.host, { locks: null, sessionId: 'new-owner', workflows: basicWorkflows(() => assert.fail('An orphan must not execute again')) }); t.after(() => restored.dispose()); await restored.ready;
  assert.equal(restored.getSnapshot().runs[0].state, 'interrupted'); pending.resolve({ files: state().files, values: {}, valid: true });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(local.read().runs[0].state, 'interrupted'); assert.equal(local.read().runs[0].result, undefined);
});

test('validator snapshots, follow-up context and host rebinding stay attached to the original project', async t => {
  const local = fixture('binding'), calls = [], waits = [], session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(options => { calls.push(options); const wait = deferred(); waits.push(wait); return wait.promise; }) });
  t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit', snapshot: state(), mentions: ['index.html'] }); await until(() => calls.length === 1);
  const nextHost = { ...local.host, project: { open: async () => ({ ...state(), locale: 'de', translations: { de: { title: 'Other' } } }) } };
  let bindingWrites = 0; nextHost.conversations = { ...local.host.conversations, save: async (...args) => { bindingWrites++; return local.host.conversations.save(...args); } }; session.updateHost(nextHost);
  const checked = await calls[0].validateDraft({ files: state().files, values: { title: 'New' }, mode: 'edit' }); assert.equal(checked.values.title, 'New');
  calls[0].onProgress({ type: 'file-set', files: { ...state().files, 'style.css': 'blue' }, values: { title: 'New' } });
  waits[0].resolve({ files: { ...state().files, 'style.css': 'blue' }, values: { title: 'New' }, valid: true, summary: 'Done' }); await until(() => session.getSnapshot().runs[0].state === 'ready');
  assert.ok(bindingWrites > 0);
  await session.submit({ threadId, prompt: 'Also change title', snapshot: state() }); await until(() => calls.length === 2);
  assert.equal(calls[1].files['style.css'], 'blue'); assert.match(calls[1].conversationContext, /Edit/); assert.match(calls[1].conversationContext, /Done/);
  assert.equal(session.getSnapshot().runs[1].base.files['style.css'], 'red'); waits[1].resolve({ files: calls[1].files, values: calls[1].values, valid: true });
  await until(() => session.getSnapshot().runs[1].state === 'ready');
});

test('discussion has no draft apply and applied markers reconcile after a crash', async t => {
  const local = fixture('discussion'), session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail('Discussion must not edit')) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Explain the layout', scope: { kind: 'discussion' }, snapshot: state() }); await until(() => session.getSnapshot().runs[0].state === 'completed');
  assert.equal(session.getSnapshot().runs[0].result.discussion, true); assert.deepEqual(session.getSnapshot().runs[0].changeset.operations, []);
  await session.reconcileApplied([session.getSnapshot().runs[0].id]); assert.equal(session.getSnapshot().runs[0].state, 'applied');
});

test('unsupported source references fail before any provider call', async t => {
  const local = fixture('references'), session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail()) }); t.after(() => session.dispose()); await session.ready;
  await assert.rejects(session.submit({ prompt: 'Edit', snapshot: state(), attachments: [{ id: 'pdf', name: 'ref.pdf', mime: 'application/pdf', dataUrl: `data:application/pdf;base64,${btoa('%PDF-1.4 reference')}` }] }), /PDF references/);
  assert.equal(local.connections.length, 0); assert.equal(local.read().threads.length, 0);
});

test('explicit rebase keeps current overlapping source, retains independent completed work and uses a new comparison baseline', async t => {
  const local = fixture('rebase'), calls = [], waits = [];
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(options => { calls.push(options); const wait = deferred(); waits.push(wait); return wait.promise; }) });
  t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Improve headline and styles', snapshot: state() }); await until(() => calls.length === 1);
  waits[0].resolve({ files: { ...state().files, 'index.html': '<h1>Proposed</h1>', 'style.css': 'blue', 'generated.png': new Uint8Array([1, 2, 3]) }, values: calls[0].values, valid: true, summary: 'Proposed headline and styles' });
  await until(() => session.getSnapshot().runs[0].state === 'ready');
  const current = state(); current.revision = 4; current.files['index.html'] = '<h1>Manual</h1>';
  await session.continue(session.getSnapshot().runs[0].id, { snapshot: current, rebase: true }); await until(() => calls.length === 2);
  const run = session.getSnapshot().runs[1];
  assert.equal(run.base.revision, 4); assert.equal(run.base.files['index.html'], '<h1>Manual</h1>'); assert.equal(run.base.files['style.css'], 'red');
  assert.equal(calls[1].files['index.html'], '<h1>Manual</h1>'); assert.equal(calls[1].files['style.css'], 'blue'); assert.deepEqual(calls[1].files['generated.png'], new Uint8Array([1, 2, 3]));
  assert.match(calls[1].conversationContext, /Full original request/); assert.match(calls[1].conversationContext, /Proposed/);
  waits[1].resolve({ files: { ...calls[1].files, 'index.html': '<h1>Manual improved</h1>' }, values: calls[1].values, valid: true }); await until(() => session.getSnapshot().runs[1].state === 'ready');
  const merged = (await import('../src/conversation-changes.js')).mergeChangeSet({ base: run.base, proposal: session.getSnapshot().runs[1].result, current });
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.state.files['index.html'], '<h1>Manual improved</h1>');
});

test('explicit single-file follow-up does not silently inherit a previous project draft scope', async t => {
  const local = fixture('scopes'), calls = [], waits = [];
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(options => { calls.push(options); const wait = deferred(); waits.push(wait); return wait.promise; }) });
  t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Change styles', snapshot: state() }); await until(() => calls.length === 1);
  waits[0].resolve({ files: { ...state().files, 'style.css': 'blue' }, values: calls[0].values, valid: true }); await until(() => session.getSnapshot().runs[0].state === 'ready');
  await session.submit({ threadId, prompt: 'Edit only headline', scope: { kind: 'file', path: 'index.html' }, snapshot: state() }); await until(() => calls.length === 2);
  assert.equal(calls[1].path, 'index.html'); assert.equal(calls[1].files['style.css'], 'red'); assert.equal(session.getSnapshot().runs[1].scope.kind, 'file');
  waits[1].resolve({ files: calls[1].files, values: calls[1].values, valid: true }); await until(() => session.getSnapshot().runs[1].state === 'ready');
});

test('deleting a finished dialog frees its bounded run payload and refuses an active dialog', async t => {
  const local = fixture('delete'), wait = deferred();
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => wait.promise) }); t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit', snapshot: state() }); await until(() => local.connections.length === 1);
  await assert.rejects(session.deleteThread(threadId), /Stop/);
  const runId = session.getSnapshot().runs[0].id; await session.stop(runId); await until(() => session.getSnapshot().runs[0].state === 'cancelled');
  await session.deleteThread(threadId); assert.deepEqual(local.read().threads, []); assert.deepEqual(local.read().runs, []); wait.resolve();
  await session.submit({ prompt: 'Another edit', snapshot: state() }); await until(() => session.getSnapshot().runs[0]?.state === 'failed');
  assert.equal(session.getSnapshot().threads.length, 1);
});

test('source-only generation strips effective defaults and preserves a later manual field edit', async t => {
  const local = fixture('defaults'), snapshot = state(); snapshot.translations.en = {};
  local.host.analyzer.analyze = async () => ({ definition: { sections: [{ id: 'content', fields: [{ name: 'title', type: 'String', default: 'Default title' }] }] }, entrypoint: 'index.html', sourceDiagnostics: [], diagnostics: [] });
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    options.onProgress({ type: 'file-set', files: { ...options.files, 'style.css': 'blue' }, values: { title: 'Default title' } });
    return { files: { ...options.files, 'style.css': 'blue' }, values: { title: 'Default title' }, valid: true };
  }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Only change stylesheet', snapshot }); await until(() => session.getSnapshot().runs[0].state === 'ready');
  const run = session.getSnapshot().runs[0]; assert.deepEqual(run.result.values, {}); assert.deepEqual(run.checkpoint.values, {});
  const current = structuredClone(snapshot); current.translations.en.title = 'Manual';
  const merged = (await import('../src/conversation-changes.js')).mergeChangeSet({ base: run.base, proposal: run.result, current });
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.state.translations.en.title, 'Manual'); assert.equal(merged.requiresContextReview, true);
});

test('opening a project without legacy data does not write conversation metadata', async t => {
  const local = fixture('untouched-folder', { schema: 1, projectId: 'untouched-folder', revision: 0, threads: [], runs: [] });
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail()) });
  t.after(() => session.dispose()); await session.ready;
  assert.equal(local.saved.length, 0); assert.equal(session.getSnapshot().revision, 0);
});

test('mentioned project images reach vision without creating a duplicate project asset', async t => {
  const local = fixture('vision'), calls = [], snapshot = state();
  const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg=='), character => character.charCodeAt(0));
  snapshot.files['images/logo.png'] = image;
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    calls.push(options); return { files: options.files, values: options.values, valid: true, summary: 'Viewed project image' };
  }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Explain this image', snapshot, mentions: ['images/logo.png'], mode: 'create' });
  await until(() => session.getSnapshot().runs[0].state === 'ready');
  assert.equal(calls[0].attachments.length, 1); assert.equal(calls[0].attachments[0].mime, 'image/png'); assert.equal(calls[0].attachments[0].name, 'images/logo.png'); assert.equal(calls[0].attachments[0].useOnPage, false);
  assert.deepEqual(Uint8Array.from(atob(calls[0].attachments[0].dataUrl.split(',')[1]), character => character.charCodeAt(0)), image);
  assert.equal(session.getSnapshot().threads[0].messages[0].attachments.length, 0, 'the existing asset is stored once as a mention');
  assert.deepEqual(session.getSnapshot().runs[0].changeset.operations, []);
  await session.continue(session.getSnapshot().runs[0].id); await until(() => calls.length === 2);
  assert.equal(calls[1].attachments.length, 1); assert.equal(calls[1].attachments[0].useOnPage, false);
  await until(() => session.getSnapshot().runs[1].state === 'ready');
});

test('binary mentions are validated and share the reference limit before a paid connection', async t => {
  const local = fixture('vision-limits'), snapshot = state(); snapshot.files['font.woff'] = new Uint8Array([1, 2]);
  const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg=='), character => character.charCodeAt(0));
  for (let index = 0; index < 5; index++) snapshot.files[`image${index}.png`] = image;
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail()) }); t.after(() => session.dispose()); await session.ready;
  await assert.rejects(session.submit({ prompt: 'Explain font', snapshot, mentions: ['font.woff'] }), /supported reference/);
  await assert.rejects(session.submit({ prompt: 'Explain images', snapshot, mentions: [0, 1, 2, 3, 4].map(index => `image${index}.png`) }), /up to 4/);
  assert.equal(local.connections.length, 0); assert.equal(local.saved.length, 0);
});

test('an initial creation without optional image settings persists its brief before missing credentials', async t => {
  const local = fixture('initial-no-key', { schema: 1, projectId: 'initial-no-key', revision: 0, threads: [], runs: [] }); let claimed = false;
  local.host.ai.initialRequest = { id: 'initial', prompt: 'Create a ceramics landing', mode: 'create', autoStart: true, claim: async () => { claimed = true; return true; } };
  local.host.ai.begin = async () => { assert.equal(claimed, true); throw new Error('Connect your API key.'); };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail()) }); t.after(() => session.dispose()); await session.ready;
  await until(() => session.getSnapshot().runs[0]?.state === 'failed');
  const saved = validateConversationDocument(local.read());
  assert.equal(saved.threads[0].messages[0].prompt, 'Create a ceramics landing'); assert.match(saved.runs[0].error, /API key/);
  assert.equal(Object.hasOwn(saved.runs[0], 'generateImages'), false);
});

test('changed explicitly mentioned text and image context requires review for project and file scopes', async t => {
  const local = fixture('reference-read-set'), snapshot = state();
  snapshot.files['logo.png'] = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg=='), character => character.charCodeAt(0));
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => ({ files: { ...options.files, 'index.html': '<h1>Improved</h1>' }, values: options.values, valid: true })) }); t.after(() => session.dispose()); await session.ready;
  const merge = (await import('../src/conversation-changes.js')).mergeChangeSet;
  for (const scope of [{ kind: 'project' }, { kind: 'file', path: 'index.html' }]) {
    await session.submit({ prompt: 'Use referenced styles and logo', snapshot, scope, mentions: ['style.css', 'logo.png'] });
    await until(() => session.getSnapshot().runs.at(-1).state === 'ready'); const run = session.getSnapshot().runs.at(-1);
    const current = structuredClone(snapshot); current.files['logo.png'][0] ^= 1; current.files['style.css'] = 'manual style';
    const merged = merge({ base: run.base, proposal: run.result, current });
    assert.deepEqual(merged.conflicts, []); assert.equal(merged.requiresContextReview, true);
    assert.ok(merged.staleReadSet.some(reference => reference.path === 'logo.png')); assert.ok(merged.staleReadSet.some(reference => reference.path === 'style.css'));
    await session.continue(run.id); await until(() => session.getSnapshot().runs.at(-1).state === 'ready');
    assert.ok(session.getSnapshot().runs.at(-1).result.readSet.some(reference => reference.path === 'logo.png'), 'continuing preserves dependencies on the original frozen image');
  }
});

test('single-file image mentions do not duplicate the immutable primary image or consume an extra reference slot', async t => {
  const local = fixture('primary-image'), snapshot = state(), calls = [];
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
  snapshot.files['logo.png'] = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const attachments = [0, 1, 2, 3].map(index => ({ id: `reference-${index}`, name: `reference-${index}.png`, mime: 'image/png', dataUrl: `data:image/png;base64,${encoded}` }));
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => { calls.push(options); return { files: options.files, values: options.values, valid: true }; }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Edit image', scope: { kind: 'file', path: 'logo.png' }, snapshot, mentions: ['logo.png'], attachments });
  await until(() => session.getSnapshot().runs[0]?.state === 'ready');
  assert.equal(calls[0].attachments.length, 4); assert.ok(calls[0].attachments.every(item => item.name.startsWith('reference-')));
  assert.ok(session.getSnapshot().runs[0].result.readSet.some(reference => reference.path === 'logo.png'));
});

test('provider requests never wait for checkpoint writes, checkpoints coalesce and the final result is durable', async t => {
  const local = fixture('background-checkpoints'), checkpointGate = deferred(); let held = false, providerCalls = 0;
  const save = local.host.conversations.save;
  local.host.conversations.save = async (...args) => { if (args[0].runs[0]?.checkpoint && !held) { held = true; await checkpointGate.promise; } return save(...args); };
  local.host.ai.begin = async () => ({ apiKey: 'test', model: 'test/model', fetchImpl: async () => { providerCalls++; return Response.json({ ok: true }); } });
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    for (const colour of ['blue', 'green', 'purple']) {
      options.onProgress({ type: 'file-set', files: { ...options.files, 'style.css': colour }, values: options.values });
      await until(() => held);
      // The first checkpoint write is still pending: the next request starts anyway.
      await options.fetchImpl('https://provider.invalid/test');
    }
    assert.equal(providerCalls, 3); checkpointGate.resolve();
    return { files: { ...options.files, 'style.css': 'purple' }, values: options.values, valid: true };
  }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Edit stylesheet', snapshot: state() });
  await until(() => session.getSnapshot().runs[0]?.state === 'ready');
  const checkpoints = local.saved.map(doc => doc.runs[0]?.checkpoint?.files['style.css']).filter(Boolean);
  assert.equal(checkpoints.includes('green'), false, 'checkpoints that arrive during a write coalesce: the latest wins');
  assert.equal(local.read().runs[0].result.files['style.css'], 'purple');
  assert.equal(local.read().runs[0].metrics.providerCalls, 3);
});

test('failed checkpoint storage aborts the run and refuses later provider requests', async t => {
  const local = fixture('failed-checkpoint'); let providerCalls = 0, failed = false;
  const save = local.host.conversations.save;
  local.host.conversations.save = async (...args) => { if (args[0].runs[0]?.checkpoint && !failed) { failed = true; throw new Error('Checkpoint storage is unavailable.'); } return save(...args); };
  local.host.ai.begin = async () => ({ apiKey: 'test', model: 'test/model', fetchImpl: async () => { providerCalls++; return Response.json({ ok: true }); } });
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    options.onProgress({ type: 'file-set', files: { ...options.files, 'style.css': 'blue' }, values: options.values });
    await until(() => options.signal.aborted);
    await assert.rejects(options.fetchImpl('https://provider.invalid/test'));
    throw options.signal.reason || new Error('aborted');
  }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Edit stylesheet', snapshot: state() }); await until(() => session.getSnapshot().runs[0]?.state === 'cancelled');
  assert.equal(providerCalls, 0); assert.equal(failed, true);
  assert.equal(local.read().runs[0].result.files['style.css'], 'blue', 'the in-memory draft is still retained by the final write');
});

test('agent activity streams as text and step overlays, persists steps and shows the retry status', async t => {
  const local = fixture('activity'), gate = deferred(), seen = [];
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    options.onProgress({ type: 'tool-step', id: 'call-1', tool: 'read_file', path: 'index.html', status: 'running' });
    options.onProgress({ type: 'tool-step', id: 'call-1', status: 'done' });
    options.onProgress({ type: 'text-delta', delta: 'Reading the page. ' });
    options.onProgress({ type: 'text-delta', delta: 'Done.' });
    options.onProgress({ type: 'provider-recovery', statusCode: 429, attempt: 2, maxAttempts: 3, delayMs: 3000 });
    await gate.promise;
    return { files: { ...options.files, 'style.css': 'blue' }, values: options.values, valid: true, summary: 'Updated the stylesheet.' };
  }) }); t.after(() => session.dispose()); await session.ready;
  session.subscribe(() => { const run = session.getSnapshot().runs[0]; if (run) seen.push({ text: run.streamText, notice: run.notice, steps: run.steps }); });
  await session.submit({ prompt: 'Edit stylesheet', snapshot: state() });
  await until(() => session.getSnapshot().runs[0]?.notice);
  await until(() => session.getSnapshot().runs[0]?.streamText === 'Reading the page. Done.');
  assert.deepEqual(session.getSnapshot().runs[0].steps, [{ id: 'call-1', tool: 'read_file', status: 'done', path: 'index.html' }]);
  assert.deepEqual(session.getSnapshot().runs[0].notice, { kind: 'retry', statusCode: 429, attempt: 2, maxAttempts: 3, delayMs: 3000 });
  gate.resolve(); await until(() => session.getSnapshot().runs[0]?.state === 'ready');
  const stored = local.read().runs[0];
  assert.equal(stored.streamText, undefined, 'streamed text is not persisted; the summary is');
  assert.deepEqual(stored.steps, [{ id: 'call-1', tool: 'read_file', status: 'done', path: 'index.html' }]);
  assert.equal(stored.result.summary, 'Updated the stylesheet.');
  assert.equal(Number.isFinite(stored.metrics.durationMs), true);
});

test('a project message runs one workflow call without an intent routing call', async t => {
  const local = fixture('no-intent'), calls = [];
  const workflows = { ...basicWorkflows(async options => { calls.push(['project', options.mode]); return { files: options.files, values: options.values, valid: true, discussion: true, summary: 'An answer.' }; }), intent: async () => assert.fail('No intent routing call') };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'What does this page do?', snapshot: state() });
  await until(() => session.getSnapshot().runs[0]?.state === 'completed');
  await session.submit({ prompt: 'Fill the title', snapshot: state(), scope: { kind: 'content' } });
  await until(() => session.getSnapshot().runs[1]?.state === 'completed');
  assert.deepEqual(calls, [['project', 'edit'], ['project', 'content']]);
  assert.equal(session.getSnapshot().runs[0].phase, 'answered');
});

test('the message budget reserves room for the assistant result before any provider call', async t => {
  const initial = { schema: 1, projectId: 'message-budget', revision: 0, legacyMigrated: true, runs: [], threads: [{ id: 'thread', title: 'Long conversation', archived: false, messages: Array.from({ length: 499 }, (_, index) => ({ id: `message-${index}`, role: 'user', prompt: 'Previous message' })) }] };
  const local = fixture('message-budget', initial), session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => ({ files: options.files, values: options.values, valid: true })) }); t.after(() => session.dispose()); await session.ready;
  await assert.rejects(session.submit({ threadId: 'thread', prompt: 'One more change', snapshot: state() }), /message limit/);
  assert.equal(local.connections.length, 0); assert.equal(local.saved.length, 0);
  const reduced = local.read(); reduced.threads[0].messages.pop(); await local.host.conversations.save(reduced, { expectedRevision: reduced.revision });
  await session.submit({ threadId: 'thread', prompt: 'Last accepted request', snapshot: state() }); await until(() => session.getSnapshot().runs[0]?.state === 'ready');
  assert.equal(local.read().threads[0].messages.length, 500); assert.equal(local.read().threads[0].messages.at(-1).role, 'assistant');
});

test('section mentions persist actual instance values and source alongside file references', async t => {
  const snapshot = state();
  delete snapshot.files['index.html'];
  snapshot.files['index.tpl'] = '@param title String = "Default"\n@layout\n<section data-block="Hero"><h1>{{title}}</h1></section><footer>Keep footer</footer>\n@endlayout';
  const project = parseProject(snapshot.files);
  const values = inputValues(project.definition, snapshot.translations.en);
  const traced = generateEditorPreview(snapshot.files, values, { locale: 'en' });
  const sectionFrame = { selection: traced, sourceSnapshot: { files: snapshot.files, values, locale: 'en' } };
  const section = traced.blockInstances[0], mention = { kind: 'section', id: section.id, page: section.page, locale: 'en', label: 'Untrusted label', content: 'invented source' };
  const local = fixture('sections'), calls = [];
  local.host.analyzer.analyze = async () => ({ definition: project.definition, diagnostics: [], sourceDiagnostics: [] });
  const session = createConversationSession(local.host, { locks: null, workflows: basicWorkflows(async options => { calls.push(options); return { files: options.files, values: options.values, valid: true }; }) });
  t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Discuss the hero and stylesheet', snapshot, sectionFrame, scope: { kind: 'discussion' }, mentions: [mention, mention, { path: 'index.tpl' }] });
  await until(() => session.getSnapshot().runs[0]?.state === 'completed');
  const message = session.getSnapshot().threads[0].messages[0];
  assert.equal(message.mentions.length, 2);
  assert.equal(message.mentions[0].label, 'Hero');
  assert.equal(message.mentions[0].content, '<section data-block="Hero"><h1>{{title}}</h1></section>');
  assert.equal(message.mentions[0].values['/title'], 'Old');
  assert.equal(message.parts[1].type, 'section');
  assert.equal(message.parts[2].type, 'file');
  assert.equal(session.getSnapshot().runs[0].scope.kind, 'discussion');
  // Run a project workflow too, to inspect the exact context received by its model adapter.
  await session.submit({ prompt: 'Improve the hero', snapshot, sectionFrame, mentions: [mention] });
  await until(() => calls.length === 1);
  assert.match(calls[0].conversationContext, /mentioned files and sections/);
  assert.match(calls[0].conversationContext, /Hero/);
  assert.equal(calls[0].editScope, undefined, 'mentions provide context without changing the chosen task scope');
  const restored = createConversationSession(local.host, { locks: null, workflows: basicWorkflows(() => assert.fail('Reload never starts a request')) });
  t.after(() => restored.dispose()); await restored.ready;
  assert.equal(restored.getSnapshot().threads[0].messages[0].mentions[0].id, section.id);
});

test('unknown, outdated and wrong-language section mentions are rejected before provider connection', async t => {
  const snapshot = state(), local = fixture('invalid-sections');
  snapshot.files['index.html'] = '<section data-block="Hero">Hello</section>';
  const traced = generateEditorPreview(snapshot.files, {}, { locale: 'en' });
  const frame = { selection: traced, sourceSnapshot: { files: snapshot.files, values: { title: 'Old' }, locale: 'en' } };
  const section = traced.blockInstances[0], mention = { kind: 'section', id: section.id, page: section.page, locale: 'en' };
  const session = createConversationSession(local.host, { locks: null, workflows: basicWorkflows(() => assert.fail()) });
  t.after(() => session.dispose()); await session.ready;
  const request = { prompt: 'Use section', snapshot, sectionFrame: frame };
  await assert.rejects(session.submit({ ...request, mentions: [{ ...mention, id: 'unknown' }] }), /no longer exists/);
  await assert.rejects(session.submit({ ...request, mentions: [{ ...mention, locale: 'ru' }] }), /outdated/);
  await assert.rejects(session.submit({ ...request, snapshot: { ...snapshot, files: { ...snapshot.files, 'style.css': 'blue' } }, mentions: [mention] }), /outdated/);
  await assert.rejects(session.submit({ ...request, snapshot: { ...snapshot, translations: { en: { title: 'Changed' } } }, mentions: [mention] }), /outdated/);
  await assert.rejects(session.submit({ ...request, sectionFrame: undefined, mentions: [mention] }), /outdated/);
  assert.equal(local.connections.length, 0);
  assert.equal(session.getSnapshot().threads.length, 0);
});

test('repeated section mentions carry only their own rendered values', async t => {
  const snapshot = state(); delete snapshot.files['index.html'];
  snapshot.files['index.tpl'] = '@type Comment\n@param body String\n@endtype\n@param comments Comment[]\n@layout\n<section data-block="Comments">\n@each comment in comments:\n<article data-block="Comment">{{comment.body}}</article>\n@endeach\n</section>\n@endlayout';
  snapshot.translations.en = { comments: [{ body: 'First' }, { body: 'Second' }] };
  const project = parseProject(snapshot.files), values = inputValues(project.definition, snapshot.translations.en);
  const traced = generateEditorPreview(snapshot.files, values, { locale: 'en' });
  const frame = { selection: traced, sourceSnapshot: { files: snapshot.files, values, locale: 'en' } };
  const children = traced.blockInstances.filter(section => section.label === 'Comment');
  const local = fixture('repeated-sections');
  local.host.analyzer.analyze = async () => ({ definition: project.definition, sourceDiagnostics: [], diagnostics: [] });
  const session = createConversationSession(local.host, { locks: null, workflows: basicWorkflows(async options => ({ files: options.files, values: options.values, valid: true })) });
  t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Compare comments', scope: { kind: 'discussion' }, snapshot, sectionFrame: frame, mentions: children.map(section => ({ kind: 'section', id: section.id, page: section.page })) });
  await until(() => session.getSnapshot().runs[0]?.state === 'completed');
  const references = session.getSnapshot().threads[0].messages[0].mentions;
  assert.deepEqual(references.map(item => item.label), ['Comment (1/2)', 'Comment (2/2)']);
  assert.deepEqual(references[0].values, { '/comments/0/body': 'First' });
  assert.deepEqual(references[1].values, { '/comments/1/body': 'Second' });
  assert.equal(references[0].content, references[1].content);
});

test('discarding a stopped run with a checkpoint keeps its draft out of the next send', async t => {
  const local = fixture('discard-stopped'), calls = [], waits = [];
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(value => {
    calls.push(value); const wait = deferred(); waits.push(wait);
    if (calls.length === 1) value.onProgress({ type: 'file-set', path: 'style.css', files: { ...value.files, 'style.css': 'blue' }, values: value.values });
    return wait.promise;
  }) });
  t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit styles', snapshot: state() });
  await until(() => local.read().runs[0]?.checkpoint?.files['style.css'] === 'blue');
  const runId = session.getSnapshot().runs[0].id;
  await session.stop(runId); await until(() => session.getSnapshot().runs[0].state === 'cancelled'); waits[0].resolve();
  await session.discard(runId);
  const discarded = session.getSnapshot().runs[0];
  assert.equal(discarded.state, 'discarded'); assert.equal(discarded.result, undefined); assert.equal(discarded.checkpoint, undefined);
  await session.submit({ threadId, prompt: 'Try again', snapshot: state() }); await until(() => calls.length === 2);
  assert.equal(calls[1].files['style.css'], 'red', 'the discarded draft is not carried into the next run');
  waits[1].resolve({ files: calls[1].files, values: calls[1].values, valid: true }); await until(() => session.getSnapshot().runs[1].state === 'ready');
});

test('a discussion answer recovers a pre-output provider failure and streams its text', async () => {
  const { MockLanguageModelV4 } = await import('ai/test');
  const { simulateReadableStream } = await import('ai');
  const { discuss } = await import('../src/conversation-runtime.js');
  const { setAiRetrySleepForTesting } = await import('../src/ai-provider-recovery.js');
  setAiRetrySleepForTesting(async () => {}); try {
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
    const input = JSON.stringify({ text: 'The hero uses a two-column layout.' }), events = [];
    const languageModel = new MockLanguageModelV4({ doStream: async () => {
      if (languageModel.doStreamCalls.length === 1) throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
      return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'tool-input-start', id: 'answer-1', toolName: 'answer' },
        { type: 'tool-input-delta', id: 'answer-1', delta: input.slice(0, 20) }, { type: 'tool-input-delta', id: 'answer-1', delta: input.slice(20) }, { type: 'tool-input-end', id: 'answer-1' },
        { type: 'tool-call', toolCallId: 'answer-1', toolName: 'answer', input }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }] }) };
    } });
    const result = await discuss({ languageModel, signal: new AbortController().signal, timeout: 60000, conversationContext: 'None', values: {}, files: {}, prompt: 'Explain the hero', attachments: [], onProgress: event => events.push(event) });
    assert.equal(result.summary, 'The hero uses a two-column layout.'); assert.equal(result.discussion, true);
    assert.equal(languageModel.doStreamCalls.length, 2);
    assert.equal(events.filter(event => event.type === 'provider-recovery').length, 1);
    assert.equal(events.filter(event => event.type === 'text-delta').map(event => event.delta).join(''), 'The hero uses a two-column layout.');
  } finally { setAiRetrySleepForTesting(null); }
});

for (const binary of [true, false]) test(`a ${binary ? 'generated image' : 'text-only'} checkpoint ${binary ? 'is persisted before' : 'does not delay'} the next provider request`, async t => {
  const local = fixture(binary ? 'durable-image' : 'background-text'), gate = deferred(), path = binary ? 'hero.png' : 'notes.md';
  let checkpointSaved = false, savedBeforeRequest;
  const save = local.host.conversations.save;
  local.host.conversations.save = async (...args) => {
    if (!args[0].runs[0]?.checkpoint?.files?.[path]) return save(...args);
    await gate.promise; const result = await save(...args); checkpointSaved = true; return result;
  };
  local.host.ai.begin = async () => ({ apiKey: 'test', model: 'test/model', fetchImpl: async () => { savedBeforeRequest ??= checkpointSaved; return Response.json({ ok: true }); } });
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    const files = { ...options.files, [path]: binary ? Uint8Array.of(137, 80, 78, 71) : 'Notes' };
    options.onProgress({ type: 'file-set', path, paths: [path], files, values: options.values });
    setTimeout(() => gate.resolve(), 30);
    await options.fetchImpl('https://provider.invalid/next');
    return { files, values: options.values, valid: true, summary: 'Done.' };
  }) }); t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Add a hero image', snapshot: state() }); await until(() => session.getSnapshot().runs[0]?.state === 'ready');
  assert.equal(savedBeforeRequest, binary);
});

test('an image attached in an earlier message reaches generate_image as an input reference', async t => {
  const { MockLanguageModelV4 } = await import('ai/test');
  const { simulateReadableStream } = await import('ai');
  const { runStudioAiWorkflow } = await import('../src/studio-ai-workflow.js');
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
  const toolCall = (toolName, input) => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: `${toolName}-${Math.random()}`, toolName, input: JSON.stringify(input) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }] }) });
  const text = value => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: value }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] }) });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
  const photo = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'founder.png', mime: 'image/png', dataUrl: `data:image/png;base64,${png}`, useOnPage: false };
  const prompts = [], images = [];
  const languageModel = new MockLanguageModelV4({ doStream: async options => {
    prompts.push(JSON.stringify(options.prompt));
    return languageModel.doStreamCalls.length === 1 ? toolCall('generate_image', { path: 'img/founder-office.png', prompt: 'The same person from the reference, now in an office', references: ['ref1'] }) : text('Done.');
  } });
  const local = fixture('earlier-reference');
  local.host.ai.begin = async () => ({ apiKey: 'sk-or-v1-test-key-0000', model: 'test/model', imageModel: 'google/gemini-2.5-flash-image', languageModel,
    fetchImpl: async (url, init) => { images.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  let runs = 0;
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(async options => {
    if (++runs === 1) return { files: options.files, values: options.values, valid: true, discussion: true, summary: 'Nice photo.' };
    return runStudioAiWorkflow(options);
  }) }); t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Here is our founder', snapshot: state(), attachments: [photo], scope: { kind: 'content' } });
  await until(() => session.getSnapshot().runs[0]?.state === 'completed');
  await session.submit({ threadId, prompt: 'Generate an image from the reference', snapshot: state(), scope: { kind: 'content' }, generateImages: true });
  await until(() => ['ready', 'failed', 'completed'].includes(session.getSnapshot().runs[1]?.state));
  assert.equal(images.length, 1, session.getSnapshot().runs[1].error);
  assert.equal(images[0].url, 'https://openrouter.ai/api/v1/images');
  assert.deepEqual(images[0].body.input_references, [{ type: 'image_url', image_url: { url: photo.dataUrl } }]);
  assert.match(prompts[0], /ref1 — founder\.png \(attached earlier in this dialog; not shown again\)/);
  assert.equal(prompts[0].includes(photo.dataUrl), false, 'an earlier image is listed, not re-sent as a vision part');
  const step = session.getSnapshot().runs[1].steps.find(item => item.tool === 'generate_image');
  assert.equal(step.references, 1);
  assert.equal(session.getSnapshot().runs[1].state, 'ready', session.getSnapshot().runs[1].error);
  assert.ok(session.getSnapshot().runs[1].result.files['img/founder-office.png'] instanceof Uint8Array);
});

test('run updatedAt strictly increases whenever a run changes, even with a frozen clock', async t => {
  const local = fixture('frozen-clock');
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', now: () => 1000, workflows: basicWorkflows(async options => {
    options.onProgress({ type: 'file-set', path: 'style.css', files: { ...options.files, 'style.css': 'blue' }, values: options.values });
    return { files: { ...options.files, 'style.css': 'blue' }, values: options.values, valid: true, summary: 'Done' };
  }) });
  t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Edit', snapshot: state() });
  await until(() => local.read().runs[0]?.state === 'ready');
  const before = session.getSnapshot().runs[0].updatedAt;
  await session.markApplied(session.getSnapshot().runs[0].id, 4);
  assert.ok(local.read().runs[0].updatedAt > before, 'markApplied bumps updatedAt');
  const seen = local.saved.map(document => document.runs[0]).filter(Boolean);
  for (let index = 1; index < seen.length; index++) {
    const { owner: _before, updatedAt: before, ...previous } = seen[index - 1], { owner: _after, updatedAt: after, ...current } = seen[index];
    if (JSON.stringify(previous) !== JSON.stringify(current)) assert.ok(after > before, `save ${index}: updatedAt ${after} must exceed ${before}`);
  }
});

test('the run limit applies per dialog, not per project', async t => {
  const runs = Array.from({ length: 100 }, (_, index) => ({ id: `run-${index}`, threadId: 'full', messageId: 'message', state: 'ready', createdAt: 1, updatedAt: 1 }));
  const local = fixture('run-limit', { schema: 1, projectId: 'run-limit', revision: 0, threads: [{ id: 'full', title: 'Full', archived: false, messages: [{ id: 'message', role: 'user', prompt: 'Earlier' }] }], runs }), wait = deferred();
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => wait.promise) });
  t.after(() => { wait.resolve(); session.dispose(); }); await session.ready;
  await assert.rejects(session.submit({ threadId: 'full', prompt: 'One more', snapshot: state() }), /AI run limit/);
  const threadId = await session.submit({ prompt: 'New dialog', snapshot: state() });
  assert.equal(session.getSnapshot().runs.filter(run => run.threadId === threadId).length, 1);
});

test('an initial request becomes one deterministic dialog even when two windows open the project', async t => {
  const local = fixture('initial-twice', { schema: 1, projectId: 'initial-twice', revision: 0, threads: [], runs: [] }), wait = deferred(); let claims = 0;
  local.host.ai.initialRequest = { id: 'brief-1', prompt: 'Create a ceramics landing', mode: 'create', autoStart: true, attachments: [], claim: async () => { claims++; return claims === 1; } };
  const workflows = basicWorkflows(() => wait.promise);
  const first = createConversationSession(local.host, { locks: null, sessionId: 'one', workflows }), second = createConversationSession(local.host, { locks: null, sessionId: 'two', workflows });
  t.after(() => { wait.resolve(); first.dispose(); second.dispose(); });
  await Promise.all([first.ready, second.ready]);
  const saved = local.read();
  assert.equal(saved.threads.length, 1); assert.equal(saved.runs.length, 1);
  assert.match(saved.threads[0].id, /^initial-thread-[^:]+$/); assert.match(saved.runs[0].id, /^initial-run-[^:]+$/);
  assert.equal(saved.runs[0].initialClaim, 'brief-1'); assert.equal(Object.hasOwn(saved, 'legacyMigrated'), false);
});

test('an already claimed initial request fails instead of generating twice', async t => {
  const local = fixture('initial-claimed', { schema: 1, projectId: 'initial-claimed', revision: 0, threads: [], runs: [] });
  local.host.ai.initialRequest = { id: 'brief-2', prompt: 'Create', mode: 'create', autoStart: true, claim: async () => false };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail('No provider call')) });
  t.after(() => session.dispose()); await session.ready;
  await until(() => session.getSnapshot().runs[0]?.state === 'failed');
  assert.match(session.getSnapshot().runs[0].error, /already started/);
});

test('an initial request queued by a window that died before claiming is not created again', async t => {
  const runId = 'initial-run-earlier', initial = { schema: 1, projectId: 'initial-crashed', revision: 0,
    threads: [{ id: 'initial-thread-earlier', title: 'Create', archived: false, messages: [{ id: 'initial-message-earlier', role: 'user', prompt: 'Create', status: 'saved' }] }],
    runs: [{ id: runId, threadId: 'initial-thread-earlier', messageId: 'initial-message-earlier', state: 'queued', phase: 'queued', initialClaim: 'brief-3', owner: { sessionId: 'dead', fence: 0, expiresAt: 0 }, scope: { kind: 'project' }, createdAt: 1, updatedAt: 1 }] };
  const local = fixture('initial-crashed', initial);
  local.host.ai.initialRequest = { id: 'brief-3', prompt: 'Create', mode: 'create', autoStart: true, claim: async () => true };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail('No provider call')) });
  t.after(() => session.dispose()); await session.ready;
  assert.deepEqual(local.read().runs.map(run => [run.id, run.state]), [[runId, 'interrupted']]);
});

test('two windows over one conversation store queue one initial request dialog', async t => {
  const store = createMemoryConversationStore(), wait = deferred(), workflows = basicWorkflows(() => wait.promise);
  const open = sessionId => {
    const local = fixture('shared-store');
    local.host.conversations = createStoreConversationPort(store, { projectId: 'shared-store' });
    local.host.ai.initialRequest = { id: 'brief-4', prompt: 'Create', mode: 'create', autoStart: true, claim: async () => true };
    local.host.ai.begin = () => wait.promise.then(() => ({ apiKey: 'k', model: 'test/model', imageModel: '' }));
    return createConversationSession(local.host, { locks: null, sessionId, workflows });
  };
  const first = open('one'), second = open('two');
  t.after(() => { wait.resolve(); first.dispose(); second.dispose(); });
  await Promise.all([first.ready, second.ready]);
  const threads = await store.listThreads();
  assert.equal(threads.length, 1); assert.equal(threads[0].runs.length, 1);
});
