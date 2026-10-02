import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createChatPort } from '../src/chat-port.js';

function fakeSession() {
  let doc = { projectId: 'p', revision: 0, threads: [], runs: [] }; const listeners = new Set(), calls = [];
  const emit = () => { for (const listener of listeners) listener(); };
  return { calls, doc: () => doc, set(next) { doc = next; emit(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => doc, ready: Promise.resolve(),
    async submit(input) {
      calls.push(['submit', input]); const threadId = input.threadId || 'generated';
      const message = { id: 'm1', role: 'user', prompt: input.prompt, parts: [{ type: 'text', text: input.prompt }], mentions: input.mentions, attachments: input.attachments, createdAt: 1, runId: 'r1' };
      doc = { ...doc, threads: [...doc.threads, { id: threadId, title: input.prompt, archived: false, createdAt: 1, updatedAt: 1, messages: [message] }], runs: [...doc.runs, { id: 'r1', threadId, messageId: 'm1', state: 'queued', phase: 'queued', scope: input.scope, locale: 'en', base: input.snapshot, createdAt: 1, updatedAt: 1 }] }; emit(); return threadId;
    },
    async stop(id) { calls.push(['stop', id]); }, async discard(id) { calls.push(['discard', id]); }, async markApplied(id, revision) { calls.push(['markApplied', id, revision]); },
    async continue(id, options) { calls.push(['continue', id, options]); }, async rename(id, title) { calls.push(['rename', id, title]); }, async archive(id, value) { calls.push(['archive', id, value]); }, async deleteThread(id) { calls.push(['deleteThread', id]); },
    async reconcileApplied() {}, dispose() {} };
}
const state = { files: { 'index.tpl': 'a', 'hero.png': new Uint8Array([1]) }, translations: { en: { title: 'T' } }, appliedAiRuns: [], analysis: { definition: { sections: [{ id: 'hero', label: 'Hero', fields: [{ name: 'title', label: 'Title' }] }] } } };
// Черновики фикстуры несут весь набор файлов и значений: иначе hero.png и title считаются удалёнными и дают лишние карточки.
const draft = (index, extra = {}) => ({ files: { ...state.files, 'index.tpl': index }, values: { ...state.translations.en }, ...extra });
const context = () => ({ state, locale: 'en', sectionFrame: null, settings: { configured: true, imageModel: 'x' }, onApplyRun: async () => ({ revision: 7 }), onKeepDraft: async () => {}, onOpenFile: () => {}, onOpenSection: () => {}, t: text => text });
const ready = (session, patch) => session.set({ ...session.doc(), runs: [{ ...session.doc().runs[0], state: 'ready', result: draft('b', { valid: true, summary: 'ok' }), ...patch }] });
const run = patch => session => session.set({ ...session.doc(), runs: [{ ...session.doc().runs[0], ...patch }] });
const input = (extra = {}) => ({ text: 'x', mentions: [], attachments: [], scope: { kind: 'project' }, ...extra });

test('createThread returns a real pending thread; the first send creates it in the runtime under the same id; stores notify with values', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context);
  const thread = await port.createThread();
  assert.ok(thread.id); assert.equal(port.threads.get()[0].id, thread.id); assert.deepEqual(port.messages(thread.id).get(), []);
  const seenThreads = [], seenMessages = [];
  port.threads.subscribe(value => seenThreads.push(value)); port.messages(thread.id).subscribe(value => seenMessages.push(value));
  await port.send(thread.id, { text: 'Make hero shorter', mentions: [{ kind: 'file', id: 'index.tpl', label: 'index.tpl' }], attachments: [], scope: { kind: 'project' } });
  assert.equal(session.calls[0][1].threadId, thread.id); assert.deepEqual(session.calls[0][1].mentions, [{ path: 'index.tpl' }]);
  assert.equal(port.threads.get().length, 1, 'pending thread is replaced by the runtime thread, not duplicated');
  const messages = port.messages(thread.id).get();
  assert.equal(messages.length, 2); assert.equal(messages[1].role, 'assistant'); assert.equal(messages[1].id, 'r1', 'assistant message id equals run id'); assert.deepEqual(messages[1].status, { id: 'r1', status: 'queued', message: 'Queued' });
  assert.equal('runId' in messages[1], false, 'no fields outside port.d.ts');
  assert.ok(Array.isArray(seenThreads.at(-1)) && seenThreads.at(-1)[0].id === thread.id, 'threads.subscribe receives the current list');
  assert.deepEqual(seenMessages.at(-1), messages, 'messages.subscribe receives the current list');
});

