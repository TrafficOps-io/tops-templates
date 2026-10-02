import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_CARD_TYPES, branchSibling, canEdit, canRegenerate, canRetryRun, canSwitchBranch, hasDraftCards, resolveEdit, resolveReloadTarget, toThreadMessage } from '../src/chat/chat-model.js';
import { createFakeChatPort } from './fixtures/FakeChatPort.js';

const at = '2026-10-02T10:00:00.000Z';
const visible = [
  { id: 'u1', role: 'user', createdAt: at, parentId: null, parts: [{ type: 'text', text: 'Hi' }] },
  { id: 'a1', role: 'assistant', createdAt: at, parentId: 'u1', parts: [], status: { id: 'a1', status: 'completed' } },
  { id: 'u2', role: 'user', createdAt: at, parentId: 'a1', parts: [{ type: 'text', text: 'Shorter' }] },
  { id: 'a2', role: 'assistant', createdAt: at, parentId: 'u2', parts: [], status: { id: 'a2', status: 'failed' } },
];
const noop = async () => {};

test('regenerate, edit and branches are offered only with the port method, and a false capability hides them', () => {
  assert.equal(canRegenerate({ regenerate: noop, capabilities: {} }), true);
  assert.equal(canRegenerate({ regenerate: noop, capabilities: { regenerate: true } }), true);
  assert.equal(canRegenerate({ regenerate: noop, capabilities: { regenerate: false } }), false, 'capability false hides it');
  assert.equal(canRegenerate({ capabilities: { regenerate: true } }), false, 'no method');
  assert.equal(canRegenerate(undefined), false);
  assert.equal(canEdit({ editMessage: noop, capabilities: {} }), true);
  assert.equal(canEdit({ editMessage: noop, capabilities: { edit: false } }), false);
  assert.equal(canEdit({ regenerate: noop, capabilities: { edit: true } }), false);
  const branch = { index: 0, count: 2, siblingIds: ['a1', 'a3'] };
  assert.equal(canSwitchBranch({ switchBranch: noop, capabilities: {} }, branch), true);
  assert.equal(canSwitchBranch({ switchBranch: noop, capabilities: { branches: false } }, branch), false);
  assert.equal(canSwitchBranch({ capabilities: {} }, branch), false, 'no method');
  assert.equal(canSwitchBranch({ switchBranch: noop, capabilities: {} }, { index: 0, count: 1, siblingIds: ['a1'] }), false, 'a single branch has no picker');
  assert.equal(canSwitchBranch({ switchBranch: noop, capabilities: {} }, undefined), false);
  assert.equal(canSwitchBranch({ switchBranch: noop, capabilities: {} }, { index: 2, count: 2, siblingIds: ['a', 'b'] }), false, 'index out of range');
  assert.equal(canSwitchBranch({ switchBranch: noop, capabilities: {} }, { index: 0, count: 3, siblingIds: ['a', 'b'] }), false, 'count does not match the ids');
});

test('branchSibling steps to the previous and next sibling and stops at the edges', () => {
  const branch = { index: 1, count: 3, siblingIds: ['a', 'b', 'c'] };
  assert.equal(branchSibling(branch, -1), 'a');
  assert.equal(branchSibling(branch, 1), 'c');
  assert.equal(branchSibling({ ...branch, index: 0 }, -1), null);
  assert.equal(branchSibling({ ...branch, index: 2 }, 1), null);
  assert.equal(branchSibling(undefined, 1), null);
});

test('Retry is offered for failed, interrupted and cancelled runs when the port regenerates', () => {
  const port = { regenerate: noop, capabilities: {} };
  for (const status of ['failed', 'interrupted', 'cancelled']) assert.equal(canRetryRun(port, status), true, status);
  for (const status of ['queued', 'running', 'ready', 'completed', 'applied', 'discarded']) assert.equal(canRetryRun(port, status), false, status);
  assert.equal(canRetryRun({ capabilities: {} }, 'failed'), false, 'without port.regenerate');
  assert.equal(canRetryRun({ regenerate: noop, capabilities: { regenerate: false } }, 'failed'), false);
});

