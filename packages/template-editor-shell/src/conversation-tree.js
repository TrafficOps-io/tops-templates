// Conversation tree (spec 2.3). Nodes are user messages and runs (a run is the
// assistant answer of the chat port: its id is the assistant message id).
// - A user message's parent is message.parentId: a run, a user message without
//   a run (legacy recovery), or null for a root.
// - A run's parent is its user message (run.messageId); regenerated answers are
//   runs with the same messageId.
// - Clarifications sent during a run are attached to that run (parentId = runId)
//   and are not branch nodes; persisted assistant summaries (role 'assistant')
//   belong to their run.
// thread.activeLeafId is the node the visible path ends at (the path then
// continues to the newest leaf below it). Documents written before the tree
// have no parentId: the parent is inferred from the linear order, so linear
// histories keep exactly their previous order.

const ROOT = '\u0000root';

/** A user message that steered a running run instead of starting one. */
export function isClarification(message, runsById) {
  if (message?.role !== 'user') return false;
  if (message.status === 'queued-clarification') return true;
  const run = typeof message.runId === 'string' ? runsById.get(message.runId) : undefined;
  return Boolean(run && run.messageId !== message.id);
}

/** Parents of user messages: stored parentId, else inferred from the linear order (pre-tree documents). */
function parentsOf(thread, runs, runsById) {
  const parents = new Map(), newestRun = new Map();
  for (const run of runs) newestRun.set(run.messageId, run.id);
  let previous = null;
  for (const message of thread.messages || []) {
    if (message?.role !== 'user' || typeof message.id !== 'string') continue;
    if (isClarification(message, runsById)) { parents.set(message.id, { clarifies: message.parentId ?? message.runId }); continue; }
    parents.set(message.id, { parentId: message.parentId !== undefined ? message.parentId : previous });
    previous = newestRun.get(message.id) || message.id;
  }
  return parents;
}

/** Tree of one thread. runs — the document runs (any thread; filtered here). */
export function conversationTree(thread, allRuns = []) {
  const runs = allRuns.filter(run => run.threadId === thread.id), runsById = new Map(runs.map(run => [run.id, run]));
  const parents = parentsOf(thread, runs, runsById), nodes = new Map(), children = new Map(), attached = new Map();
  const add = (parentKey, id) => { if (!children.has(parentKey)) children.set(parentKey, []); children.get(parentKey).push(id); };
  (thread.messages || []).forEach((message, index) => {
    const parent = parents.get(message?.id);
    if (!parent || parent.clarifies !== undefined) return;
    nodes.set(message.id, { id: message.id, kind: 'user', parentId: parent.parentId ?? null, message, createdAt: message.createdAt ?? 0, order: index });
  });
  runs.forEach((run, index) => {
    if (nodes.get(run.messageId)?.kind !== 'user') return;
    nodes.set(run.id, { id: run.id, kind: 'run', parentId: run.messageId, run, createdAt: run.createdAt ?? 0, order: index });
  });
  // A parent that no longer exists (or is not a node) makes the message a root.
  for (const node of nodes.values()) {
    if (node.parentId !== null && !nodes.has(node.parentId)) node.parentId = null;
    add(node.parentId ?? ROOT, node.id);
  }
  const rank = id => { const node = nodes.get(id); return [node.createdAt, node.kind === 'user' ? 0 : 1, node.order]; };
  for (const list of children.values()) list.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  // Messages attached to a run (clarifications and the persisted assistant summary), in document order.
  for (const message of thread.messages || []) {
    const parent = parents.get(message?.id), runId = parent?.clarifies !== undefined ? parent.clarifies : message?.role === 'assistant' ? message.runId : undefined;
    if (typeof runId !== 'string' || !runsById.has(runId)) continue;
    if (!attached.has(runId)) attached.set(runId, []);
    attached.get(runId).push(message);
  }
  return { thread, nodes, children: key => children.get(key ?? ROOT) || [], attached: runId => attached.get(runId) || [], parents };
}

/** The newest leaf under id (id itself when it has no children). */
export function newestLeaf(tree, id) {
  const seen = new Set();
  let current = id;
  for (let kids = tree.children(current); kids.length && !seen.has(current); kids = tree.children(current)) { seen.add(current); current = kids.at(-1); }
  return current;
}

/** Node ids from id up to its root, root first. */
export function ancestry(tree, id) {
  const path = [], seen = new Set();
  for (let current = id; current != null && tree.nodes.has(current) && !seen.has(current); current = tree.nodes.get(current).parentId) { seen.add(current); path.unshift(current); }
  return path;
}

/** The visible path: root → active leaf → newest leaf below it. Without a valid active leaf, the newest root's newest leaf. */
export function visiblePath(tree, activeLeafId = tree.thread.activeLeafId) {
  let start = typeof activeLeafId === 'string' && tree.nodes.has(activeLeafId) ? activeLeafId : null;
  if (!start) { const roots = tree.children(null); if (!roots.length) return []; start = roots.at(-1); }
  return ancestry(tree, newestLeaf(tree, start));
}

/** Position among siblings (same parent), as port.d.ts MessageBranch. */
export function branchOf(tree, id) {
  const node = tree.nodes.get(id); if (!node) return null;
  const siblingIds = [...tree.children(node.parentId)];
  return { index: siblingIds.indexOf(id), count: siblingIds.length, siblingIds };
}

/** The nearest run at or above id (the run whose draft a follow-up continues). */
export function nearestRun(tree, id) {
  for (const nodeId of ancestry(tree, id).reverse()) { const node = tree.nodes.get(nodeId); if (node.kind === 'run') return node.run; }
  return undefined;
}

/** Newest run answering a user message. */
export const newestRunOf = (tree, messageId) => tree.children(messageId).map(id => tree.nodes.get(id)).filter(node => node.kind === 'run').at(-1)?.run;

/**
 * Earlier messages of the branch that leads to messageId (excluded), root first: user messages, then for each run its
 * clarifications and persisted assistant summary in document order. Other branches never enter the history.
 */
export function branchHistory(tree, messageId) {
  const out = [];
  for (const id of ancestry(tree, messageId).slice(0, -1)) {
    const node = tree.nodes.get(id);
    if (node.kind === 'user') out.push(node.message); else out.push(...tree.attached(id));
  }
  return out;
}

/** Writes inferred parentIds into a pre-tree thread (in place). Existing parentIds are kept. */
export function normalizeThreadTree(thread, runs = []) {
  if (!Array.isArray(thread?.messages)) return thread;
  const own = runs.filter(run => run.threadId === thread.id), parents = parentsOf(thread, own, new Map(own.map(run => [run.id, run])));
  for (const message of thread.messages) {
    const parent = parents.get(message?.id);
    if (!parent || message.parentId !== undefined) continue;
    message.parentId = parent.clarifies !== undefined ? parent.clarifies ?? null : parent.parentId;
  }
  return thread;
}
