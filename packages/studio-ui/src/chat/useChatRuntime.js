import { useEffect, useMemo, useState } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';
import { appendMessageText, applyChatEvent, isActiveRun, sendToPort, toThreadMessage } from './chat-model.js';

export { applyChatEvent, toThreadMessage, RUN_STATUS } from './chat-model.js';

const PROJECT_SCOPE = { kind: 'project' };

// assistant-ui external-store runtime over a ChatPort (chat/port.d.ts).
// threadId empty — a new conversation: on the first message the port's createThread() returns a real thread,
// onThreadCreated(id) lets StudioChat switch to it, and the message is sent into that thread.
export function useChatRuntime(port, threadId, { scope = PROJECT_SCOPE, mentions = [], attachments = [], generateImages, onSent, onThreadCreated, onError } = {}) {
  const [messages, setMessages] = useState(() => (threadId ? port.messages(threadId).get() : []));
  useEffect(() => {
    if (!threadId) { setMessages([]); return undefined; }
    const store = port.messages(threadId);
    setMessages(store.get());
    // Defensive: the contract passes the value to the listener, but the store is the source of truth.
    const unsubscribe = store.subscribe(() => setMessages(store.get()));
    // Events are applied on top of the latest snapshot. text-delta is not idempotent: a port that already
    // reflects a delta in messages() must not also emit it (status / part-start / part-update are idempotent).
    let alive = true;
    const iterator = port.events(threadId)[Symbol.asyncIterator]();
    (async () => {
      try {
        while (alive) {
          const { value, done } = await iterator.next();
          if (done || !alive) break;
          setMessages(current => applyChatEvent(current, value));
        }
      } catch { /* the port closed the stream */ }
    })();
    return () => { alive = false; unsubscribe(); iterator.return?.(); };
  }, [port, threadId]);

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