test('store snapshots are referentially stable between changes (useSyncExternalStore)', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context), { id } = await port.createThread();
  assert.equal(port.threads.get(), port.threads.get()); assert.equal(port.messages(id).get(), port.messages(id).get());
  await port.send(id, input());
  const before = port.messages(id).get(); assert.equal(port.messages(id).get(), before);
  run({ state: 'running', phase: 'plan' })(session);
  assert.notEqual(port.messages(id).get(), before, 'a session change produces a new snapshot');
});

test('send converts File attachments to runtime attachments, allows attachments without text and rejects an empty message', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context), { id } = await port.createThread();
  const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
  await port.send(id, { text: '', mentions: [], attachments: [file], scope: { kind: 'project' } });
  const [attachment] = session.calls[0][1].attachments;
  assert.equal(attachment.name, 'note.txt'); assert.equal(attachment.mime, 'text/plain'); assert.equal(attachment.text, 'hello'); assert.ok(attachment.id);
  assert.ok(session.calls[0][1].prompt.trim(), 'the runtime requires a non-empty prompt, so attachments-only messages get a default one');
  await assert.rejects(port.send(id, { text: '   ', mentions: [], attachments: [], scope: { kind: 'project' } }), error => error.code === 'policy');
  assert.equal(session.calls.length, 1, 'empty message never reaches the session');
});

test('clarifications of a running run do not produce extra assistant messages', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context);
  const { id } = await port.createThread(); await port.send(id, input());
  const thread = session.doc().threads[0];
  session.set({ ...session.doc(), threads: [{ ...thread, messages: [...thread.messages, { id: 'm2', role: 'user', prompt: 'also this', parts: [], status: 'queued-clarification', runId: 'r1', createdAt: 2 }] }] });
  assert.deepEqual(port.messages(id).get().map(message => message.role), ['user', 'assistant', 'user']);
});

test('send forwards mode to the runtime and rejects without a configured key before touching the session', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context);
  const { id } = await port.createThread(); await port.send(id, input({ mode: 'create' }));
  assert.equal(session.calls[0][1].mode, 'create');
  const lockedSession = fakeSession(), locked = createChatPort(lockedSession, () => ({ ...context(), settings: { configured: false } }));
  const pending = await locked.port.createThread();
  await assert.rejects(locked.port.send(pending.id, input()), error => error.code === 'policy');
  assert.equal(lockedSession.calls.length, 0);
});

test('send maps scopes: file path, registered block scope, plain kinds', async () => {
  const session = fakeSession(), adapter = createChatPort(session, context), { port } = adapter, { id } = await port.createThread();
  const editScope = { version: 1, selectedInstanceIds: ['b1'] }; adapter.registerBlockScope('blocks:1', editScope);
  await port.send(id, input({ scope: { kind: 'file', targetId: 'index.tpl' } }));
  await port.send(id, input({ scope: { kind: 'block', targetId: 'blocks:1' } }));
  await port.send(id, input({ scope: { kind: 'discussion' } }));
  assert.deepEqual(session.calls.map(call => call[1].scope), [{ kind: 'file', path: 'index.tpl' }, { kind: 'block', editScope }, { kind: 'discussion' }]);
  assert.deepEqual(port.capabilities.scopes, ['project', 'file', 'block', 'content', 'discussion']);
  assert.equal(port.capabilities.generateImages, true); assert.equal(port.capabilities.conflictReview, true); assert.equal(port.capabilities.keepDraft, true); assert.equal(port.capabilities.cost, false);
});

