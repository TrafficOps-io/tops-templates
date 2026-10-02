// Pure functions behind StudioChat: ChatPort messages → assistant-ui ThreadMessageLike, ChatEvent reduction,
// sending into a (possibly new) thread and routing card actions to the port. No React and no JSX here,
// so Node tests import this module directly (node --test does not load .jsx).

/** RunStatus → ThreadMessageLike.status (assistant-ui 0.15: running | incomplete{reason} | complete{reason}). */
export const RUN_STATUS = {
  queued: { type: 'running' },
  running: { type: 'running' },
  ready: { type: 'complete', reason: 'stop' },
  completed: { type: 'complete', reason: 'stop' },
  applied: { type: 'complete', reason: 'stop' },
  discarded: { type: 'complete', reason: 'stop' },
  failed: { type: 'incomplete', reason: 'error' },
  cancelled: { type: 'incomplete', reason: 'cancelled' },
  interrupted: { type: 'incomplete', reason: 'other' },
};

export const isActiveRun = message => ['queued', 'running'].includes(message?.status?.status);

// ChatPort message → ThreadMessageLike. Result cards become tool-call parts, toolName = card type;
// StudioChat renders them with its own card components. assistant-ui ignores status on user messages.
export function toThreadMessage(message) {
  const run = message.status;
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: message.parts.map(part => part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, args: {}, result: part.result }),
    status: message.role === 'assistant' && run ? RUN_STATUS[run.status] ?? { type: 'complete', reason: 'unknown' } : undefined,
    metadata: { custom: { run, mentions: message.mentions, attachments: message.attachments, cost: message.cost } },
  };
}

/** Applies a ChatEvent to the port's message list. Pure: the input array and messages are not mutated. */
export function applyChatEvent(messages, event) {
  const index = messages.findIndex(message => message.id === event.messageId);
  if (index < 0) return messages;
  const message = { ...messages[index], parts: [...messages[index].parts] };
  const cardAt = toolCallId => message.parts.findIndex(part => part.type === 'tool-call' && part.toolCallId === toolCallId);
  switch (event.type) {
    case 'text-delta': {
      const last = message.parts.at(-1);
      if (last?.type === 'text') message.parts[message.parts.length - 1] = { ...last, text: last.text + event.delta };
      else message.parts.push({ type: 'text', text: event.delta });
      break;
    }
    case 'part-start': {
      // toolCallId is unique within a message (port contract): a repeated start replaces the card instead of duplicating it.
      const at = event.part.type === 'tool-call' ? cardAt(event.part.toolCallId) : -1;
      if (at >= 0) message.parts[at] = event.part; else message.parts.push(event.part);
      break;
    }
    case 'part-update': {
      const at = cardAt(event.toolCallId);
      if (at < 0) return messages;
      message.parts[at] = { ...message.parts[at], result: { ...message.parts[at].result, ...event.result } };
      break;
    }
    case 'part-done': return messages; // the card already carries its final result; the event is for the port, not the feed
    case 'status': message.status = event.status; break;
    case 'error': message.status = { ...(message.status || { id: event.messageId }), status: 'failed', message: event.message }; break;
    default: return messages;
  }
  return messages.with(index, message);
}

// Streamed text (text-delta) lives beside the port's snapshots: a port that streams deltas does not put that text into
// messages() (contract rule), so a new snapshot must not wipe it. streamed: { [messageId]: { at, text }[] } — segments,
// at = number of snapshot parts when the segment started (a delta after a new card starts a new segment).
export function addStreamedText(streamed, messages, event) {
  const message = messages.find(item => item.id === event.messageId);
  if (!message || !event.delta) return streamed;
  const at = message.parts.length, segments = streamed[message.id] ?? [], last = segments.at(-1);
  const next = last && last.at === at ? segments.with(-1, { at, text: last.text + event.delta }) : [...segments, { at, text: event.delta }];
  return { ...streamed, [message.id]: next };
}

// Snapshot + streamed segments → the list StudioChat renders. Once the snapshot carries text for a message, the port
// switched to snapshots for it and the segments are ignored (no duplicates). Untouched messages keep identity.
export function mergeStreamedText(messages, streamed) {
  if (!streamed || !Object.keys(streamed).length) return messages;
  return messages.map(message => {
    const segments = streamed[message.id];
    if (!segments?.length || message.parts.some(part => part.type === 'text' && part.text)) return message;
    const parts = [...message.parts];
    for (const segment of [...segments].reverse()) parts.splice(Math.min(segment.at, parts.length), 0, { type: 'text', text: segment.text });
    return { ...message, parts };
  });
}

/** Text of an assistant-ui AppendMessage. */
export const appendMessageText = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');

// Thread model: an empty threadId means a new conversation. The port must return a real thread from createThread();
// StudioChat switches to it through onThreadCreated and subscribes to messages(id), then the message is sent there.
// Errors go to onError (StudioChat shows an InlineNotice tone="danger", never a toast).
export async function sendToPort(port, threadId, input, { onSent, onThreadCreated, onError } = {}) {
  try {
    let target = threadId;
    if (!target) { const thread = await port.createThread(); target = thread.id; onThreadCreated?.(thread.id); }
    await port.send(target, input);
    onSent?.();
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

// Card actions → port methods. A button for an action is rendered only when canHandleCardAction says the port supports it.
const PORT_METHOD = { open: 'openTarget', variants: 'openTarget', edit: 'openTarget', play: 'openTarget', continue: 'continueRun', answer: 'answer', apply: 'apply', discard: 'discard' };
export const canHandleCardAction = (port, action) => typeof port?.[PORT_METHOD[action]] === 'function';

const cardTarget = card => card.target ?? { kind: 'file', id: card.path ?? card.name, label: card.path ?? card.name };
const assetTarget = card => card.target ?? { kind: 'asset', id: card.assetId ?? card.name, label: card.name };

export function handleCardAction(port, runId, action, card, value) {
  if (!canHandleCardAction(port, action)) return undefined;
  switch (action) {
    case 'open': return port.openTarget(cardTarget(card));
    case 'variants': case 'edit': case 'play': return port.openTarget(assetTarget(card));
    case 'continue': return port.continueRun(runId);
    case 'answer': return port.answer(card.questionId, value);
    case 'apply': return value ? port.apply(runId, value) : port.apply(runId);
    case 'discard': return port.discard(runId);
    default: return undefined;
  }
}

/**
 * Line diff by common prefix/suffix (same algorithm as TextChanges in ConversationPanel.jsx).
 * Returns context lines around the change, removed and added lines.
 */
export function lineDiff(before, after, context = 2) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return {
    leading: a.slice(Math.max(0, start - context), start),
    removed: a.slice(start, a.length - end),
    added: b.slice(start, b.length - end),
    trailing: b.slice(b.length - end, b.length - end + context),
  };
}
