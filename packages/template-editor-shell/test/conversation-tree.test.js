import test from 'node:test';
import assert from 'node:assert/strict';
import { branchHistory, branchOf, conversationTree, nearestRun, newestLeaf, normalizeThreadTree, visiblePath } from '../src/conversation-tree.js';

const user = (id, extra = {}) => ({ id, role: 'user', prompt: id, createdAt: extra.createdAt ?? 1, status: 'saved', runId: `r-${id}`, ...extra });
const run = (id, messageId, extra = {}) => ({ id, threadId: 't', messageId, state: 'ready', createdAt: extra.createdAt ?? 1, ...extra });
// A linear pre-tree history: two requests, a clarification during the first run, persisted assistant summaries.
const linear = () => ({
  thread: { id: 't', messages: [user('u1', { runId: 'r1' }), user('c1', { status: 'queued-clarification', runId: 'r1', createdAt: 2 }), { id: 'a1', role: 'assistant', prompt: 'Done 1', runId: 'r1', createdAt: 3 }, user('u2', { runId: 'r2', createdAt: 4 }), { id: 'a2', role: 'assistant', prompt: 'Done 2', runId: 'r2', createdAt: 5 }] },
  runs: [run('r1', 'u1'), run('r2', 'u2', { createdAt: 4 }), run('other', 'x', { threadId: 'elsewhere' })],
});

test('a pre-tree linear history keeps its order: parents are inferred, clarifications hang off their run', () => {
  const { thread, runs } = linear(), tree = conversationTree(thread, runs);
  assert.deepEqual(visiblePath(tree), ['u1', 'r1', 'u2', 'r2']);
  assert.equal(tree.nodes.get('u2').parentId, 'r1'); assert.equal(tree.nodes.has('c1'), false, 'a clarification is not a branch node');
  assert.deepEqual(tree.attached('r1').map(message => message.id), ['c1', 'a1']);
  assert.deepEqual(branchOf(tree, 'r2'), { index: 0, count: 1, siblingIds: ['r2'] });
  assert.deepEqual(branchHistory(tree, 'u2').map(message => message.prompt), ['u1', 'c1', 'Done 1']);
});

test('normalization writes the inferred parents without changing explicit ones and is idempotent', () => {
  const { thread, runs } = linear();
  normalizeThreadTree(thread, runs);
  assert.deepEqual(thread.messages.filter(message => message.role === 'user').map(message => [message.id, message.parentId]), [['u1', null], ['c1', 'r1'], ['u2', 'r1']]);
  assert.equal(thread.messages.find(message => message.id === 'a1').parentId, undefined, 'assistant summaries stay attached through runId');
  const once = structuredClone(thread); normalizeThreadTree(thread, runs); assert.deepEqual(thread, once);
  assert.deepEqual(visiblePath(conversationTree(thread, runs)), ['u1', 'r1', 'u2', 'r2']);
});

test('siblings, the active leaf and the newest leaf decide the visible path', () => {
  const { thread, runs } = linear(); normalizeThreadTree(thread, runs);
  // r1b regenerates the first answer; u2b edits the second question.
  runs.push(run('r1b', 'u1', { createdAt: 6 }));
  thread.messages.push(user('u2b', { parentId: 'r1', runId: 'r2b', createdAt: 7 })); runs.push(run('r2b', 'u2b', { createdAt: 7 }));
  let tree = conversationTree(thread, runs);
  assert.deepEqual(visiblePath(tree), ['u1', 'r1b'], 'without an active leaf the newest branch is shown');
  assert.deepEqual(branchOf(tree, 'r1b'), { index: 1, count: 2, siblingIds: ['r1', 'r1b'] });
  assert.equal(newestLeaf(tree, 'r1'), 'r2b');
  thread.activeLeafId = 'r2'; tree = conversationTree(thread, runs);
  assert.deepEqual(visiblePath(tree), ['u1', 'r1', 'u2', 'r2']);
  assert.deepEqual(branchOf(tree, 'u2'), { index: 0, count: 2, siblingIds: ['u2', 'u2b'] });
  thread.activeLeafId = 'u2b'; tree = conversationTree(thread, runs);
  assert.deepEqual(visiblePath(tree), ['u1', 'r1', 'u2b', 'r2b'], 'the path continues from the active node to its newest leaf');
  assert.equal(nearestRun(tree, 'u2b').id, 'r1'); assert.equal(nearestRun(tree, 'u1'), undefined);
  assert.deepEqual(branchHistory(tree, 'u2b').map(message => message.prompt), ['u1', 'c1', 'Done 1'], 'history never includes a sibling branch');
  thread.activeLeafId = 'missing'; assert.deepEqual(visiblePath(conversationTree(thread, runs)), ['u1', 'r1b'], 'an unknown leaf falls back to the newest branch');
});

test('dangling parents become roots and cycles do not hang', () => {
  const thread = { id: 't', messages: [user('a', { parentId: 'gone' }), user('b', { parentId: 'c', createdAt: 2 }), user('c', { parentId: 'b', createdAt: 3 })] };
  const tree = conversationTree(thread, []);
  assert.equal(tree.nodes.get('a').parentId, null);
  assert.ok(visiblePath(tree).length >= 1);
});
