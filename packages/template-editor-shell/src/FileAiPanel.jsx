import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Settings2, Sparkles } from 'lucide-react';
import { useStudioHost } from './host-context.js';
import { useStudioText } from './studio-i18n.js';
import { activeElement, trapFocus } from './focus.js';
import { AI_RUN_TIMEOUT_MS } from './ai-limits.js';
import AssetPreview from './AssetPreview.jsx';
import PromptAttachments from './PromptAttachments.jsx';
import { fileAiSupport, runFileAiWorkflow } from './file-ai-workflow.js';

// This dialog owns one immutable target. Switching files cannot redirect a run.
export default function FileAiPanel({ path, files, values, onBusyChange, onPreview, onApply, onClose, onSettings }) {
  const host = useStudioHost(), t = useStudioText(), id = useId();
  const [base] = useState(() => ({ path, files, values }));
  const [prompt, setPrompt] = useState(''), [attachments, setAttachments] = useState([]);
  const [settings, setSettings] = useState(null), [working, setWorking] = useState(false), [reading, setReading] = useState(false);
  const [draft, setDraft] = useState(null), [error, setError] = useState(''), [phase, setPhase] = useState(''), [elapsed, setElapsed] = useState(0);
  const root = useRef(null), request = useRef(null), mounted = useRef(false), pending = useRef(false), promptRef = useRef(null);
  const support = fileAiSupport(base.path, base.files[base.path]);
  const configured = settings?.configured && (support.kind !== 'image' || settings.imageModel?.trim());
  const phaseLabels = { plan: 'Planning file changes…', generate: 'Editing selected file…', review: 'Reviewing file changes…', revise: 'Revising file changes…' };
  useEffect(() => {
    mounted.current = true;
    const previous = activeElement(root.current), controller = new AbortController();
    root.current.querySelector('textarea')?.focus();
    host.ai.settings.load({ signal: controller.signal }).then(value => { if (mounted.current) setSettings(value); })
      .catch(cause => { if (!controller.signal.aborted && mounted.current) setError(t(cause.message)); });
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); previous?.isConnected && previous.focus(); };
  }, []);
  useEffect(() => {
    if (!working) return;
    const start = Date.now(), timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => { if (draft) root.current?.querySelector('.file-ai-result h3')?.focus(); }, [draft]);
  async function generate(event) {
    event.preventDefault();
    if (working || reading || draft || !prompt.trim() || !configured || !support.supported) return;
    const controller = new AbortController(); request.current = controller;
    let started = false, timedOut = false;
    const expire = () => { timedOut = true; controller.abort(); };
    let timer = setTimeout(expire, AI_RUN_TIMEOUT_MS);
    setWorking(true); onBusyChange(true); setError(''); setPhase('plan'); setElapsed(0);
    try {
      const connection = await host.ai.begin({ signal: controller.signal }); started = true;
      controller.signal.throwIfAborted();
      const timeout = connection.timeoutMs > 0 ? connection.timeoutMs : AI_RUN_TIMEOUT_MS;
      clearTimeout(timer); timer = setTimeout(expire, timeout);
      const result = await runFileAiWorkflow({ ...connection, ...base, prompt, attachments, signal: controller.signal, timeout,
        validateDraft: host.validateAiDraft, onProgress(event) {
          if (mounted.current && !controller.signal.aborted && event.type === 'phase') setPhase(event.phase);
        } });
      controller.signal.throwIfAborted();
      if (!mounted.current) return;
      pending.current = true; setDraft(result); onPreview({ files: result.files, values: base.values });
      if (!result.valid) setError(t(result.error || result.review?.summary || 'Review the file draft and try again.'));
    } catch (cause) {
      if (mounted.current) setError(controller.signal.aborted
        ? t(timedOut ? 'File editing timed out. Try a smaller request.' : 'File editing cancelled.') : t(cause.message || String(cause)));
    } finally {
      clearTimeout(timer);
      try { if (started) await host.ai.finish(); }
      catch (cause) { if (mounted.current) setError(t(cause.message || String(cause))); }
      finally {
        if (request.current === controller) request.current = null;
        if (mounted.current) { setWorking(false); onBusyChange(false); }
      }
    }
  }
  function discard() { pending.current = false; setDraft(null); setError(''); onPreview(null); onBusyChange(false); }
  function close() { if (working || reading) return; if (pending.current) discard(); onClose(); }
  function apply() {
    if (!draft?.valid || working) return;
    try { onApply(base.path, draft.files[base.path], base.files[base.path]); }
    catch (cause) { setError(t(cause.message || String(cause))); return; }
    pending.current = false; onPreview(null); onBusyChange(false); onClose();
  }
  return <div ref={root} className="hosted-modal file-ai-modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (working) request.current?.abort(); else close(); } else { trapFocus(event, root.current); if (event.key === 'Tab') event.stopPropagation(); } }}>
    <form className="hosted-dialog file-ai-panel" onSubmit={generate}>
      <h2 id={id}><Sparkles size={20} aria-hidden="true" />{t('Edit file with AI')}</h2>
      <p className="file-ai-target"><span>{t('Selected file')}</span><code>{base.path}</code></p>
      <details className="file-ai-request" open={!draft}>
      <summary hidden={!draft}>{t('Request and references')}</summary>
      <label className="field ai-prompt"><span>{t('Describe the changes')}</span><textarea ref={promptRef} className="textarea w-full" aria-label={t('Describe the changes')} value={prompt} maxLength={6000} required disabled={working || Boolean(draft)} onChange={event => setPrompt(event.target.value)} placeholder={t('Describe what to change in this file…')} /></label>
      <PromptAttachments promptRef={promptRef} attachments={attachments} onChange={setAttachments} onBusyChange={setReading} disabled={working || Boolean(draft)} showDisclosure={false} />
      <p className="field-help">{t('The selected file, prompt and attachments are sent to OpenRouter and the selected provider. Review the result before replacing the file.')}</p>
      {support.kind === 'image' && <p className="field-help">{t('Image editing uses your image model. The text model must support image input for planning and review.')}</p>}
      </details>
      {!support.supported && <p className="inline-error" role="alert">{t(support.reason)}</p>}
      {settings && !configured && <p className="field-help">{t(support.kind === 'image' && settings.configured ? 'Choose an image model in AI connection settings to enable this.' : 'Add your OpenRouter connection in Settings first.')}</p>}
      {working && <p className="file-ai-status" role="status"><LoaderCircle className="spin" size={17} aria-hidden="true" />{t(phaseLabels[phase] || 'Editing selected file…')} · {elapsed}s</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {draft && <section className="file-ai-result" aria-label={t('File changes')}>
        <h3 tabIndex={-1}>{t(draft.valid ? 'Changes ready' : 'Draft needs attention')}</h3>
        {draft.summary && <p>{draft.summary}</p>}
        <div className="file-ai-comparison">{[['Original file', base.files[base.path]], ['Edited file', draft.files[base.path]]].map(([label, value]) => <div key={label}>
          <h4>{t(label)}</h4>{typeof value === 'string' ? <pre tabIndex={0} aria-label={t(label)}>{value}</pre> : <AssetPreview path={base.path} value={value} />}
        </div>)}</div>
      </section>}
      <div className="file-ai-actions">
        {working ? <button key="cancel" type="button" className="btn btn-outline" onClick={event => { event.preventDefault(); request.current?.abort(); }}>{t('Cancel')}</button> : draft ? <>
          <button key="apply" type="button" className="btn btn-primary" disabled={!draft.valid} onClick={event => { event.preventDefault(); apply(); }}>{t('Apply changes')}</button>
          <button key="discard" type="button" className="btn btn-ghost" onClick={event => { event.preventDefault(); discard(); }}>{t('Discard')}</button>
        </> : <>
          <button key="generate" type="submit" className="btn btn-primary" disabled={reading || !configured || !support.supported || !prompt.trim()}>{t('Generate changes')}</button>
          <button key="close" type="button" className="btn btn-ghost" disabled={reading} onClick={event => { event.preventDefault(); close(); }}>{t('Close')}</button>
          <button key="settings" type="button" className="btn btn-ghost" disabled={reading} onClick={event => { event.preventDefault(); close(); onSettings(); }}><Settings2 size={15} />{t('AI connection settings')}</button>
        </>}
      </div>
    </form>
  </div>;
}
