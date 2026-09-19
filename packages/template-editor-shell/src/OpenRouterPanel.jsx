import { useStudioText } from './studio-i18n.js';
import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Settings2, Sparkles, X } from 'lucide-react';
import { fillTemplateWithOpenRouter } from './openrouter-ai.js';
import { useStudioHost } from './host-context.js';
import { AI_RUN_TIMEOUT_MS } from './ai-limits.js';

export default function OpenRouterPanel({ definition, values, files, onApply, onApplyProject, onPreview, onBusyChange, onSettings, onConfirmCreate, onOpenFile, allowInitialStart = true, disabled = false }) {
  const t = useStudioText();
  const host = useStudioHost();
  const loadConnection = () => host.ai.settings.load();
  const initialRequest = host.ai.initialRequest;
  const [settings, setSettings] = useState(null), [mode, setMode] = useState(initialRequest?.mode || 'edit'), [prompt, setPrompt] = useState(initialRequest?.prompt || '');
  const initialAttempted = useRef(false);
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [draft, setDraft] = useState(null), [events, setEvents] = useState([]), [elapsed, setElapsed] = useState(0), [received, setReceived] = useState(0);
  const request = useRef(null), sequence = useRef(0), instructions = useRef([]), committedFiles = useRef(files), accepting = useRef(false);
  const [clarification, setClarification] = useState(''), [queued, setQueued] = useState(0), [sent, setSent] = useState(0);
  const [liveFile, setLiveFile] = useState(null), [fileChanges, setFileChanges] = useState({});
  function clarify() {
    const text = clarification.trim();
    if (!working || !accepting.current || !request.current || request.current.signal.aborted || !text || sent >= 8) return;
    instructions.current.push(text); setQueued(instructions.current.length); setSent(value => value + 1); setClarification('');
    setEvents(previous => [...previous.slice(-11), t("Clarification queued: {text}", { text })]);
  }

  useEffect(() => {
    let alive = true;
    const load = () => loadConnection().then(value => { if (alive) setSettings(value); }).catch(error => { if (alive) setError(error.message); });
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; sequence.current++; request.current?.abort(); window.removeEventListener('trafficops-ai-settings', load); };
  }, []);
  useEffect(() => { if (!working) return; const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [working]);
  useEffect(() => {
    if (disabled || initialAttempted.current || !initialRequest || settings === null) return;
    initialAttempted.current = true;
    // The host claims the request before any provider call. Prompt edits or local
    // project changes cancel automatic startup and leave the request for review.
    if (initialRequest.autoStart && settings.configured && allowInitialStart && prompt === initialRequest.prompt && mode === initialRequest.mode) generate(null, true);
  }, [settings, initialRequest, allowInitialStart, prompt, mode, disabled]);
  function discard() { setDraft(null); setError(''); setLiveFile(null); setFileChanges({}); onPreview(null); setStatus(t("Changes discarded. Your project is unchanged.")); }
  async function generate(recovery = null, initial = false) {
    if (disabled) return;
    if (!recovery && !initial && mode === 'create' && !(await onConfirmCreate())) return;
    if (request.current) return;
    const id = ++sequence.current, controller = new AbortController(); request.current = controller;
    const runMode = recovery ? 'edit' : mode, runFiles = recovery?.files || files;
    const runValues = recovery?.values || (mode === 'edit' ? values : {});
    const runPrompt = recovery ? `Continue from the retained draft. Preserve completed work and finish the original request.${recovery.error ? ` Repair the reported problem: ${recovery.error.slice(0, 1000)}` : ''}\nOriginal request: ${prompt}`.slice(0, 6000) : prompt;
    let completedChanges = Boolean(recovery), completedSteps = recovery?.steps || 0;
    let timedOut = false, timeoutMs = AI_RUN_TIMEOUT_MS;
    const expire = () => { timedOut = true; controller.abort(); };
    let timeout = setTimeout(expire, timeoutMs);
    setWorking(true); onBusyChange(true); setDraft(null); onPreview(recovery ? { files: runFiles, values: runValues } : null); setError(''); setEvents([]); setElapsed(0); setReceived(0); setStatus(t("Connecting to OpenRouter…"));
    accepting.current = true; instructions.current = []; committedFiles.current = runMode === 'create' ? {} : runFiles;
    setClarification(''); setQueued(0); setSent(0); setLiveFile(null); if (!recovery) setFileChanges({});
    let started = false;
    const live = () => sequence.current === id && !controller.signal.aborted;
    try {
      if (initial && !(await initialRequest.claim({ signal: controller.signal }))) {
        setStatus(t("This creation request has already started. You can retry manually."));
        return;
      }
      const connection = await host.ai.begin({ signal: controller.signal }); started = true;
      controller.signal.throwIfAborted();
      if (Number.isFinite(connection.timeoutMs) && connection.timeoutMs > 0) timeoutMs = connection.timeoutMs;
      clearTimeout(timeout); timeout = setTimeout(expire, timeoutMs);
      if (!connection.apiKey) throw new Error(t("Add your OpenRouter connection in Settings first."));
      let result;
      if (mode === 'content') result = await fillTemplateWithOpenRouter({ ...connection, validateDraft: host.validateAiDraft, prompt, definition, values, files, signal: controller.signal });
      else {
        const { generateTemplateWithOpenRouterAgent } = await import('./openrouter-template-agent.js');
        controller.signal.throwIfAborted();
        result = await generateTemplateWithOpenRouterAgent({ ...connection, validateDraft: host.validateAiDraft, prompt: runPrompt, mode: runMode, files: runFiles, values: runValues, signal: controller.signal, stream: true, timeout: timeoutMs, takeInstructions: () => instructions.current.splice(0), onProgress(event) {
          if (!live()) return;
          if (event.type === 'receiving') { setReceived(event.received); return; }
          if (event.type === 'file-set' || event.type === 'file-removed') completedChanges = true;
          if (event.type === 'step-finished') completedSteps = event.step;
          if (event.type === 'instructions-received') setQueued(instructions.current.length);
          if (event.files) {
            if (!event.partial) committedFiles.current = event.files;
            onPreview({ files: event.files, renderFiles: committedFiles.current, values: runValues, partial: Boolean(event.partial) });
            const path = event.path;
            if (event.type === 'draft-sync') setLiveFile(previous => previous && typeof event.files[previous.path] === 'string' ? { ...previous, content: event.files[previous.path], partial: false } : null);
            else if (path && typeof event.files[path] === 'string') setLiveFile({ path, content: event.files[path], partial: Boolean(event.partial) });
            else if (path) setLiveFile(previous => previous?.path === path ? null : previous);
          }
          if (event.type === 'file-stream' || event.type === 'draft-sync') return;
          if (event.type === 'file-set' || event.type === 'file-removed') setFileChanges(previous => ({ ...previous, ...Object.fromEntries((event.paths || [event.path]).map(path => [path, event.type === 'file-removed' ? 'deleted' : 'updated'])) }));
          const text = event.type === 'timeout-recovery' ? t("The provider timed out. Retrying once with smaller file writes…") : event.type === 'instructions-received' ? t("Clarification received. Continuing with your changes.") : event.type === 'file-set' ? t("Updated {paths}", { paths: (event.paths || [event.path]).join(', ') }) : event.type === 'file-removed' ? t("Removed {path}", { path: event.path }) : event.type === 'files-read' ? t("Read {paths}", { paths: event.paths.join(', ') }) : event.type === 'step-finished' ? t("Step {step} completed in {seconds}s", { step: event.step, seconds: event.seconds.toFixed(1) }) : event.type === 'validation' ? event.valid ? t("Template validation passed") : t("Repairing: {error}", { error: event.error }) : event.type === 'step' ? t("Step {step}: model is working…", { step: event.step }) : event.type === 'tool-start' ? t("Running {tool}…", { tool: event.tool.replaceAll('_', ' ') }) : t("Waiting for the model…");
          setStatus(text); setEvents(previous => [...previous.slice(-11), text]);
        } });
      }
      accepting.current = false;
      if (!live()) return;
      onPreview({ files: mode === 'content' ? files : result.files, values: result.values });
      setDraft({ kind: mode, ...result });
      setError(result.valid === false ? result.error : '');
      setStatus(result.valid === false ? t("Generation needs more work. Completed files are retained for review or continuation.") : t("Ready to review. Changes are visible in files and preview."));
    } catch (error) {
      accepting.current = false;
      if (sequence.current === id) {
        const retained = mode !== 'content' && completedChanges && (recovery || timedOut || !controller.signal.aborted);
        const message = timedOut && retained ? t("Generation timed out. Completed files are retained.") : timedOut ? t("Generation exceeded {minutes} minutes. Your project is unchanged.", { minutes: Math.round(timeoutMs / 60000) }) : controller.signal.aborted ? t("Generation cancelled. Your project is unchanged.") : t(error.message);
        setError(message); setLiveFile(null);
        if (retained) {
          // Only completed tool operations are recoverable, never streamed fragments.
          const retainedFiles = controller.signal.aborted && !timedOut && recovery ? recovery.files : committedFiles.current;
          setDraft({ kind: mode, files: retainedFiles, values: runValues, valid: false, error: message, steps: completedSteps });
          onPreview({ files: retainedFiles, values: runValues });
          setStatus(t("Generation needs more work. Completed files are retained for review or continuation."));
        } else { setStatus(''); setFileChanges({}); onPreview(null); }
      }
    }
    finally { clearTimeout(timeout); if (started) await host.ai.finish().catch(() => {}); if (sequence.current === id) { request.current = null; setWorking(false); onBusyChange(false); } }
  }
  function apply() {
    if (!draft) return;
    const success = draft.kind === 'content' ? onApply(draft.values) : onApplyProject(draft.files, draft.values, { mode: draft.kind });
    if (success === false) return;
    setDraft(null); setError(''); setLiveFile(null); setFileChanges({}); onPreview(null); setStatus(t("Changes applied to your project."));
  }
  return <section className="ai-panel ai-panel--tab" data-working={working} aria-labelledby="ai-panel-title"><div className="ai-panel-heading"><span className="ai-icon"><Sparkles size={16} /></span><div><div className="section-kicker">OPENROUTER</div><h2 id="ai-panel-title">{t("Your landing assistant")}</h2></div><button className="btn btn-ghost btn-xs btn-square" aria-label={t("AI connection settings")} disabled={disabled || working || Boolean(draft)} onClick={onSettings}><Settings2 size={16} /></button></div>{!settings?.configured && <p className="field-help">{t("Connect your key in")} <button className="text-link" onClick={onSettings}>{t("Settings")}</button> {t("to start.")}</p>}<div className="ai-mode" role="group" aria-label={t("AI action")}>{[['edit', t("Edit project")], ['content', t("Fill content")]].map(([key, label]) => <button key={key} disabled={disabled || working || Boolean(draft) || (key === 'content' && !definition)} aria-pressed={mode === key} className={mode === key ? 'selected' : ''} onClick={() => { setMode(key); setError(''); setStatus(''); }}>{label}</button>)}</div><div className="ai-create-action"><button type="button" className="btn btn-ghost btn-xs" aria-pressed={mode === 'create'} disabled={disabled || working || Boolean(draft)} onClick={() => setMode('create')}>{t("Create new project")}</button><small>{t("Replaces all files in this project.")}</small></div><p className="field-help ai-intro">{mode === 'edit' ? t("Describe what to change. The assistant reads your existing files and preserves the rest.") : mode === 'create' ? t("Build a new template. Applying it will replace the current project’s files.") : t("Fill editable fields while preserving the template’s structure.")}</p><label className="field ai-prompt"><span>{mode === 'edit' ? t("What should change?") : mode === 'create' ? t("Describe your landing page") : t("Business, offer, audience and language")}</span><textarea className="textarea w-full" rows={5} maxLength={6000} value={prompt} disabled={disabled || working || Boolean(draft)} onChange={event => setPrompt(event.target.value)} placeholder={mode === 'edit' ? t("Add a FAQ below the pricing section. Keep the current colors and typography…") : t("Describe the product, target audience, content and visual direction…")} /></label>{working && <details className="ai-current-request"><summary>{t("Current request")}</summary><p>{prompt}</p></details>}<div className="ai-actions"><button className="btn btn-primary btn-sm" disabled={disabled || working || Boolean(draft) || !settings?.configured || !prompt.trim()} onClick={() => generate()}>{working ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{working ? t("Working…") : t("Generate changes")}</button>{working && <button className="btn btn-ghost btn-sm" onClick={() => request.current?.abort()}>{t("Cancel")}</button>}</div><p className="ai-disclosure">{mode === 'edit' ? t("Your prompt, current values and source files read by the assistant are sent to OpenRouter and the selected provider. Binary assets are not sent.") : mode === 'content' ? t("Your prompt, field definitions, current values and image paths are sent to OpenRouter and the selected provider.") : t("Your prompt and generated source files are sent to OpenRouter and the selected provider.")} {mode === 'content' ? t("Requests use your paid account. Files are saved only after you apply the changes.") : t("Requests use your paid account. File changes appear here as the assistant writes. Apply the reviewed changes to keep them.")} {mode !== 'content' && t("A provider timeout may trigger one automatic recovery attempt within the run limit.")}</p>{working && !draft && !error && mode !== 'content' && <div className="ai-steering"><label className="field"><span>{t("Clarify while the assistant works")}</span><textarea className="textarea w-full" rows={2} maxLength={6000} value={clarification} disabled={sent >= 8} onChange={event => setClarification(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); clarify(); } }} placeholder={t("For example: keep the header and use warmer colors…")} /></label><div className="ai-actions"><button type="button" className="btn btn-outline btn-sm" disabled={!clarification.trim() || sent >= 8} onClick={clarify}>{t("Send clarification")}</button><small role="status">{queued ? t("Queued for the next model step: {count}", { count: queued }) : sent >= 8 ? t("Clarification limit reached for this run.") : t("The assistant receives your clarification at the next step.")}</small></div></div>}{liveFile && <div className="ai-live-file"><div className="ai-live-heading"><button type="button" className="text-link" onClick={() => onOpenFile?.(liveFile.path)}>{liveFile.path}</button><small>{liveFile.partial ? t("Writing…") : t("Updated")}</small></div><pre aria-label={t("Live file changes")}>{liveFile.content.slice(-6000)}</pre></div>}{Object.keys(fileChanges).length > 0 && <ul className="ai-file-changes" aria-label={t("Changed files")}>{Object.entries(fileChanges).map(([path, kind]) => <li key={path}>{kind === 'deleted' ? <span>{t("Deleted {path}", { path })}</span> : <button type="button" className="text-link" onClick={() => onOpenFile?.(path)}>{path}</button>}</li>)}</ul>}{working && <div className="ai-progress" role="status"><LoaderCircle size={14} className="spin" /><span>{elapsed}s · {received ? t("{count} characters received", { count: received.toLocaleString() }) : t("Waiting for first response")}</span></div>}{status && <p className="ai-message" role="status">{status}</p>}{events.length > 0 && <ol className="ai-activity" aria-label={t("AI activity")}>{events.map((event, index) => <li key={index}>{event}</li>)}</ol>}{error && <div className="ai-message error" role="alert">{error}</div>}{draft && <div className="ai-draft"><strong>{draft.valid === false ? t("Draft needs attention") : draft.kind === 'content' ? t("Content ready") : t("Changes ready")}</strong>{draft.summary && <p>{draft.summary}</p>}{draft.kind === 'content' ? <pre className="ai-values-preview">{JSON.stringify(draft.values, null, 2)}</pre> : <p className="field-help">{Object.keys(draft.files).length} {t("files ·")} {draft.steps} {t("steps. Inspect Source code and Live preview before applying.")}</p>}<div className="ai-actions"><button className="btn btn-primary btn-sm" onClick={apply}><Check size={14} /> {draft.valid === false ? t("Keep draft in editor") : t("Apply changes")}</button>{draft.valid === false && <button className="btn btn-outline btn-sm" onClick={() => generate(draft)}>{t("Continue generation")}</button>}<button className="btn btn-ghost btn-sm" onClick={discard}><X size={14} /> {t("Discard")}</button></div></div>}</section>;
}
