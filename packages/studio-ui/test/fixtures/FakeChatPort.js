// In-memory ChatPort (chat/port.d.ts) for Node tests and the browser playground.
// Test controls: emitText(delta), emitCard(card), updateCard(toolCallId, patch), finish(status?), rejectSend, calls, opened,
// subscribers(threadId) — number of live events() subscriptions, rejectBranching — regenerate/editMessage/switchBranch reject.
// The conversation is a tree (Message.parentId): messages(threadId) is the visible path from the root to the head leaf,
// every message on it carries branch { index, count, siblingIds } among the messages with the same parentId.

const MiB = 1024 * 1024;

function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { value = next; for (const listener of [...listeners]) listener(value); },
  };
}

// One event channel per thread; every events(threadId) call is an independent subscription (contract):
// it receives events emitted after the call, and return() ends it and releases a pending next().
function createChannel() {
  const subscribers = new Set();
  let closed = false;
  return {
    push(event) { if (!closed) for (const subscriber of subscribers) subscriber.push(event); },
    close() { closed = true; for (const subscriber of [...subscribers]) subscriber.end(); },
    get size() { return subscribers.size; },
    [Symbol.asyncIterator]() {
      const buffer = [], waiting = [];
      let done = closed;
      const subscriber = {
        push(event) { const next = waiting.shift(); if (next) next({ value: event, done: false }); else buffer.push(event); },
        end() { done = true; subscribers.delete(subscriber); for (const next of waiting.splice(0)) next({ value: undefined, done: true }); },
      };
      if (!done) subscribers.add(subscriber);
      return {
        next: () => buffer.length ? Promise.resolve({ value: buffer.shift(), done: false })
          : done ? Promise.resolve({ value: undefined, done: true })
          : new Promise(resolve => waiting.push(resolve)),
        return: () => { subscriber.end(); buffer.length = 0; return Promise.resolve({ value: undefined, done: true }); },
      };
    },
  };
}

const MENTION_TARGETS = [
  { kind: 'section', id: 'section:script', label: 'Script' },
  { kind: 'section', id: 'section:timeline', label: 'Timeline' },
  { kind: 'scene', id: 'scene:s1', label: 'Scene 1', detail: 'Opening' },
  { kind: 'scene', id: 'scene:s2', label: 'Scene 2', detail: 'Product' },
  { kind: 'track', id: 'track:music', label: 'Music track' },
  { kind: 'asset', id: 'asset:a1', label: 'logo.png', detail: 'image' },
  { kind: 'field', id: 'field:title', label: 'Title' },
];

