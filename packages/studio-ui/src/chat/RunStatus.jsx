import { Square } from 'lucide-react';
import { useAui } from '@assistant-ui/react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import StatusBadge from '../primitives/StatusBadge.jsx';
import { formatCost, formatPercent } from './cards/CardFrame.jsx';

// Same keys as ConversationPanel.jsx statusLabels, so both studios read the same.
const LABELS = { queued: 'Queued', running: 'Working…', ready: 'Changes ready', completed: 'Completed', failed: 'Needs attention', interrupted: 'Interrupted', cancelled: 'Stopped', applied: 'Applied', discarded: 'Discarded' };
const TONES = { queued: 'neutral', running: 'info', ready: 'accent', completed: 'success', failed: 'danger', interrupted: 'warning', cancelled: 'neutral', applied: 'success', discarded: 'neutral' };

// run: RunState { id, status, progress? (0..1), etaSeconds?, step?, cost?, message? }; capabilities: port.capabilities.
// "Stop" goes through the assistant-ui thread (cancelRun → useChatRuntime onCancel → port.stop).
export default function RunStatus({ run, capabilities }) {
  const t = useStudioText(), aui = useAui();
  const active = run.status === 'queued' || run.status === 'running';
  const details = [
    active && Number.isFinite(run.progress) ? formatPercent(run.progress) : '',
    active && Number.isFinite(run.etaSeconds) ? t('~{seconds} s', { seconds: Math.max(0, Math.round(run.etaSeconds)) }) : '',
    active && run.step ? t('Step {current} of {total}', run.step) : '',
    capabilities?.cost && Number.isFinite(run.cost) ? formatCost(run.cost) : '',
  ].filter(Boolean);
  return <div className="studio-chat-run-status" aria-live={active ? 'polite' : undefined}>
    <StatusBadge tone={TONES[run.status] ?? 'neutral'}>{t(LABELS[run.status] ?? 'Completed')}</StatusBadge>
    {details.length > 0 && <span className="studio-chat-run-details">{details.join(' · ')}</span>}
    {active && Number.isFinite(run.progress) && <progress className="studio-chat-run-progress" max={1} value={run.progress} aria-label={t(LABELS[run.status])} />}
    {active && <button type="button" className="studio-chat-run-stop" onClick={() => aui.thread.cancelRun()}><Square size={12} aria-hidden="true" />{t('Stop')}</button>}
    {run.message && <p className={`studio-chat-run-message${run.status === 'failed' ? ' studio-chat-run-message-danger' : ''}`}>{run.message}</p>}
  </div>;
}