test('mention targets group sections, files and fields and resolve kind filters', async () => {
  const { port } = createChatPort(fakeSession(), context);
  assert.deepEqual([...new Set(port.mentionTargets('').map(item => item.kind))].sort(), ['field', 'file']);
  assert.ok(port.mentionTargets('hero', 'file').some(item => item.id === 'hero.png'));
  assert.deepEqual(port.mentionTargets('tit', 'field').map(item => item.id), ['field:hero.title']);
  assert.ok(port.mentionTargets('').every(item => !('raw' in item)));
});

test('apply marks the run applied; a conflict adds a question card; rebase continues, reviewed applies with stale context; conflicts clear on project change', async () => {
  const session = fakeSession(); let attempts = 0;
  const adapter = createChatPort(session, () => ({ ...context(), onApplyRun: async (run, options) => { attempts++; if (!options.allowStaleContext) throw Object.assign(new Error('conflict'), { code: 'conflict', requiresContextReview: true, conflicts: [], staleReadSet: [], candidate: null }); return { revision: 9 }; } }));
  const { port } = adapter, { id } = await port.createThread();
  await port.send(id, input()); ready(session);
  assert.equal(port.messages(id).get()[1].status.status, 'ready');
  await port.apply('r1');
  assert.equal(port.messages(id).get()[1].parts.find(part => part.result?.type === 'question').result.kind, 'conflict');
  await port.answer('conflict:r1', 'rebase');
  assert.equal(session.calls.at(-1)[0], 'continue'); assert.equal(session.calls.at(-1)[2].rebase, true);
  await port.apply('r1'); await port.apply('r1', { allowStaleContext: true });
  assert.deepEqual(session.calls.at(-1), ['markApplied', 'r1', 9]); assert.equal(attempts, 3);
  await port.answer('conflict:r1', 'reviewed');
  assert.deepEqual(session.calls.at(-1), ['markApplied', 'r1', 9]); assert.equal(attempts, 4, 'reviewed applies with stale context');
  await port.apply('r1'); adapter.invalidateConflicts();
  assert.equal(port.messages(id).get()[1].parts.some(part => part.result?.type === 'question'), false);
});

test('a non-applicable ready run is reported as completed', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context), { id } = await port.createThread();
  await port.send(id, input()); ready(session, { result: draft('b', { valid: true, discussion: true, summary: 'talk' }) });
  assert.equal(port.messages(id).get()[1].status.status, 'completed');
});

test('previewDraft, continueRun, keepDraft, stop, discard and thread operations reach the session and context', async () => {
  const session = fakeSession(), previews = [], kept = [];
  const { port } = createChatPort(session, () => ({ ...context(), onPreviewDraft: value => previews.push(value), onKeepDraft: async value => kept.push(value.id) }));
  const { id } = await port.createThread(); await port.send(id, input());
  run({ state: 'failed', checkpoint: draft('c', { valid: false }), error: 'boom' })(session);
  await port.previewDraft('r1'); await port.previewDraft(null);
  assert.deepEqual(previews.map(value => value && [value.files['index.tpl'], value.locale, value.runId]), [['c', 'en', 'r1'], null]);
  await port.continueRun('r1', 'go on'); assert.equal(session.calls.at(-1)[0], 'continue'); assert.equal(session.calls.at(-1)[2].prompt, 'go on'); assert.equal(session.calls.at(-1)[2].snapshot, state);
  await port.keepDraft('r1'); assert.deepEqual(kept, ['r1']);
  await port.stop('r1'); await port.discard('r1'); await port.renameThread(id, 'T'); await port.archiveThread(id, true); await port.deleteThread(id);
  assert.deepEqual(session.calls.slice(-5).map(call => call[0]), ['stop', 'discard', 'rename', 'archive', 'deleteThread']);
  const pending = await port.createThread(); await port.deleteThread(pending.id);
  assert.equal(session.calls.at(-1)[0], 'deleteThread'); assert.equal(port.threads.get().some(thread => thread.id === pending.id), false, 'a pending thread is dropped locally');
});

