// In-memory ChatPort (chat/port.d.ts) for Node tests and the browser playground.
// Test controls: emitText(delta), emitCard(card), updateCard(toolCallId, patch), finish(status?), rejectSend, calls, opened,
// subscribers(threadId) — number of live events() subscriptions.

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
  const queues = new Map();
  let active = null; // { threadId, messageId }

  const messagesStore = threadId => {
    if (!messageStores.has(threadId)) messageStores.set(threadId, createStore([]));
    return messageStores.get(threadId);
  };
  const queue = threadId => {
    if (!queues.has(threadId)) queues.set(threadId, createChannel());
    return queues.get(threadId);
  };
  const emit = (threadId, event) => queue(threadId).push(event);
  const findRun = runId => {
    for (const [threadId, store] of messageStores) {
      const message = store.get().find(item => item.id === runId);
      if (message) return { threadId, store, message };
    }
    return null;
  };
  const patchMessage = (threadId, messageId, patch) => {
    const store = messagesStore(threadId);
    store.set(store.get().map(message => message.id === messageId ? { ...message, ...patch(message) } : message));
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
      const user = { id: nextId('m'), role: 'user', createdAt: at, parts: [{ type: 'text', text: input.text }], mentions: input.mentions, attachments: input.attachments.map(file => ({ id: nextId('f'), name: file.name, type: 'document', bytes: file.size })) };
      const assistantId = nextId('m');
      const assistant = { id: assistantId, role: 'assistant', createdAt: at, parts: [], status: { id: assistantId, status: 'running' } };
      const store = messagesStore(threadId);
      store.set([...store.get(), user, assistant]);
      active = { threadId, messageId: assistantId };
      emit(threadId, { type: 'status', messageId: assistantId, status: assistant.status });
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
      for (const [threadId, store] of messageStores) for (const message of store.get()) {
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
    async deleteThread(threadId) { port.calls.push(['deleteThread', threadId]); threads.set(threads.get().filter(thread => thread.id !== threadId)); messageStores.delete(threadId); queues.get(threadId)?.close(); queues.delete(threadId); },
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
