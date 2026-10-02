import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_STATUS, addStreamedText, canDiscardRun, hasDraftCards, applyChatEvent, canHandleCardAction, mergeStreamedText, handleCardAction, lineDiff, sendToPort, toThreadMessage } from '../src/chat/chat-model.js';
import { createFakeChatPort } from './fixtures/FakeChatPort.js';

const card = { type: 'audio', name: 'voice.mp3', status: 'generating', progress: 0.2 };
const base = () => [
  { id: 'm1', role: 'user', createdAt: '2026-10-02T10:00:00.000Z', parts: [{ type: 'text', text: 'Hi' }] },
  { id: 'm2', role: 'assistant', createdAt: '2026-10-02T10:00:01.000Z', parts: [], status: { id: 'm2', status: 'running' } },
];
const frozen = value => { const copy = structuredClone(value); return [copy, JSON.stringify(copy)]; };

test('text-delta accumulates into the last text part', () => {
  const [messages, before] = frozen(base());
  let next = applyChatEvent(messages, { type: 'text-delta', messageId: 'm2', delta: 'Hel' });
  next = applyChatEvent(next, { type: 'text-delta', messageId: 'm2', delta: 'lo' });
  assert.deepEqual(next[1].parts, [{ type: 'text', text: 'Hello' }]);
  assert.equal(JSON.stringify(messages), before, 'input is not mutated');
  assert.equal(next[0], messages[0], 'untouched messages keep identity');
});

test('text-delta after a card starts a new text part', () => {
  let next = applyChatEvent(base(), { type: 'part-start', messageId: 'm2', part: { type: 'tool-call', toolCallId: 'm2:0', toolName: 'audio', result: card } });
  next = applyChatEvent(next, { type: 'text-delta', messageId: 'm2', delta: 'Done' });
  assert.deepEqual(next[1].parts.map(part => part.type), ['tool-call', 'text']);
});

test('part-start adds a card, part-update merges by toolCallId, part-done leaves the message unchanged', () => {
  const [messages, before] = frozen(base());
  const started = applyChatEvent(messages, { type: 'part-start', messageId: 'm2', part: { type: 'tool-call', toolCallId: 'm2:0', toolName: 'audio', result: card } });
  assert.equal(started[1].parts.length, 1);
  const updated = applyChatEvent(started, { type: 'part-update', messageId: 'm2', toolCallId: 'm2:0', result: { status: 'ready', url: '/a.mp3', durationMs: 1200 } });
  assert.deepEqual(updated[1].parts[0].result, { ...card, status: 'ready', url: '/a.mp3', durationMs: 1200 });
  assert.equal(started[1].parts[0].result.status, 'generating', 'previous state is not mutated');
  const done = applyChatEvent(updated, { type: 'part-done', messageId: 'm2', toolCallId: 'm2:0' });
  assert.equal(done, updated);
  assert.equal(JSON.stringify(messages), before);
});

test('a repeated part-start with the same toolCallId replaces the card', () => {
  const part = { type: 'tool-call', toolCallId: 'm2:0', toolName: 'audio', result: card };
  let next = applyChatEvent(base(), { type: 'part-start', messageId: 'm2', part });
  next = applyChatEvent(next, { type: 'part-start', messageId: 'm2', part: { ...part, result: { ...card, progress: 0.5 } } });
  assert.equal(next[1].parts.length, 1);
  assert.equal(next[1].parts[0].result.progress, 0.5);
});

test('status replaces the run state; error marks the run failed with the text', () => {
  const [messages, before] = frozen(base());
  const ready = applyChatEvent(messages, { type: 'status', messageId: 'm2', status: { id: 'm2', status: 'ready', cost: 0.01 } });
  assert.deepEqual(ready[1].status, { id: 'm2', status: 'ready', cost: 0.01 });
  const failed = applyChatEvent(messages, { type: 'error', messageId: 'm2', code: 'transport', message: 'Network down' });
  assert.deepEqual(failed[1].status, { id: 'm2', status: 'failed', message: 'Network down' });
  assert.equal(JSON.stringify(messages), before);
});

test('events for unknown messages or without messageId return the same list', () => {
  const messages = base();
  assert.equal(applyChatEvent(messages, { type: 'text-delta', messageId: 'x', delta: 'a' }), messages);
  assert.equal(applyChatEvent(messages, { type: 'error', code: 'policy', message: 'No key' }), messages);
  assert.equal(applyChatEvent(messages, { type: 'part-update', messageId: 'm2', toolCallId: 'missing', result: {} }), messages);
});

