import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Settings2, Sparkles, X } from 'lucide-react';
import { fillTemplateWithOpenRouter } from './openrouter-ai.js';
import { loadOpenRouterSettings } from './openrouter-settings.js';

export default function OpenRouterPanel({ definition, values, files, onApply, onApplyProject, onPreview, onBusyChange, onSettings }) {
  const [settings, setSettings] = useState(null), [mode, setMode] = useState('edit'), [prompt, setPrompt] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [draft, setDraft] = useState(null), [events, setEvents] = useState([]), [elapsed, setElapsed] = useState(0), [received, setReceived] = useState(0);
  const request = useRef(null), sequence = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => loadOpenRouterSettings().then(value => { if (alive) setSettings(value); }).catch(error => { if (alive) setError(error.message); });
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; sequence.current++; request.current?.abort(); window.removeEventListener('trafficops-ai-settings', load); };
  }, []);
  useEffect(() => { if (!working) return; const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [working]);
  function discard() { setDraft(null); onPreview(null); setStatus('Changes discarded. Your project is unchanged.'); }
  async function generate() {
    if (request.current) return;
    const id = ++sequence.current, controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 300000);
    setWorking(true); onBusyChange(true); setDraft(null); onPreview(null); setError(''); setEvents([]); setElapsed(0); setReceived(0); setStatus('Connecting to OpenRouter…');
    const live = () => sequence.current === id && !controller.signal.aborted;
    try {
      const connection = await loadOpenRouterSettings();
      controller.signal.throwIfAborted();
      if (!connection.apiKey) throw new Error('Add your OpenRouter connection in Settings first.');
      let result;
      if (mode === 'content') result = await fillTemplateWithOpenRouter({ ...connection, prompt, definition, values, files, signal: controller.signal });
      else {
        const { generateTemplateWithOpenRouterAgent } = await import('./openrouter-template-agent.js');
        controller.signal.throwIfAborted();
        result = await generateTemplateWithOpenRouterAgent({ ...connection, prompt, mode, files, values: mode === 'edit' ? values : {}, signal: controller.signal, stream: true, timeout: 300000, onProgress(event) {
          if (!live()) return;
          if (event.type === 'receiving') { setReceived(event.received); return; }
          const text = event.type === 'file-set' ? `Updated ${(event.paths || [event.path]).join(', ')}` : event.type === 'file-removed' ? `Removed ${event.path}` : event.type === 'validation' ? event.valid ? 'Template validation passed' : `Repairing: ${event.error}` : event.type === 'step' ? `Step ${event.step}: model is working…` : event.type === 'tool-start' ? `Running ${event.tool.replaceAll('_', ' ')}…` : 'Waiting for the model…';
          setStatus(text); setEvents(previous => [...previous.slice(-11), text]);
          if (event.files) onPreview({ files: event.files, values: mode === 'edit' ? values : {} });
        } });
      }
      if (!live()) return;
      onPreview({ files: mode === 'content' ? files : result.files, values: result.values });
      setDraft({ kind: mode, ...result }); setStatus('Ready to review. Changes are visible in files and preview.');
    } catch (error) { if (sequence.current === id) { setError(controller.signal.aborted ? 'Generation cancelled or timed out. Your project is unchanged.' : error.message); setStatus(''); onPreview(null); } }
    finally { clearTimeout(timeout); if (sequence.current === id) { request.current = null; setWorking(false); onBusyChange(false); } }
  }
  function apply() {
    if (!draft) return;
    const success = draft.kind === 'content' ? onApply(draft.values) : onApplyProject(draft.files, draft.values);
    if (success === false) return;
    setDraft(null); onPreview(null); setStatus('Changes applied to your project.');
  }
  return <section className="ai-panel" aria-labelledby="ai-panel-title"><div className="ai-panel-heading"><span className="ai-icon"><Sparkles size={16} /></span><div><div className="section-kicker">OPENROUTER</div><h2 id="ai-panel-title">Your landing assistant</h2></div><button className="btn btn-ghost btn-xs btn-square" aria-label="AI connection settings" disabled={working || Boolean(draft)} onClick={onSettings}><Settings2 size={16} /></button></div>{!settings?.apiKey && <p className="field-help">Connect your key in <button className="text-link" onClick={onSettings}>Settings</button> to start.</p>}<div className="ai-mode" role="group" aria-label="AI action">{[['edit', 'Edit project'], ['create', 'Create new'], ['content', 'Fill content']].map(([key, label]) => <button key={key} disabled={working || Boolean(draft) || (key === 'content' && !definition)} aria-pressed={mode === key} className={mode === key ? 'selected' : ''} onClick={() => { setMode(key); setError(''); setStatus(''); }}>{label}</button>)}</div><p className="field-help">{mode === 'edit' ? 'Describe what to change. The assistant reads your existing files and preserves the rest.' : mode === 'create' ? 'Build a new template. Applying it will replace the current project’s files.' : 'Fill editable fields while preserving the template’s structure.'}</p><label className="field ai-prompt"><span>{mode === 'edit' ? 'What should change?' : mode === 'create' ? 'Describe your landing page' : 'Business, offer, audience and language'}</span><textarea className="textarea w-full" rows={5} maxLength={6000} value={prompt} disabled={working || Boolean(draft)} onChange={event => setPrompt(event.target.value)} placeholder={mode === 'edit' ? 'Add a FAQ below the pricing section. Keep the current colors and typography…' : 'Describe the product, target audience, content and visual direction…'} /></label><div className="ai-actions"><button className="btn btn-primary btn-sm" disabled={working || Boolean(draft) || !settings?.apiKey || !prompt.trim()} onClick={generate}>{working ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{working ? 'Working…' : 'Generate changes'}</button>{working && <button className="btn btn-ghost btn-sm" onClick={() => request.current?.abort()}>Cancel</button>}</div><p className="ai-disclosure">{mode === 'edit' ? 'Your prompt, current values and source files read by the assistant are sent to OpenRouter and the selected provider. Binary assets are not sent.' : mode === 'content' ? 'Your prompt, field definitions, current values and image paths are sent to OpenRouter and the selected provider.' : 'Your prompt and generated source files are sent to OpenRouter and the selected provider.'} Requests use your paid account. Files are saved only after you apply the changes.</p>{working && <div className="ai-progress" role="status"><LoaderCircle size={14} className="spin" /><span>{elapsed}s · {received ? `${received.toLocaleString()} characters received` : 'Waiting for first response'}</span></div>}{status && <p className="ai-message" role="status">{status}</p>}{events.length > 0 && <ol className="ai-activity" aria-label="AI activity">{events.map((event, index) => <li key={index}>{event}</li>)}</ol>}{error && <div className="ai-message error" role="alert">{error}</div>}{draft && <div className="ai-draft"><strong>{draft.kind === 'content' ? 'Content ready' : 'Changes ready'}</strong>{draft.summary && <p>{draft.summary}</p>}{draft.kind === 'content' ? <pre className="ai-values-preview">{JSON.stringify(draft.values, null, 2)}</pre> : <p className="field-help">{Object.keys(draft.files).length} files · {draft.steps} steps. Inspect Source code and Live preview before applying.</p>}<div className="ai-actions"><button className="btn btn-primary btn-sm" onClick={apply}><Check size={14} /> Apply changes</button><button className="btn btn-ghost btn-sm" onClick={discard}><X size={14} /> Discard</button></div></div>}</section>;
}
