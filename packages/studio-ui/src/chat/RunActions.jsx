import { createContext, useContext, useState } from 'react';
import { Check, Eye, RotateCw, Undo2 } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import { canDiscardRun } from './chat-model.js';

// StudioChat provides { text, clear() } of its composer: Continue generation sends the draft as the continuation prompt.
export const ChatDraftContext = createContext(null);

const KEEP_DRAFT = new Set(['failed', 'interrupted']);
const CONTINUE = new Set(['failed', 'interrupted', 'cancelled']);

// Run-level actions under an assistant message. Apply/Preview only for 'ready' — the port reports 'ready'
// only when the run is applicable, otherwise 'completed' (contract rule, README). Discard for 'ready' and for a
// failed/interrupted/cancelled run whose message has draft cards (hasDrafts: diff/values/image/file), see canDiscardRun. Keep draft (failed/interrupted,
// capabilities.keepDraft + port.keepDraft) and Continue generation (failed/interrupted/cancelled + port.continueRun)
// appear only when the port offers them; Continue passes the composer text as the prompt and clears the composer. Errors are inline notices, never toasts.
export default function RunActions({ port, run, hasDrafts = false }) {
  const t = useStudioText(), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const draft = useContext(ChatDraftContext);
  const capabilities = port.capabilities ?? {};
  const act = (name, call) => async () => {
    setBusy(name); setError('');
    try { await call(); } catch (failure) { setError(failure?.message || t('Something went wrong.')); } finally { setBusy(''); }
  };
  const ready = run.status === 'ready';
  const keepDraft = KEEP_DRAFT.has(run.status) && capabilities.keepDraft && typeof port.keepDraft === 'function';
  const continueRun = CONTINUE.has(run.status) && typeof port.continueRun === 'function';
  const discard = canDiscardRun(port, run.status, hasDrafts);
  if (!ready && !discard && !keepDraft && !continueRun && run.status !== 'applied') return null;
  return <div className="studio-chat-run-actions">
    {ready && <>
      <Button variant="primary" size="sm" icon={Check} loading={busy === 'apply'} disabled={Boolean(busy)} data-testid="studio-chat-apply" onClick={act('apply', () => port.apply(run.id))}>{t('Apply')}</Button>
      {capabilities.previewDraft && typeof port.previewDraft === 'function' && <Button size="sm" icon={Eye} loading={busy === 'preview'} disabled={Boolean(busy)} onClick={act('preview', () => port.previewDraft(run.id))}>{t('Preview draft')}</Button>}
    </>}
    {discard && <Button variant="ghost" size="sm" icon={Undo2} loading={busy === 'discard'} disabled={Boolean(busy)} data-testid="studio-chat-discard" onClick={act('discard', () => port.discard(run.id))}>{t('Discard')}</Button>}
    {keepDraft && <Button size="sm" loading={busy === 'keep'} disabled={Boolean(busy)} data-testid="studio-chat-keep-draft" onClick={act('keep', () => port.keepDraft(run.id))}>{t('Keep draft in editor')}</Button>}
    {continueRun && <Button size="sm" icon={RotateCw} loading={busy === 'continue'} disabled={Boolean(busy)} data-testid="studio-chat-continue" onClick={act('continue', async () => {
      const prompt = draft?.text?.trim();
      if (prompt) { await port.continueRun(run.id, prompt); draft.clear(); } else await port.continueRun(run.id);
    })}>{t('Continue generation')}</Button>}
    {run.status === 'applied' && <span className="studio-chat-run-applied"><Check size={14} aria-hidden="true" />{t('Changes applied')}</span>}
    {error && <InlineNotice tone="danger">{error}</InlineNotice>}
  </div>;
}
