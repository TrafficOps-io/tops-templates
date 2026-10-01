import { Check, LoaderCircle, Settings2, X } from 'lucide-react';
import { useStudioText } from './studio-i18n.js';

const stages = [['plan', 'Plan'], ['generate', 'Generate'], ['review', 'Review'], ['revise', 'Revise'], ['ready', 'Ready']];
const workingTitles = { plan: 'Planning your page', generate: 'Building your page', review: 'Reviewing your page', revise: 'Improving the draft' };

export default function AiRunSummary({ working, phase, review, draft, error, status, elapsed, received, model, imageModel, generateImages, onCancel, onApply, onContinue, onDiscard, onSettings, disabled }) {
  const t = useStudioText();
  if (!working && !draft && !error && !status) return null;
  const attention = Boolean(error || draft?.valid === false);
  const current = stages.findIndex(([key]) => key === phase);
  const title = working ? t(workingTitles[phase] || 'Working…') : draft ? t(attention ? 'Draft needs attention' : draft.kind === 'content' ? 'Content ready' : 'Changes ready') : error ? t('Generation stopped') : status;
  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return <section className="ai-run-summary" data-state={working ? 'working' : attention ? 'attention' : draft ? 'ready' : 'idle'} aria-label={t('Generation status')}>
    <div className="ai-run-heading">
      <div><span className="section-kicker">{t('Generation status')}</span><h3>{working && <LoaderCircle size={17} className="spin" />}{!working && draft && !attention && <Check size={17} />}{title}</h3></div>
      {working && <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>{t('Cancel')}</button>}
    </div>
    {model && <p className="ai-run-model">{t('Text model')}: <span>{model}</span>{generateImages && imageModel && <><br />{t('Image model')}: <span>{imageModel}</span></>}</p>}
    {phase && <ol className="ai-workflow" aria-label={t('Generation stages')}>{stages.map(([key, label], index) => <li key={key} aria-current={phase === key ? 'step' : undefined} data-state={index < current && key !== 'revise' || key === 'ready' && phase === 'ready' && !attention ? 'complete' : phase === key ? attention && !working ? 'attention' : 'current' : 'pending'}><span aria-hidden="true">{index < current && key !== 'revise' || key === 'ready' && phase === 'ready' && !attention ? '✓' : index + 1}</span>{t(label)}</li>)}</ol>}
    {working && <p className="ai-progress"><span aria-label={t('Elapsed time')}>{time}</span><span>{received ? t('{count} characters received', { count: received.toLocaleString() }) : t('Waiting for first response')}</span></p>}
    {status && (working || draft) && <p className="ai-message" role="status">{status}</p>}
    {error && <div className="ai-message error" role="alert">{error}</div>}
    {review && <div className="ai-review"><strong>{t('Reviewer')}</strong><p>{review.summary}</p>{review.issues.length > 0 && <ul>{review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}</div>}
    {draft && <div className="ai-draft">
      {draft.summary && <p>{draft.summary}</p>}
      {draft.valid === false && <p className="field-help">{t(draft.editScope ? 'Completed block changes are retained. Continue generation to validate and review them before applying.' : 'Completed work is retained. Continue with this model or change the model, then continue. No changes are applied until you keep the draft.')}</p>}
      {draft.kind === 'content' ? <details className="ai-run-details"><summary>{t('Review content changes')}</summary><pre className="ai-values-preview">{JSON.stringify(draft.values, null, 2)}</pre></details> : <p className="field-help">{Object.keys(draft.files).length} {t('files ·')} {draft.steps} {t('steps. Inspect Source code and Live preview before applying.')}</p>}
      <div className="ai-actions">
        {draft.valid === false && <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={onContinue}>{t('Continue generation')}</button>}
        {(!draft.editScope || draft.valid === true) && <button type="button" className={`btn ${draft.valid === false ? 'btn-outline' : 'btn-primary'} btn-sm`} disabled={disabled} onClick={onApply}><Check size={14} />{draft.valid === false ? t('Keep draft in editor') : t('Apply changes')}</button>}
        {draft.valid === false && <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={onSettings}><Settings2 size={14} />{t('Change model')}</button>}
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={onDiscard}><X size={14} />{t('Discard')}</button>
      </div>
    </div>}
  </section>;
}
