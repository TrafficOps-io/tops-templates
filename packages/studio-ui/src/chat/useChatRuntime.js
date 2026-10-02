import { useEffect, useMemo, useState } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';
import { addStreamedText, appendMessageText, applyChatEvent, isActiveRun, mergeStreamedText, sendToPort, toThreadMessage } from './chat-model.js';

export { applyChatEvent, toThreadMessage, RUN_STATUS } from './chat-model.js';

const PROJECT_SCOPE = { kind: 'project' };

// assistant-ui external-store runtime over a ChatPort (chat/port.d.ts).
// threadId empty — a new conversation: on the first message the port's createThread() returns a real thread,
// onThreadCreated(id) lets StudioChat switch to it, and the message is sent into that thread.
export function useChatRuntime(port, threadId, { scope = PROJECT_SCOPE, mentions = [], attachments = [], generateImages, onSent, onThreadCreated, onError } = {}) {
  // base: the port's snapshot plus idempotent events (status, part-*); streamed: text-delta segments kept beside it.
  // Keyed by threadId so a thread switch renders the new snapshot at once, without an empty frame.
  const read = id => ({ threadId: id, base: id ? port.messages(id).get() : [], streamed: {} });
  const [stored, setState] = useState(() => read(threadId));
  const state = stored.threadId === threadId ? stored : read(threadId);
  useEffect(() => {
    if (!threadId) { setState(read('')); return undefined; }
    const store = port.messages(threadId);
    setState(read(threadId));
    const update = change => setState(current => (current.threadId === threadId ? change(current) : current));
    // Defensive: the contract passes the value to the listener, but the store is the source of truth.
    const unsubscribe = store.subscribe(() => update(current => ({ ...current, base: store.get() })));
    // Each events() call is an independent subscription; return() ends it and releases a pending next().
    let alive = true;
    const iterator = port.events(threadId)[Symbol.asyncIterator]();
    (async () => {
      try {
        while (alive) {
          const { value, done } = await iterator.next();
          if (done || !alive) break;
          update(current => value.type === 'text-delta'
            ? { ...current, streamed: addStreamedText(current.streamed, current.base, value) }
            : { ...current, base: applyChatEvent(current.base, value) });
        }
      } catch { /* the port closed the stream */ }
    })();
    return () => { alive = false; unsubscribe(); iterator.return?.(); };
  }, [port, threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const messages = useMemo(() => mergeStreamedText(state.base, state.streamed), [state]);
  const threadMessages = useMemo(() => messages.map(toThreadMessage), [messages]);
  return useExternalStoreRuntime({
    messages: threadMessages,
    isRunning: messages.some(isActiveRun),
    convertMessage: message => message,
    async onNew(message) {
      await sendToPort(port, threadId, { text: appendMessageText(message), mentions, attachments, scope, generateImages }, { onSent, onThreadCreated, onError });
    },
    async onCancel() {
      const run = messages.findLast(isActiveRun)?.status;
      if (!run) return;
      try { await port.stop(run.id); } catch (error) { onError?.(error); }
    },
  });
}
