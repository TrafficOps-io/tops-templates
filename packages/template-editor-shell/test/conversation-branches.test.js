import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConversationDocument } from '@trafficops/template-editor-core';
import { createConversationSession } from '../src/conversation-runtime.js';
import { conversationTree, visiblePath } from '../src/conversation-tree.js';
import { createChatPort } from '../src/chat-port.js';

const state = () => ({ name: 'Landing', revision: 3, files: { 'index.html': '<h1>Old</h1>', 'style.css': 'red' }, folders: [], entrypoint: 'index.html', locale: 'en', translations: { en: { title: 'Old' } } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(predicate) { for (let count = 0; count < 400; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Timed out waiting for runtime state'); }
function fixture(projectId, initial) {
  let document = initial || { schema: 1, projectId, revision: 0, legacyMigrated: true, threads: [], runs: [] };
  const subscribers = new Set(), saved = [];
  const conversations = { projectId, load: async () => structuredClone(document), save: async (next, { expectedRevision }) => {
    if (expectedRevision !== document.revision) throw Object.assign(new Error('Concurrent write'), { code: 'conflict' });
    document = validateConversationDocument({ ...next, revision: document.revision + 1 }); saved.push(document);
    for (const subscriber of subscribers) subscriber(structuredClone(document)); return structuredClone(document);
  }, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); } };
  const host = { conversations, project: { open: async () => state() }, analyzer: {
    analyze: async snapshot => ({ definition: { name: snapshot.name, sections: [{ id: 'content', fields: [{ name: 'title', type: 'String' }] }] }, entrypoint: 'index.html', sourceDiagnostics: [], diagnostics: [] }), render: async snapshot => snapshot.files,
  }, ai: { begin: async () => ({ apiKey: 'secret', model: 'test/model', imageModel: '' }), finish: async () => {} } };
  return { host, saved, read: () => structuredClone(document) };
}
// Each call waits for the test to resolve it with a style value (or an Error).
function controlled() {
  const calls = [], waits = [];
  const project = options => { calls.push(options); const wait = deferred(); waits.push(wait); return wait.promise; };
  const finish = (index, style, summary = `Style ${style}`) => waits[index].resolve({ files: { ...calls[index].files, 'style.css': style }, values: calls[index].values, valid: true, summary });
  return { calls, waits, finish, workflows: { project, file: project, block: project, discussion: project } };
}
const runOf = (session, id) => session.getSnapshot().runs.find(run => run.id === id);
const path = (session, threadId) => { const doc = session.getSnapshot(), thread = doc.threads.find(item => item.id === threadId); return visiblePath(conversationTree(thread, doc.runs)); };

test('regenerate starts a sibling run from the same base and parent draft; a sibling draft never leaks', async t => {
  const local = fixture('regenerate'), control = controlled();
  const session = createConversationSession(local.host, { workflows: control.workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit styles', snapshot: state() }); await until(() => control.calls.length === 1);
  control.finish(0, 'blue'); const r1 = session.getSnapshot().runs[0].id; await until(() => runOf(session, r1).state === 'ready');
  await session.submit({ threadId, prompt: 'Also the title', snapshot: state() }); await until(() => control.calls.length === 2);
  assert.equal(control.calls[1].files['style.css'], 'blue', 'the follow-up continues its parent draft');
  control.finish(1, 'navy'); const r2 = session.getSnapshot().runs[1].id; await until(() => runOf(session, r2).state === 'ready');

  await assert.rejects(session.regenerate(threadId, 'missing'), /no longer exists/);
  const r2b = await session.regenerate(threadId, r2); await until(() => control.calls.length === 3);
  const sibling = runOf(session, r2b), original = runOf(session, r2);
  assert.equal(sibling.messageId, original.messageId, 'the same user message: a sibling answer');
  assert.deepEqual(sibling.base, original.base); assert.equal(sibling.startingRunId, r1);
  assert.equal(control.calls[2].files['style.css'], 'blue', 'the regenerated run starts from the parent draft, not from its sibling');
  assert.equal(control.calls[2].prompt, 'Also the title');
  assert.match(control.calls[2].conversationContext, /Edit styles/); assert.match(control.calls[2].conversationContext, /Style blue/);
  assert.doesNotMatch(control.calls[2].conversationContext, /Style navy/, 'the replaced answer is not history');
  await assert.rejects(session.regenerate(threadId, r2), /Wait for the current run/, 'one active run per dialog');
  await assert.rejects(session.switchBranch(threadId, r2), /Wait for the current run/);
  control.finish(2, 'teal'); await until(() => runOf(session, r2b).state === 'ready');
  assert.deepEqual(path(session, threadId).slice(-1), [r2b]);

  // Regenerating the first answer: the base project, no draft of either later branch.
  const r1b = await session.regenerate(threadId, r1); await until(() => control.calls.length === 4);
  assert.equal(control.calls[3].files['style.css'], 'red'); assert.equal(runOf(session, r1b).starting, undefined);
  control.finish(3, 'green'); await until(() => runOf(session, r1b).state === 'ready');
  assert.equal(path(session, threadId).length, 2);
  await session.submit({ threadId, prompt: 'Next on the new branch', snapshot: state() }); await until(() => control.calls.length === 5);
  assert.equal(control.calls[4].files['style.css'], 'green', 'a follow-up uses its own branch, not the newest run of the document');
  assert.doesNotMatch(control.calls[4].conversationContext, /Also the title/);
  control.finish(4, 'lime'); await until(() => session.getSnapshot().runs.every(run => !['queued', 'running'].includes(run.state)));

  await session.switchBranch(threadId, r1);
  assert.equal(path(session, threadId).at(-1), r2b, 'switching goes to the newest leaf under the message');
  assert.equal(local.read().threads[0].activeLeafId, r2b, 'the active leaf is persisted');
});

test('editMessage creates a sibling user message with the same references and a run from the original base', async t => {
  const local = fixture('edit'), control = controlled();
  const session = createConversationSession(local.host, { workflows: control.workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit styles', snapshot: state(), mentions: ['index.html'] }); await until(() => control.calls.length === 1);
  control.finish(0, 'blue'); await until(() => session.getSnapshot().runs[0].state === 'ready');
  await session.submit({ threadId, prompt: 'Make it bold', snapshot: state() }); await until(() => control.calls.length === 2);
  control.finish(1, 'bold'); await until(() => session.getSnapshot().runs[1].state === 'ready');
  const doc = session.getSnapshot(), [first, second] = doc.threads[0].messages.filter(message => message.role === 'user');
  await assert.rejects(session.editMessage(threadId, second.id, { text: '  ' }), /1–6,000/);
  const edited = await session.editMessage(threadId, second.id, { text: 'Make it italic' }); await until(() => control.calls.length === 3);
  const message = session.getSnapshot().threads[0].messages.find(item => item.id === edited), run = session.getSnapshot().runs.at(-1);
  assert.equal(message.parentId, second.parentId); assert.equal(message.editedFromId, second.id); assert.equal(run.messageId, edited);
  assert.equal(control.calls[2].prompt, 'Make it italic'); assert.equal(control.calls[2].files['style.css'], 'blue');
  assert.doesNotMatch(control.calls[2].conversationContext, /Make it bold/);
  assert.equal(run.originalRequest, 'Edit styles', 'a follow-up keeps the original request of its draft chain');
  control.finish(2, 'italic'); await until(() => run.id && runOf(session, run.id).state === 'ready');
  // Editing the first message keeps its file reference and starts over from the project.
  const root = await session.editMessage(threadId, first.id, { text: 'Edit only the header' }); await until(() => control.calls.length === 4);
  const rootMessage = session.getSnapshot().threads[0].messages.find(item => item.id === root);
  assert.equal(rootMessage.parentId, null); assert.equal(session.getSnapshot().runs.at(-1).originalRequest, 'Edit only the header'); assert.deepEqual(rootMessage.mentions.map(item => item.path), ['index.html']);
  assert.equal(control.calls[3].files['style.css'], 'red'); assert.match(control.calls[3].conversationContext, /index\.html/);
  control.finish(3, 'plum'); await until(() => session.getSnapshot().runs.every(item => item.state === 'ready'));
  assert.equal(path(session, threadId).length, 2);
});

test('a clarification cannot be edited, and Retry of a failed run is a fresh sibling from the same base', async t => {
  const local = fixture('retry'), control = controlled();
  const session = createConversationSession(local.host, { workflows: control.workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit styles', snapshot: state() }); await until(() => control.calls.length === 1);
  await session.submit({ threadId, prompt: 'Keep the header', snapshot: state() });
  const clarification = session.getSnapshot().threads[0].messages.find(message => message.prompt === 'Keep the header');
  assert.equal(clarification.parentId, session.getSnapshot().runs[0].id, 'a clarification hangs off its run');
  // A partial draft before the failure.
  control.calls[0].onProgress({ type: 'file-set', path: 'style.css', files: { ...control.calls[0].files, 'style.css': 'half' }, values: control.calls[0].values });
  control.waits[0].reject(new Error('Provider failed')); const failed = session.getSnapshot().runs[0].id;
  await until(() => runOf(session, failed).state === 'failed');
  await assert.rejects(session.editMessage(threadId, clarification.id, { text: 'Other' }), /clarification/);
  const retry = await session.regenerate(threadId, failed); await until(() => control.calls.length === 2);
  assert.equal(control.calls[1].files['style.css'], 'red', 'the failed sibling draft is not carried into the retry');
  assert.match(control.calls[1].conversationContext, /^Earlier messages in THIS dialog[^\n]*\n\[\]/, 'no history before the first message');
  control.finish(1, 'blue'); await until(() => runOf(session, retry).state === 'ready');
});

test('a discarded parent draft is not restored when its follow-up is regenerated', async t => {
  const local = fixture('discarded-parent'), control = controlled();
  const session = createConversationSession(local.host, { workflows: control.workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose()); await session.ready;
  const threadId = await session.submit({ prompt: 'Edit styles', snapshot: state() }); await until(() => control.calls.length === 1);
  control.finish(0, 'blue'); const r1 = session.getSnapshot().runs[0].id; await until(() => runOf(session, r1).state === 'ready');
  await session.submit({ threadId, prompt: 'More', snapshot: state() }); await until(() => control.calls.length === 2);
  control.finish(1, 'navy'); const r2 = session.getSnapshot().runs[1].id; await until(() => runOf(session, r2).state === 'ready');
  await session.discard(r1);
  await session.regenerate(threadId, r2); await until(() => control.calls.length === 3);
  assert.equal(control.calls[2].files['style.css'], 'red');
  control.finish(2, 'teal'); await until(() => session.getSnapshot().runs.every(run => run.state !== 'queued' && run.state !== 'running'));
});

test('a linear document from before the tree is migrated on load without changing what the user sees', async t => {
  const initial = { schema: 1, projectId: 'legacy-linear', revision: 4, legacyMigrated: true, threads: [{ id: 't1', title: 'Old', createdAt: 1, updatedAt: 1, archived: false, messages: [
    { id: 'u1', role: 'user', prompt: 'First', parts: [{ type: 'text', text: 'First' }], attachments: [], mentions: [], createdAt: 1, status: 'ready', runId: 'r1' },
    { id: 'c1', role: 'user', prompt: 'Clarified', parts: [{ type: 'text', text: 'Clarified' }], attachments: [], mentions: [], createdAt: 2, status: 'queued-clarification', runId: 'r1' },
    { id: 'a1', role: 'assistant', prompt: 'Answer one', parts: [{ type: 'text', text: 'Answer one' }], createdAt: 3, runId: 'r1', status: 'ready' },
    { id: 'u2', role: 'user', prompt: 'Second', parts: [{ type: 'text', text: 'Second' }], attachments: [], mentions: [], createdAt: 4, status: 'failed', runId: 'r2' },
  ] }], runs: [
    { id: 'r1', projectId: 'legacy-linear', threadId: 't1', messageId: 'u1', attempt: 0, state: 'ready', phase: 'ready', base: { projectId: 'legacy-linear', ...state() }, locale: 'en', scope: { kind: 'project' }, createdAt: 1, updatedAt: 3 },
    { id: 'r2', projectId: 'legacy-linear', threadId: 't1', messageId: 'u2', attempt: 0, state: 'failed', phase: 'stopped', base: { projectId: 'legacy-linear', ...state() }, locale: 'en', scope: { kind: 'project' }, createdAt: 4, updatedAt: 5, error: 'Failed' },
  ] };
  const local = fixture('legacy-linear', structuredClone(initial)), control = controlled();
  const session = createConversationSession(local.host, { workflows: control.workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose()); await session.ready;
  const messagesBefore = session.getSnapshot().threads[0].messages.map(({ id, prompt }) => ({ id, prompt }));
  assert.deepEqual(messagesBefore, initial.threads[0].messages.map(({ id, prompt }) => ({ id, prompt })), 'no message is lost or reordered');
  assert.deepEqual(path(session, 't1'), ['u1', 'r1', 'u2', 'r2']);
  const { port } = createChatPort(session, () => ({ state: state(), locale: 'en', settings: { configured: true }, t: text => text }));
  assert.deepEqual(port.messages('t1').get().map(message => message.id), ['u1', 'r1', 'c1', 'u2', 'r2']);
  await session.rename('t1', 'Renamed');
  const saved = local.read().threads[0].messages;
  assert.deepEqual(saved.filter(message => message.role === 'user').map(message => message.parentId), [null, 'r1', 'r1'], 'the first write persists the inferred parents');
  // Retry of the failed legacy run keeps the earlier answer as history.
  await session.regenerate('t1', 'r2'); await until(() => control.calls.length === 1);
  assert.match(control.calls[0].conversationContext, /First/); assert.match(control.calls[0].conversationContext, /Clarified/); assert.match(control.calls[0].conversationContext, /Answer one/);
  control.finish(0, 'blue'); await until(() => session.getSnapshot().runs.at(-1).state === 'ready');
  const messages = port.messages('t1').get();
  assert.deepEqual(messages.at(-1).branch, { index: 1, count: 2, siblingIds: ['r2', session.getSnapshot().runs.at(-1).id] });
  port.dispose();
});