test('resolveReloadTarget prefers the source assistant message, otherwise the first assistant after parentId', () => {
  assert.equal(resolveReloadTarget(visible, 'u2', 'a2'), 'a2');
  assert.equal(resolveReloadTarget(visible, 'u1', 'a1'), 'a1');
  assert.equal(resolveReloadTarget(visible, 'u2', undefined), 'a2', 'the assistant message after parentId');
  assert.equal(resolveReloadTarget(visible, 'u1', null), 'a1');
  assert.equal(resolveReloadTarget(visible, null, null), 'a1', 'parentId null — from the start');
  assert.equal(resolveReloadTarget(visible, 'u2', 'u1'), 'a2', 'a user sourceId falls back to parentId');
  assert.equal(resolveReloadTarget(visible, 'missing', null), null, 'unknown parent');
  assert.equal(resolveReloadTarget(visible, 'a2', null), null, 'nothing after the last message');
  assert.equal(resolveReloadTarget([], null, null), null);
});

test('resolveEdit maps an edit AppendMessage to the edited user message and its new text', () => {
  const message = { role: 'user', parentId: 'a1', sourceId: 'u2', content: [{ type: 'text', text: 'Even shorter' }] };
  assert.deepEqual(resolveEdit(visible, message), { messageId: 'u2', text: 'Even shorter' });
  assert.equal(resolveEdit(visible, { ...message, sourceId: 'a2' }), null, 'only user messages are edited');
  assert.equal(resolveEdit(visible, { ...message, sourceId: null }), null, 'a new message is not an edit');
  assert.equal(resolveEdit(visible, { ...message, sourceId: 'gone' }), null);
});

test('toThreadMessage carries parentId and branch in metadata.custom', () => {
  const branch = { index: 1, count: 2, siblingIds: ['a1', 'a3'] };
  const message = toThreadMessage({ ...visible[1], id: 'a3', branch });
  assert.equal(message.metadata.custom.parentId, 'u1');
  assert.equal(message.metadata.custom.branch, branch);
});

test('a step card is not a draft card', () => {
  assert.equal(DRAFT_CARD_TYPES.has('step'), false);
  assert.equal(hasDraftCards([{ type: 'tool-call', toolCallId: 'a:0', toolName: 'step', result: { type: 'step', label: 'Read scene 2', status: 'done' } }]), false);
});

test('FakeChatPort keeps a tree: regenerate and edit add siblings, switchBranch shows the latest leaf of a branch', async () => {
  const port = createFakeChatPort();
  const { id } = await port.createThread();
  const list = () => port.messages(id).get();
  await port.send(id, { text: 'Hi', mentions: [{ kind: 'scene', id: 's1', label: 'Scene 1' }], attachments: [], scope: { kind: 'project' } });
  port.finish('completed');
  const [user, first] = list();
  assert.equal(user.parentId, null);
  assert.equal(first.parentId, user.id);
  assert.deepEqual(first.branch, { index: 0, count: 1, siblingIds: [first.id] });

  await port.regenerate(id, first.id);
  const second = list()[1];
  assert.notEqual(second.id, first.id);
  assert.equal(second.parentId, user.id, 'the new answer is a sibling');
  assert.deepEqual(second.branch, { index: 1, count: 2, siblingIds: [first.id, second.id] });
  assert.equal(second.status.status, 'running');
  port.finish('completed');

  await port.send(id, { text: 'Shorter', mentions: [], attachments: [], scope: { kind: 'project' } });
  port.finish('completed');
  assert.equal(list().length, 4);
  await port.switchBranch(id, first.id);
  assert.deepEqual(list().map(message => message.id), [user.id, first.id], 'the first answer has no follow-up');
  await port.switchBranch(id, second.id);
  assert.equal(list().length, 4, 'the latest leaf under the second answer');

  await port.editMessage(id, user.id, { text: 'Hello' });
  const [edited, answer] = list();
  assert.equal(list().length, 2);
  assert.equal(edited.parts[0].text, 'Hello');
  assert.deepEqual(edited.mentions, user.mentions, 'mentions of the original');
  assert.deepEqual(edited.branch.siblingIds, [user.id, edited.id]);
  assert.equal(answer.parentId, edited.id);
  assert.deepEqual(port.calls.filter(([name]) => ['regenerate', 'editMessage', 'switchBranch'].includes(name)).map(([name]) => name), ['regenerate', 'switchBranch', 'switchBranch', 'editMessage']);
});