test('toThreadMessage maps all nine run statuses', () => {
  const expected = {
    queued: { type: 'running' }, running: { type: 'running' },
    ready: { type: 'complete', reason: 'stop' }, completed: { type: 'complete', reason: 'stop' }, applied: { type: 'complete', reason: 'stop' }, discarded: { type: 'complete', reason: 'stop' },
    failed: { type: 'incomplete', reason: 'error' }, cancelled: { type: 'incomplete', reason: 'cancelled' }, interrupted: { type: 'incomplete', reason: 'other' },
  };
  assert.deepEqual(Object.keys(RUN_STATUS).sort(), Object.keys(expected).sort());
  for (const [status, value] of Object.entries(expected)) {
    assert.deepEqual(toThreadMessage({ id: 'a', role: 'assistant', createdAt: '2026-10-02T10:00:00.000Z', parts: [], status: { id: 'a', status } }).status, value, status);
  }
});

test('toThreadMessage turns a card into a tool-call and keeps run metadata', () => {
  const run = { id: 'a', status: 'ready' };
  const message = toThreadMessage({ id: 'a', role: 'assistant', createdAt: '2026-10-02T10:00:00.000Z', parts: [{ type: 'text', text: 'Ok' }, { type: 'tool-call', toolCallId: 'a:1', toolName: 'audio', result: card }], status: run, cost: 0.02 });
  assert.deepEqual(message.content, [{ type: 'text', text: 'Ok' }, { type: 'tool-call', toolCallId: 'a:1', toolName: 'audio', args: {}, result: card }]);
  assert.ok(message.createdAt instanceof Date);
  assert.equal(message.metadata.custom.run, run);
  assert.equal(message.metadata.custom.cost, 0.02);
  const user = toThreadMessage({ id: 'u', role: 'user', createdAt: '2026-10-02T10:00:00.000Z', parts: [{ type: 'text', text: 'Hi' }], mentions: [{ kind: 'scene', id: 's1', label: 'Scene 1' }] });
  assert.equal(user.status, undefined);
  assert.equal(user.metadata.custom.mentions[0].id, 's1');
});

const input = { text: 'Make it shorter', mentions: [], attachments: [], scope: { kind: 'project' } };

test('without a thread the message creates one, reports it, then sends into it', async () => {
  const port = createFakeChatPort();
  const created = [];
  let sent = 0;
  const ok = await sendToPort(port, '', input, { onThreadCreated: id => { created.push(id); port.calls.push(['onThreadCreated', id]); }, onSent: () => sent++ });
  assert.equal(ok, true);
  assert.deepEqual(port.calls.map(call => call[0]), ['createThread', 'onThreadCreated', 'send']);
  assert.equal(port.calls[2][1], created[0]);
  assert.equal(port.messages(created[0]).get().length, 2);
  assert.equal(sent, 1);
});

test('with a thread the message is sent without creating another', async () => {
  const port = createFakeChatPort();
  const thread = await port.createThread();
  await sendToPort(port, thread.id, input);
  assert.deepEqual(port.calls.map(call => call[0]), ['createThread', 'send']);
});

test('a rejected send reaches onError with its code and onSent is not called', async () => {
  const port = createFakeChatPort();
  port.rejectSend = true;
  const errors = [];
  let sent = 0;
  const ok = await sendToPort(port, '', input, { onError: error => errors.push(error), onSent: () => sent++ });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'policy');
  assert.equal(sent, 0);
});

test('a rejected send into a thread created for it deletes that thread, returns the previous id and restores the input', async () => {
  const port = createFakeChatPort();
  port.rejectSend = true;
  const switched = [], restored = [], errors = [];
  const full = { ...input, mentions: [{ kind: 'scene', id: 'scene:s1', label: 'Scene 1' }], attachments: [{ name: 'a.txt', size: 3 }] };
  const ok = await sendToPort(port, '', full, { onThreadCreated: id => switched.push(id), onRestore: value => restored.push(value), onError: error => errors.push(error) });
  assert.equal(ok, false);
  const created = port.calls[0][1];
  assert.deepEqual(port.calls.map(call => call[0]), ['createThread', 'send', 'deleteThread']);
  assert.equal(port.calls[2][1], created);
  assert.deepEqual(switched, [created, '']);
  assert.deepEqual(port.threads.get(), []);
  assert.equal(restored.length, 1);
  assert.equal(restored[0], full);
  assert.equal(errors[0].code, 'policy');
});