export function createFakeChatPort({ now = () => new Date().toISOString() } = {}) {
  let sequence = 0;
  const nextId = prefix => `${prefix}${++sequence}`;
  const threads = createStore([]);
  const messageStores = new Map();
  const trees = new Map(); // threadId → { all: Message[] in creation order, head: id | null }
  const queues = new Map();
  let active = null; // { threadId, messageId }

  const messagesStore = threadId => {
    if (!messageStores.has(threadId)) messageStores.set(threadId, createStore([]));
    return messageStores.get(threadId);
  };
  const tree = threadId => {
    if (!trees.has(threadId)) trees.set(threadId, { all: [], head: null });
    return trees.get(threadId);
  };
  // Visible path: from the head leaf up through parentId, then each message gets its place among its siblings.
  const publish = threadId => {
    const { all, head } = tree(threadId);
    const byId = new Map(all.map(message => [message.id, message]));
    const path = [];
    for (let message = byId.get(head); message; message = byId.get(message.parentId)) path.unshift(message);
    messagesStore(threadId).set(path.map(message => {
      const siblingIds = all.filter(item => item.parentId === message.parentId).map(item => item.id);
      return { ...message, branch: { index: siblingIds.indexOf(message.id), count: siblingIds.length, siblingIds } };
    }));
  };
  const addMessages = (threadId, ...messages) => { const state = tree(threadId); state.all.push(...messages); state.head = messages.at(-1).id; publish(threadId); };
  // The most recent leaf under a message: follow the newest child down.
  const latestLeaf = (threadId, id) => {
    const { all } = tree(threadId);
    let current = id;
    for (let child; (child = all.findLast(item => item.parentId === current));) current = child.id;
    return current;
  };
  const findMessage = (threadId, messageId) => tree(threadId).all.find(message => message.id === messageId);
  const newRun = (parentId, at) => { const id = nextId('m'); return { id, role: 'assistant', createdAt: at, parentId, parts: [], status: { id, status: 'running' } }; };
  const queue = threadId => {
    if (!queues.has(threadId)) queues.set(threadId, createChannel());
    return queues.get(threadId);
  };
  const emit = (threadId, event) => queue(threadId).push(event);
  const findRun = runId => {
    for (const [threadId, state] of trees) {
      const message = state.all.find(item => item.id === runId);
      if (message) return { threadId, message };
    }
    return null;
  };
  const patchMessage = (threadId, messageId, patch) => {
    const state = tree(threadId);
    state.all = state.all.map(message => message.id === messageId ? { ...message, ...patch(message) } : message);
    publish(threadId);
  };
  const setStatus = (runId, status, extra = {}) => {
    const run = findRun(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const state = { ...run.message.status, id: runId, status, ...extra };
    patchMessage(run.threadId, runId, () => ({ status: state }));
    emit(run.threadId, { type: 'status', messageId: runId, status: state });
  };
  const requireActive = () => { if (!active) throw new Error('No running assistant message'); return active; };

  const port = {
    calls: [],
    opened: [],
    rejectSend: false,
    threads,
    messages: threadId => messagesStore(threadId),
    events: threadId => ({ [Symbol.asyncIterator]: () => queue(threadId)[Symbol.asyncIterator]() }),
    subscribers: threadId => queues.get(threadId)?.size ?? 0,
    async createThread() {
      const at = now();
      const thread = { id: nextId('t'), title: 'New chat', createdAt: at, updatedAt: at };
      threads.set([thread, ...threads.get()]);
      messagesStore(thread.id);
      port.calls.push(['createThread', thread.id]);
      return thread;
    },
    async send(threadId, input) {
      port.calls.push(['send', threadId, input]);
      if (port.rejectSend) throw Object.assign(new Error('AI key is not configured.'), { code: 'policy' });
      const at = now();
      const user = { id: nextId('m'), role: 'user', createdAt: at, parentId: tree(threadId).head, parts: [{ type: 'text', text: input.text }], mentions: input.mentions, attachments: input.attachments.map(file => ({ id: nextId('f'), name: file.name, type: 'document', bytes: file.size })) };
      const assistant = newRun(user.id, at);
      addMessages(threadId, user, assistant);
      active = { threadId, messageId: assistant.id };
      emit(threadId, { type: 'status', messageId: assistant.id, status: assistant.status });
    },
    // A sibling of the assistant message (same parentId) becomes the head and runs.
    async regenerate(threadId, messageId) {
      port.calls.push(['regenerate', threadId, messageId]);
      if (port.rejectBranching) throw new Error('Regenerate rejected by the port');
      const source = findMessage(threadId, messageId);
      if (source?.role !== 'assistant') throw new Error(`Unknown assistant message ${messageId}`);
      const assistant = newRun(source.parentId, now());
      addMessages(threadId, assistant);
      active = { threadId, messageId: assistant.id };
      emit(threadId, { type: 'status', messageId: assistant.id, status: assistant.status });
    },
    // A sibling of the user message with the new text (mentions and attachments of the original) and a new run after it.
    async editMessage(threadId, messageId, input) {
      port.calls.push(['editMessage', threadId, messageId, input]);
      if (port.rejectBranching) throw new Error('Edit rejected by the port');
      const source = findMessage(threadId, messageId);
      if (source?.role !== 'user') throw new Error(`Unknown user message ${messageId}`);
      const at = now();
      const user = { ...source, id: nextId('m'), createdAt: at, parts: [{ type: 'text', text: input.text }] };
      delete user.branch;
      const assistant = newRun(user.id, at);
      addMessages(threadId, user, assistant);
      active = { threadId, messageId: assistant.id };
      emit(threadId, { type: 'status', messageId: assistant.id, status: assistant.status });
    },
    async switchBranch(threadId, messageId) {
      port.calls.push(['switchBranch', threadId, messageId]);
      if (port.rejectBranching) throw new Error('Switch rejected by the port');
      if (!findMessage(threadId, messageId)) throw new Error(`Unknown message ${messageId}`);
      tree(threadId).head = latestLeaf(threadId, messageId);
      publish(threadId);
    },
    // Text goes one way only (contract rule): this port streams deltas, so emitText sends the event and leaves messages() untouched.
    emitText(delta) {
      const { threadId, messageId } = requireActive();
      emit(threadId, { type: 'text-delta', messageId, delta });
    },
    emitCard(card) {
      const { threadId, messageId } = requireActive();
      let part;
      patchMessage(threadId, messageId, message => {
        part = { type: 'tool-call', toolCallId: `${messageId}:${message.parts.length}`, toolName: card.type, result: card };
        return { parts: [...message.parts, part] };
      });
      emit(threadId, { type: 'part-start', messageId, part });
      return part.toolCallId;
    },
    updateCard(toolCallId, patch) {
      const { threadId, messageId } = requireActive();
      patchMessage(threadId, messageId, message => ({ parts: message.parts.map(part => part.type === 'tool-call' && part.toolCallId === toolCallId ? { ...part, result: { ...part.result, ...patch } } : part) }));
      emit(threadId, { type: 'part-update', messageId, toolCallId, result: patch });
    },
    // extra: RunState fields (cost, message); a run cost is added to the thread total (Thread.cost).
    finish(status = 'ready', extra = {}) {
      const { threadId, messageId } = requireActive();
      setStatus(messageId, status, extra);
      if (Number.isFinite(extra.cost)) threads.set(threads.get().map(thread => thread.id === threadId ? { ...thread, cost: (thread.cost ?? 0) + extra.cost } : thread));
      active = null;
    },
    async stop(runId) { port.calls.push(['stop', runId]); setStatus(runId, 'cancelled'); if (active?.messageId === runId) active = null; },
    async apply(runId, options) { port.calls.push(['apply', runId, options]); setStatus(runId, 'applied'); },
    async discard(runId) { port.calls.push(['discard', runId]); setStatus(runId, 'discarded'); },
    async answer(questionId, answer) {
      port.calls.push(['answer', questionId, answer]);
      for (const [threadId, state] of trees) for (const message of state.all) {
        if (message.parts.some(part => part.type === 'tool-call' && part.result.type === 'question' && part.result.questionId === questionId)) {
          patchMessage(threadId, message.id, current => ({ parts: current.parts.map(part => part.type === 'tool-call' && part.result.questionId === questionId ? { ...part, result: { ...part.result, answered: true } } : part) }));
        }
      }
    },
    async continueRun(runId, prompt) {
      port.calls.push(['continueRun', runId, prompt]);
      const run = findRun(runId);
      setStatus(runId, 'running');
      active = { threadId: run.threadId, messageId: runId };
    },
    async keepDraft(runId) { port.calls.push(['keepDraft', runId]); },
    async renameThread(threadId, title) { port.calls.push(['renameThread', threadId, title]); threads.set(threads.get().map(thread => thread.id === threadId ? { ...thread, title, updatedAt: now() } : thread)); },
    async archiveThread(threadId, archived) { port.calls.push(['archiveThread', threadId, archived]); threads.set(threads.get().map(thread => thread.id === threadId ? { ...thread, archived, updatedAt: now() } : thread)); },
    async deleteThread(threadId) { port.calls.push(['deleteThread', threadId]); threads.set(threads.get().filter(thread => thread.id !== threadId)); messageStores.delete(threadId); trees.delete(threadId); queues.get(threadId)?.close(); queues.delete(threadId); },
    mentionTargets(query, kind) {
      const needle = query.trim().toLowerCase();
      return MENTION_TARGETS.filter(target => (!kind || target.kind === kind) && (!needle || target.label.toLowerCase().includes(needle)));
    },
    openTarget(target) { port.opened.push(target); },
    attachmentLimits: { count: 10, bytesPerFile: 512 * MiB, bytesTotal: 5 * 1024 * MiB, accept: 'image/*,audio/*,video/*,.docx,.txt' },
    capabilities: { scopes: ['project', 'scene', 'audio', 'script'], cost: true, previewDraft: false, generateImages: false, conflictReview: true, keepDraft: true },
    dispose() { for (const item of queues.values()) item.close(); queues.clear(); },
  };
  return port;
}

export default createFakeChatPort;