test('events is a hot stream: status on state/phase changes only, one part-start per card, part-update afterwards, question on conflict', async () => {
  const session = fakeSession(), adapter = createChatPort(session, () => ({ ...context(), onApplyRun: async () => { throw Object.assign(new Error('c'), { code: 'conflict', conflicts: [], staleReadSet: [], requiresContextReview: true, candidate: null }); } }));
  const { port } = adapter, { id } = await port.createThread(); await port.send(id, input());
  const iterator = port.events(id)[Symbol.asyncIterator](), next = async () => (await iterator.next()).value;
  // Поток горячий: подписка создана при вызове events(), поэтому set() до next() не теряет событий.
  run({ state: 'running', phase: 'plan', updatedAt: 2, checkpoint: draft('ab') })(session);
  assert.deepEqual((await next()).status, { id: 'r1', status: 'running', message: 'Plan' });
  const started = await next(); assert.equal(started.type, 'part-start'); assert.equal(started.messageId, 'r1'); assert.equal(started.part.result.type, 'diff');
  run({ updatedAt: 3, checkpoint: draft('abc') })(session);
  const updated = await next(); assert.equal(updated.type, 'part-update', 'updatedAt alone does not emit status'); assert.equal(updated.toolCallId, 'r1:diff:index.tpl'); assert.equal(updated.result.after, 'abc');
  ready(session, { updatedAt: 4 });
  assert.deepEqual((await next()).status, { id: 'r1', status: 'ready' }); // статус — первым
  assert.equal((await next()).type, 'part-update'); // result.files['index.tpl'] = 'b' отличается от чекпоинта 'abc'
  await port.apply('r1');
  const question = await next(); assert.equal(question.type, 'part-start'); assert.equal(question.part.result.type, 'question');
  await iterator.return();
});

test('events are independent subscriptions and return() releases a pending next()', async () => {
  const session = fakeSession(), { port } = createChatPort(session, context), { id } = await port.createThread(); await port.send(id, input());
  const first = port.events(id)[Symbol.asyncIterator](), second = port.events(id)[Symbol.asyncIterator]();
  const waiting = first.next(); await first.return();
  assert.deepEqual(await waiting, { value: undefined, done: true });
  run({ state: 'running', phase: 'plan' })(session);
  assert.equal((await second.next()).value.type, 'status', 'closing one stream does not affect another');
  await second.return();
});

test('dispose closes every open stream and drops listeners', async () => {
  const session = fakeSession(), adapter = createChatPort(session, context), { port } = adapter;
  const { id } = await port.createThread(); await port.send(id, input());
  const first = port.events(id)[Symbol.asyncIterator](), second = port.events(id)[Symbol.asyncIterator]();
  const pending = [first.next(), second.next()];
  adapter.port.dispose();
  assert.deepEqual(await Promise.all(pending), [{ value: undefined, done: true }, { value: undefined, done: true }]);
  let notified = 0; port.threads.subscribe(() => notified++); session.set({ ...session.doc() });
  assert.equal(notified, 0, 'a disposed port no longer forwards session changes');
});

test('deleteThread drops the cached message store; refresh re-labels cached snapshots', async () => {
  const session = fakeSession(); let t = text => text;
  const adapter = createChatPort(session, () => ({ ...context(), t })), { port } = adapter, { id } = await port.createThread();
  const store = port.messages(id); assert.equal(port.messages(id), store);
  await port.deleteThread(id);
  assert.notEqual(port.messages(id), store, 'message store of a deleted thread is not retained');
  const { id: other } = await port.createThread(); await port.send(other, input());
  const removed = port.messages(other); await port.deleteThread(other);
  assert.deepEqual(session.calls.at(-1), ['deleteThread', other]); assert.notEqual(port.messages(other), removed);
  const { id: fresh } = await port.createThread();
  t = text => (text === 'New conversation' ? 'Новый диалог' : text);
  let seen; port.threads.subscribe(value => { seen = value; });
  adapter.refresh();
  assert.equal(seen.find(item => item.id === fresh).title, 'Новый диалог');
});
