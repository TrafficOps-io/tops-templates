import { useState } from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import { AttachmentChip, MentionChip } from '../primitives/Chips.jsx';
import Markdown from './Markdown.jsx';
import RunStatus from './RunStatus.jsx';
import RunActions from './RunActions.jsx';
import { renderCard } from './cards/index.js';
import { AssistantActions, EditComposer, UserActions } from './MessageActions.jsx';
import { canHandleCardAction, handleCardAction, hasDraftCards } from './chat-model.js';
import { mentionSegments, mentionsInText, mentionKey } from './mentions.js';

export { handleCardAction };

// metadata.custom is set by toThreadMessage: { run, mentions, attachments, cost }.
const useCustom = () => useAuiState(state => state.message.metadata?.custom) ?? {};

// data-role is set by hand: assistant-ui does not expose it (spike protocol).
// While the user edits the message (ActionBarPrimitive.Edit), its edit composer replaces the bubble.
export function UserMessage({ port }) {
  const { mentions, attachments } = useCustom();
  const editing = useAuiState(state => state.composer.isEditing);
  const text = useAuiState(state => state.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'));
  const inlineKeys = new Set(mentionsInText(text, mentions).map(mentionKey));
  const legacyMentions = (mentions || []).filter(target => !inlineKeys.has(mentionKey(target)));
  const open = typeof port.openTarget === 'function' ? target => port.openTarget(target) : undefined;
  if (editing) return <MessagePrimitive.Root data-role="user" data-editing="true" className="studio-chat-message studio-chat-message-user"><EditComposer /></MessagePrimitive.Root>;
  return <MessagePrimitive.Root data-role="user" className="studio-chat-message studio-chat-message-user">
    <div className="studio-chat-bubble">
      <MessagePrimitive.Parts>{({ part }) => part.type === 'text' ? <p className="studio-chat-user-text">{mentionSegments(part.text, mentions).map(segment => segment.target ? <button key={segment.start} type="button" className="studio-chat-inline-mention" onClick={() => open?.(segment.target)} disabled={!open}>{segment.text}</button> : segment.text)}</p> : <></>}</MessagePrimitive.Parts>
    </div>
    {(legacyMentions.length > 0 || attachments?.length > 0) && <div className="studio-chat-message-chips">
      {legacyMentions.map(target => <MentionChip key={`${target.kind}:${target.id}`} target={target} onOpen={open} />)}
      {attachments?.map(attachment => <AttachmentChip key={attachment.id} attachment={attachment} />)}
    </div>}
    <UserActions />
  </MessagePrimitive.Root>;
}

export function AssistantMessage({ port }) {
  const t = useStudioText(), { run } = useCustom(), [error, setError] = useState(null);
  const hasDrafts = useAuiState(state => hasDraftCards(state.message.content));
  const can = action => canHandleCardAction(port, action);
  // A rejected card action becomes an inline notice under the message (never a toast, never an unhandled rejection).
  const onAction = (action, card, value) => {
    setError(null);
    let result;
    try { result = handleCardAction(port, run?.id, action, card, value); } catch (failure) { setError(failure); return; }
    Promise.resolve(result).catch(failure => setError(failure ?? new Error(t('Something went wrong.'))));
  };
  return <MessagePrimitive.Root data-role="assistant" data-run-id={run?.id} data-run-status={run?.status} className="studio-chat-message studio-chat-message-assistant">
    {run && <RunStatus run={run} capabilities={port.capabilities} />}
    <MessagePrimitive.Parts>{({ part }) => {
      // assistant-ui renders a synthetic empty running text part before the first content; RunStatus covers it.
      if (part.type === 'text') return part.text ? <Markdown text={part.text} /> : <></>;
      if (part.type === 'tool-call') return renderCard(part, onAction, { can, capabilities: port.capabilities });
      return <></>;
    }}</MessagePrimitive.Parts>
    {error && <InlineNotice tone="danger" title={t('The action failed')} actions={<Button variant="ghost" size="sm" onClick={() => setError(null)}>{t('Dismiss')}</Button>}>{error.message || t('Something went wrong.')}</InlineNotice>}
    {run && <RunActions port={port} run={run} hasDrafts={hasDrafts} />}
    <AssistantActions />
  </MessagePrimitive.Root>;
}

// Feed of the current thread: one children-render function, no deprecated components-prop API.
export default function Messages({ port }) {
  return <ThreadPrimitive.Messages>{({ message }) => message.role === 'user' ? <UserMessage port={port} /> : <AssistantMessage port={port} />}</ThreadPrimitive.Messages>;
}