test('a rejected send into an existing thread keeps the thread and restores the input', async () => {
  const port = createFakeChatPort();
  const thread = await port.createThread();
  port.rejectSend = true;
  const switched = [], restored = [];
  const ok = await sendToPort(port, thread.id, input, { onThreadCreated: id => switched.push(id), onRestore: value => restored.push(value) });
  assert.equal(ok, false);
  assert.deepEqual(port.calls.map(call => call[0]), ['createThread', 'send']);
  assert.deepEqual(switched, []);
  assert.deepEqual(restored, [input]);
  assert.equal(port.threads.get().length, 1);
});

test('continue passes the prompt to continueRun', async () => {
  const port = createFakeChatPort();
  const thread = await port.createThread();
  await port.send(thread.id, input);
  const runId = port.messages(thread.id).get()[1].id;
  port.finish('failed');
  await handleCardAction(port, runId, 'continue', {}, 'Use a warmer tone');
  assert.deepEqual(port.calls.at(-1), ['continueRun', runId, 'Use a warmer tone']);
});

test('card actions route to port methods', async () => {
  const port = createFakeChatPort();
  const thread = await port.createThread();
  await port.send(thread.id, input);
  const runId = port.messages(thread.id).get()[1].id;
  handleCardAction(port, runId, 'open', { type: 'diff', path: 'index.tpl' });
  handleCardAction(port, runId, 'open', { type: 'operation', label: 'Trim', target: { kind: 'scene', id: 's1', label: 'Scene 1' } });
  handleCardAction(port, runId, 'edit', { type: 'audio', name: 'voice.mp3' });
  assert.deepEqual(port.opened, [{ kind: 'file', id: 'index.tpl', label: 'index.tpl' }, { kind: 'scene', id: 's1', label: 'Scene 1' }, { kind: 'asset', id: 'voice.mp3', label: 'voice.mp3' }]);
  await handleCardAction(port, runId, 'answer', { type: 'question', questionId: 'q1', text: '?' }, 'rebase');
  await handleCardAction(port, runId, 'apply', { type: 'question', questionId: 'q1', text: '?' }, { allowStaleContext: true });
  await handleCardAction(port, runId, 'discard', { type: 'question', questionId: 'q1', text: '?' });
  await handleCardAction(port, runId, 'continue', { type: 'operation' });
  assert.deepEqual(port.calls.slice(2), [['answer', 'q1', 'rebase'], ['apply', runId, { allowStaleContext: true }], ['discard', runId], ['continueRun', runId, undefined]]);
});

test('actions without a port method are not offered and do nothing', () => {
  const port = createFakeChatPort();
  delete port.continueRun;
  delete port.answer;
  assert.equal(canHandleCardAction(port, 'continue'), false);
  assert.equal(canHandleCardAction(port, 'answer'), false);
  assert.equal(canHandleCardAction(port, 'open'), true);
  assert.equal(canHandleCardAction(port, 'unknown'), false);
  assert.equal(handleCardAction(port, 'r', 'continue', {}), undefined);
});

test('lineDiff isolates the changed lines with context', () => {
  const diff = lineDiff('a\nb\nc\nd\ne', 'a\nb\nX\nY\nd\ne');
  assert.deepEqual(diff, { leading: ['a', 'b'], removed: ['c'], added: ['X', 'Y'], trailing: ['d', 'e'] });
  assert.deepEqual(lineDiff('same', 'same').removed, []);
});

test('streamed text survives a new snapshot and is not duplicated once the snapshot carries text', () => {
  const snapshot = base();
  let streamed = {};
  for (const delta of ['Done ', 'Done ', 'Done ']) streamed = addStreamedText(streamed, snapshot, { type: 'text-delta', messageId: 'm2', delta });
  assert.deepEqual(mergeStreamedText(snapshot, streamed)[1].parts, [{ type: 'text', text: 'Done Done Done ' }]);
  assert.equal(mergeStreamedText(snapshot, streamed)[0], snapshot[0], 'untouched messages keep identity');
  // the port adds a card to its snapshot: the streamed text stays before it, a later delta starts a new segment after it
  const withCard = snapshot.with(1, { ...snapshot[1], parts: [{ type: 'tool-call', toolCallId: 'm2:0', toolName: 'audio', result: card }] });
  streamed = addStreamedText(streamed, withCard, { type: 'text-delta', messageId: 'm2', delta: 'More' });
  assert.deepEqual(mergeStreamedText(withCard, streamed)[1].parts.map(part => part.text ?? part.type), ['Done Done Done ', 'tool-call', 'More']);
  // the port switched to snapshots for this message: its text wins
  const final = snapshot.with(1, { ...snapshot[1], parts: [{ type: 'text', text: 'Final' }] });
  assert.deepEqual(mergeStreamedText(final, streamed)[1].parts, [{ type: 'text', text: 'Final' }]);
});

