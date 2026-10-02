import { createContext, useContext, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw } from 'lucide-react';
import { ActionBarPrimitive, ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import { branchSibling, canEdit, canRegenerate, canRetryRun, canSwitchBranch } from './chat-model.js';

// StudioChat provides { port, threadId, onError(error) } of the open thread: the branch picker and Retry call the port
// directly (switchBranch, regenerate need the thread id); onError shows the "The action failed" notice above the composer.
export const ChatThreadContext = createContext(null);

const useCustom = () => useAuiState(state => state.message.metadata?.custom) ?? {};
const useHasText = () => useAuiState(state => state.message.parts.some(part => part.type === 'text' && part.text));

function CopyAction() {
  const t = useStudioText(), copied = useAuiState(state => state.message.isCopied);
  const label = copied ? t('Copied') : t('Copy');
  return <ActionBarPrimitive.Copy className="studio-chat-message-action" aria-label={label} title={label}>
    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
  </ActionBarPrimitive.Copy>;
}

// ‹ 2/3 › among the siblings of a message (Message.branch). The external store holds only the visible path, so this is
// not BranchPickerPrimitive: a step calls port.switchBranch(threadId, siblingId) and the port sends the new path.
export function BranchPicker({ branch }) {
  const t = useStudioText(), chat = useContext(ChatThreadContext), [busy, setBusy] = useState(false);
  const running = useAuiState(state => state.thread.isRunning);
  if (!chat?.threadId || !canSwitchBranch(chat.port, branch)) return null;
  const go = step => async () => {
    const target = branchSibling(branch, step);
    if (!target) return;
    setBusy(true);
    try { await chat.port.switchBranch(chat.threadId, target); } catch (error) { chat.onError?.(error); } finally { setBusy(false); }
  };
  const blocked = busy || running;
  return <div role="group" aria-label={t('Versions')} className="studio-chat-branch">
    <button type="button" className="studio-chat-message-action" aria-label={t('Previous version')} title={t('Previous version')} disabled={blocked || branch.index === 0} onClick={go(-1)}><ChevronLeft size={14} aria-hidden="true" /></button>
    <span className="studio-chat-branch-count" aria-hidden="true">{branch.index + 1}/{branch.count}</span>
    <span className="studio-sr-only">{t('Version {index} of {count}', { index: branch.index + 1, count: branch.count })}</span>
    <button type="button" className="studio-chat-message-action" aria-label={t('Next version')} title={t('Next version')} disabled={blocked || branch.index === branch.count - 1} onClick={go(1)}><ChevronRight size={14} aria-hidden="true" /></button>
  </div>;
}

// Actions under a message: hidden while a run is active (hideWhenRunning), shown on hover and focus (keyboard users reach
// them with Tab), always on the last message, with a branch picker and on touch screens (styles.css).
function ActionBar({ children }) {
  const last = useAuiState(state => state.message.isLast);
  return <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="studio-chat-message-actions" data-last={last || undefined}>{children}</ActionBarPrimitive.Root>;
}

// Assistant message: Copy (when it has text), Regenerate (port.regenerate through assistant-ui onReload; not for a run that
// ended without a result — RunActions shows Retry there), branch picker.
export function AssistantActions() {
  const t = useStudioText(), chat = useContext(ChatThreadContext), { run, branch } = useCustom(), hasText = useHasText();
  const regenerate = canRegenerate(chat?.port) && !canRetryRun(chat?.port, run?.status);
  const branches = canSwitchBranch(chat?.port, branch);
  if (!hasText && !regenerate && !branches) return null;
  return <ActionBar>
    {hasText && <CopyAction />}
    {regenerate && <ActionBarPrimitive.Reload className="studio-chat-message-action" aria-label={t('Regenerate response')} title={t('Regenerate response')}><RotateCcw size={14} aria-hidden="true" /></ActionBarPrimitive.Reload>}
    {branches && <BranchPicker branch={branch} />}
  </ActionBar>;
}

// User message: Edit (inline edit composer → assistant-ui onEdit → port.editMessage), Copy, branch picker.
export function UserActions() {
  const t = useStudioText(), chat = useContext(ChatThreadContext), { branch } = useCustom(), hasText = useHasText();
  const edit = canEdit(chat?.port), branches = canSwitchBranch(chat?.port, branch);
  if (!hasText && !edit && !branches) return null;
  return <ActionBar>
    {branches && <BranchPicker branch={branch} />}
    {edit && <ActionBarPrimitive.Edit className="studio-chat-message-action" aria-label={t('Edit message')} title={t('Edit message')}><Pencil size={14} aria-hidden="true" /></ActionBarPrimitive.Edit>}
    {hasText && <CopyAction />}
  </ActionBar>;
}

// The message's own edit composer (inside MessagePrimitive the composer scope is the edit composer): Enter or Save sends
// the new text as an edit (AppendMessage.sourceId = the message id), Escape or Cancel leaves the message unchanged.
export function EditComposer() {
  const t = useStudioText();
  return <ComposerPrimitive.Root className="studio-chat-edit">
    <ComposerPrimitive.Input className="studio-chat-edit-input" aria-label={t('Edit message')} autoFocus addAttachmentOnPaste={false} maxRows={10}
      unstable_focusOnRunStart={false} unstable_focusOnScrollToBottom={false} unstable_focusOnThreadSwitched={false} />
    <div className="studio-chat-edit-actions">
      <ComposerPrimitive.Cancel className="studio-button studio-button-ghost studio-button-sm">{t('Cancel')}</ComposerPrimitive.Cancel>
      <ComposerPrimitive.Send className="studio-button studio-button-primary studio-button-sm">{t('Save')}</ComposerPrimitive.Send>
    </div>
  </ComposerPrimitive.Root>;
}
