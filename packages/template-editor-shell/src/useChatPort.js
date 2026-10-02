import { useEffect, useMemo, useRef } from 'react';
import { getConversationSession } from './conversation-runtime.js';
import { createChatPort } from './chat-port.js';

const PORT_METHODS = ['events', 'send', 'stop', 'discard', 'apply', 'previewDraft', 'answer', 'continueRun', 'keepDraft', 'createThread', 'renameThread', 'archiveThread', 'deleteThread', 'mentionTargets', 'openTarget'];

/**
 * `port` — стабильный фасад над текущим адаптером: StudioChat получает его в рендере, а StrictMode делает
 * mount → cleanup → mount. attach() создаёт адаптер (и его подписку на сессию), cleanup уничтожает;
 * подписчики фасада переживают смену адаптера, потому что фасад держит их сам и переподписывается.
 * Между cleanup и следующим attach() вызов фасада лениво создаёт адаптер; attach() его подхватит.
 */
export function createPortLifecycle(session, getContext) {
  let adapter = null, attached = null; // attached — адаптер, к которому сейчас подключены мосты
  const threadListeners = new Set(), messageListeners = new Map(); // threadId → Set
  let threadBridge = null; const messageBridges = new Map(); // threadId → off
  const ensure = () => adapter || (adapter = createChatPort(session, getContext));
  const fan = set => value => { for (const fn of [...set]) fn(value); };

  const bridgeThreads = () => { if (attached && !threadBridge && threadListeners.size) threadBridge = attached.port.threads.subscribe(fan(threadListeners)); };
  const bridgeMessages = threadId => {
    const set = messageListeners.get(threadId);
    if (attached && set?.size && !messageBridges.has(threadId)) messageBridges.set(threadId, attached.port.messages(threadId).subscribe(fan(set)));
  };
  const unbridgeAll = () => { threadBridge?.(); threadBridge = null; for (const off of messageBridges.values()) off(); messageBridges.clear(); };

  const port = {
    threads: {
      get: () => ensure().port.threads.get(),
      subscribe(fn) {
        threadListeners.add(fn); bridgeThreads();
        return () => { threadListeners.delete(fn); if (!threadListeners.size) { threadBridge?.(); threadBridge = null; } };
      },
    },
    messages(threadId) {
      return {
        get: () => ensure().port.messages(threadId).get(),
        subscribe(fn) {
          if (!messageListeners.has(threadId)) messageListeners.set(threadId, new Set());
          messageListeners.get(threadId).add(fn); bridgeMessages(threadId);
          return () => {
            const set = messageListeners.get(threadId); if (!set) return;
            set.delete(fn);
            if (!set.size) { messageListeners.delete(threadId); messageBridges.get(threadId)?.(); messageBridges.delete(threadId); }
          };
        },
      };
    },
    get attachmentLimits() { return ensure().port.attachmentLimits; },
    get capabilities() { return ensure().port.capabilities; },
    dispose() { /* жизненным циклом владеет attach() */ },
  };
  for (const name of PORT_METHODS) port[name] = (...args) => ensure().port[name](...args);

  return {
    port,
    registerBlockScope: (key, scope) => ensure().registerBlockScope(key, scope),
    onProjectChange() { adapter?.invalidateConflicts(); },
    /** Сменился язык интерфейса: снимки адаптера пересобираются с новым t(), подписчики получают новые значения. */
    refresh() { adapter?.refresh(); },
    attach() {
      const reused = Boolean(adapter), mine = ensure();
      unbridgeAll(); attached = mine;
      bridgeThreads(); for (const threadId of messageListeners.keys()) bridgeMessages(threadId);
      // Новый адаптер мог пропустить изменения сессии, пока старый был уничтожен: отдать подписчикам актуальные значения.
      if (!reused) {
        if (threadListeners.size) fan(threadListeners)(mine.port.threads.get());
        for (const [threadId, set] of messageListeners) fan(set)(mine.port.messages(threadId).get());
      }
      let done = false;
      return () => { // идемпотентно; запоздалый cleanup не трогает адаптер следующего attach()
        if (done) return; done = true;
        if (attached === mine) { unbridgeAll(); attached = null; }
        mine.port.dispose();
        if (adapter === mine) adapter = null;
      };
    },
  };
}

/**
 * Один ChatPort на сессию проекта. context — { state, locale, sectionFrame, settings, onApplyRun, onPreviewDraft,
 * onKeepDraft, onOpenFile, onOpenSection, t, language? }; читается через ref, поэтому всегда живой.
 * language (или host.language/host.messages) — ключ пересборки подписей: t() пересоздаётся каждый рендер.
 */
export function useChatPort(host, context) {
  const latest = useRef(context); latest.current = context;
  const session = useMemo(() => getConversationSession(host), [host]);
  const lifecycle = useMemo(() => createPortLifecycle(session, () => latest.current), [session]);
  useEffect(() => lifecycle.attach(), [lifecycle]);
  useEffect(() => { lifecycle.onProjectChange(); }, [lifecycle, context.state?.files, context.state?.translations]);
  const language = context.language ?? host?.language, messages = host?.messages, shown = useRef({ lifecycle, language, messages });
  useEffect(() => {
    const previous = shown.current; shown.current = { lifecycle, language, messages };
    if (previous.lifecycle === lifecycle && (previous.language !== language || previous.messages !== messages)) lifecycle.refresh();
  }, [lifecycle, language, messages]);
  useEffect(() => { session.ready.then(() => session.reconcileApplied(latest.current.state?.appliedAiRuns || [])).catch(() => {}); }, [session, context.state?.appliedAiRuns]);
  return lifecycle;
}