test('FakeChatPort: every events() call is an independent subscription and return() releases a pending next()', async () => {
  const port = createFakeChatPort();
  const thread = await port.createThread();
  const first = port.events(thread.id)[Symbol.asyncIterator](), second = port.events(thread.id)[Symbol.asyncIterator]();
  assert.equal(port.subscribers(thread.id), 2);
  await port.send(thread.id, { text: 'Hi', mentions: [], attachments: [], scope: { kind: 'project' } });
  assert.equal((await first.next()).value.type, 'status');
  assert.equal((await second.next()).value.type, 'status', 'both subscriptions receive the event');
  const pending = second.next();
  await second.return();
  assert.deepEqual(await pending, { value: undefined, done: true });
  assert.equal(port.subscribers(thread.id), 1);
  port.emitText('a');
  assert.deepEqual((await first.next()).value, { type: 'text-delta', messageId: port.messages(thread.id).get()[1].id, delta: 'a' });
  assert.equal(port.messages(thread.id).get()[1].parts.length, 0, 'emitText does not touch messages()');
});

test('deltas for a message missing from the snapshot are buffered until it appears, with a bound', () => {
  let streamed = {};
  streamed = addStreamedText(streamed, [], { type: 'text-delta', messageId: 'm2', delta: 'Hel' });
  streamed = addStreamedText(streamed, [], { type: 'text-delta', messageId: 'm2', delta: 'lo' });
  assert.deepEqual(mergeStreamedText([], streamed), [], 'nothing to show before the message exists');
  assert.deepEqual(mergeStreamedText(base(), streamed)[1].parts, [{ type: 'text', text: 'Hello' }], 'shown once the snapshot has the message');
  // once the message is known, later deltas extend the same segment
  streamed = addStreamedText(streamed, base(), { type: 'text-delta', messageId: 'm2', delta: '!' });
  assert.deepEqual(mergeStreamedText(base(), streamed)[1].parts, [{ type: 'text', text: 'Hello!' }]);
  // bound: at most 8 unknown messages are buffered, the oldest is dropped
  let many = {};
  for (let index = 0; index < 10; index++) many = addStreamedText(many, [], { type: 'text-delta', messageId: `x${index}`, delta: 'a' });
  assert.deepEqual(Object.keys(many), ['x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9']);
  assert.equal(addStreamedText(many, [], { type: 'text-delta', messageId: 'x9', delta: 'b'.repeat(64 * 1024) }), many, 'oversized buffer is refused');
  assert.equal(addStreamedText(many, [], { type: 'text-delta', delta: 'a' }), many, 'no messageId');
});

test('Discard: ready always; failed/interrupted/cancelled only with draft cards and capabilities.discardStopped; never without port.discard', () => {
  const port = { discard: async () => {}, capabilities: { discardStopped: true } }, plain = { discard: async () => {}, capabilities: {} };
  const card = toolName => ({ type: 'tool-call', toolCallId: `r:${toolName}`, toolName, result: {} });
  for (const type of ['diff', 'values', 'image', 'file']) assert.equal(hasDraftCards([{ type: 'text', text: 'x' }, card(type)]), true, type);
  for (const type of ['question', 'operation', 'audio', 'video']) assert.equal(hasDraftCards([card(type)]), false, type);
  assert.equal(hasDraftCards(undefined), false);
  assert.equal(canDiscardRun(port, 'ready', false), true); assert.equal(canDiscardRun(plain, 'ready', false), true, 'ready needs no capability');
  assert.equal(canDiscardRun({}, 'ready', true), false, 'ready without port.discard');
  for (const status of ['failed', 'interrupted', 'cancelled']) {
    assert.equal(canDiscardRun(port, status, true), true, `${status} with drafts`);
    assert.equal(canDiscardRun(port, status, false), false, `${status} without drafts`);
    assert.equal(canDiscardRun({ capabilities: { discardStopped: true } }, status, true), false, `${status} without port.discard`);
    assert.equal(canDiscardRun(plain, status, true), false, `${status} with drafts but without discardStopped`);
  }
  for (const status of ['queued', 'running', 'completed', 'applied', 'discarded']) assert.equal(canDiscardRun(port, status, true), false, status);
});
