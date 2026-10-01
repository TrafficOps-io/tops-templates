import { useStudioText } from './studio-i18n.js';
import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Settings2, Sparkles, X } from 'lucide-react';
import PromptImages from './PromptImages.jsx';
import { useStudioHost } from './host-context.js';
import { AI_RUN_TIMEOUT_MS } from './ai-limits.js';
import { createAiDiagnostics } from './ai-diagnostics.js';
import AiRunSummary from './AiRunSummary.jsx';
import { resolveImageGeneration } from './ai-image-choice.js';
import { assertBlockDraftScope, blockScopeSourceTargets, serializeBlockEditScope, validateBlockEditScope } from './block-edit-scope.js';
import { blockScopeBaseMatches, sameProjectFiles } from './preview-selection.js';

export default function OpenRouterPanel({ definition, values, rawValues = values, files, editScope, editScopeStale = false, onClearEditScope, onRecoverScope, onApply, onApplyProject, onPreview, onBusyChange, onSettings, onConfirmCreate, onOpenFile, allowInitialStart = true, disabled = false }) {
  const t = useStudioText();
  const host = useStudioHost();
  const loadConnection = () => host.ai.settings.load();
  const initialRequest = host.ai.initialRequest;
  const [settings, setSettings] = useState(null), [mode, setMode] = useState(initialRequest?.mode || 'edit'), [prompt, setPrompt] = useState(initialRequest?.prompt || '');
  const initialAttempted = useRef(false), promptRef = useRef(null);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [attachments, setAttachments] = useState(initialRequest?.attachments || []), [imageChoice, setImageChoice] = useState(initialRequest?.generateImages), [phase, setPhase] = useState(''), [review, setReview] = useState(null);
  const generateImages = !editScope && resolveImageGeneration(imageChoice, settings);
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [draft, setDraft] = useState(null), [events, setEvents] = useState([]), [elapsed, setElapsed] = useState(0), [received, setReceived] = useState(0);
  const draftTransition = useRef(false), [transitioning, setTransitioning] = useState(false);
  const activeScope = draft?.editScope || editScope;
  const activeRunScope = useRef(null);
  const [scopeNotice, setScopeNotice] = useState('');
  function describeScope(scope) {
    if (scope.intent === 'content') return t('Content changes affect only the selected instances.');
    if (!scope.intent) return '';
    const sourceIds = new Set(blockScopeSourceTargets(scope).map(source => source.id));
    const count = scope.blockInstances.filter(instance => sourceIds.has(instance.sourceId)).length;
    return t('Template changes affect all {count} instances of these source blocks.', { count });
  }
  const request = useRef(null), sequence = useRef(0), instructions = useRef([]), committedFiles = useRef(files), committedValues = useRef(values), accepting = useRef(false);
  const [clarification, setClarification] = useState(''), [queued, setQueued] = useState(0), [sent, setSent] = useState(0);
  const [liveFile, setLiveFile] = useState(null), [fileChanges, setFileChanges] = useState({});
  const [diagnostics, setDiagnostics] = useState(null);
  const recoveryPort = host.ai.recovery;
  const [recoveryLoading, setRecoveryLoading] = useState(Boolean(recoveryPort)), [recoveryConflict, setRecoveryConflict] = useState(null), [recoveryError, setRecoveryError] = useState(''), [recoverySaved, setRecoverySaved] = useState(false), [recoveryApplying, setRecoveryApplying] = useState(false);
  const recoveryToken = useRef(null), recoveryPending = useRef(null), recoveryWriting = useRef(null), recoveryAlive = useRef(true), allClarifications = useRef([]);
  const workingProject = useRef({ files, rawValues }); workingProject.current = { files, rawValues };
  function recoverySnapshot(next) {
    recoveryToken.current ||= crypto.randomUUID();
    return { token: recoveryToken.current, kind: next.kind || mode, prompt, attachments, clarifications: [...allClarifications.current], ...(imageChoice === undefined ? {} : { generateImages: imageChoice }),
      files: next.files, values: next.values, valid: next.valid === true, steps: next.steps || 0, summary: next.summary || '',
      ...((next.editScope || activeRunScope.current) ? { editScope: serializeBlockEditScope(next.editScope || activeRunScope.current) } : {}) };
  }
  function persistRecovery(next) {
    if (!recoveryPort || !Object.keys(next.files || {}).length) return Promise.resolve(true);
    recoveryPending.current = recoverySnapshot(next);
    if (recoveryWriting.current) return recoveryWriting.current;
    // Coalesce completed snapshots while an IndexedDB write is in flight. Never
    // retain a queue of whole projects or persist speculative source fragments.
    recoveryWriting.current = (async () => {
      let succeeded = true;
      while (recoveryPending.current) {
        const snapshot = recoveryPending.current; recoveryPending.current = null;
        try { await recoveryPort.save(snapshot); if (recoveryAlive.current) { setRecoveryError(''); setRecoverySaved(true); } }
        catch (error) { succeeded = false; if (recoveryAlive.current) { setRecoveryError(t(error.message)); setRecoverySaved(false); } }
      }
      return succeeded;
    })().finally(() => { recoveryWriting.current = null; if (recoveryPending.current) void persistRecovery(recoveryPending.current); });
    return recoveryWriting.current;
  }
  async function flushRecovery() { while (recoveryWriting.current) await recoveryWriting.current; }
  async function exportRecovery(fromMemory = false) {
    try {
      const archive = fromMemory ? await recoveryPort.download(recoverySnapshot(draft)) : await recoveryPort.export(recoveryConflict.token);
      const url = URL.createObjectURL(new Blob([archive.bytes], { type: archive.mime }));
      const link = document.createElement('a'); link.href = url; link.download = archive.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setRecoveryError(t(error.message)); }
  }
  function downloadDiagnostics() {
    if (!diagnostics) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `landing-studio-ai-${diagnostics.startedAt.replaceAll(':', '-')}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function clarify() {
    const text = clarification.trim();
    if (!text || sent >= 8) return;
    if (!working && draft?.editScope && draft.valid === false) {
      allClarifications.current.push(text); setClarification('');
      void generate(draft);
      return;
    }
    if (!working || !accepting.current || !request.current || request.current.signal.aborted) return;
    instructions.current.push(text); setQueued(instructions.current.length); setSent(value => value + 1); setClarification('');
    allClarifications.current.push(text);
    if (recoveryPort && Object.keys(committedFiles.current).length) void persistRecovery({ kind: mode, files: committedFiles.current, values: committedValues.current, valid: false, steps: 0 });
    setEvents(previous => [...previous.slice(-11), t("Clarification queued: {text}", { text })]);
  }

  useEffect(() => {
    let alive = true;
    const load = () => loadConnection().then(value => { if (alive) setSettings(value); }).catch(error => { if (alive) setError(error.message); });
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; sequence.current++; request.current?.abort(); window.removeEventListener('trafficops-ai-settings', load); };
  }, []);
  useEffect(() => { if (!working) return; const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [working]);
  useEffect(() => { if (editScope && !working && !draft) { setMode('edit'); promptRef.current?.focus(); } }, [editScope]);
  useEffect(() => {
    recoveryAlive.current = true;
    if (!recoveryPort) return () => { recoveryAlive.current = false; };
    const loadBase = { files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, typeof content === 'string' ? content : content.slice()])), rawValues: structuredClone(rawValues) };
    onBusyChange(true);
    const unsubscribe = recoveryPort.subscribe?.(message => { if (recoveryAlive.current) { setRecoveryError(t(message)); if (!message) setRecoveryApplying(false); } });
    recoveryPort.load().then(recovered => {
      if (!recoveryAlive.current || !recovered) return;
      initialAttempted.current = true;
      const record = recovered.record;
      recoveryToken.current = record.token;
      allClarifications.current = record.clarifications || [];
      if (recovered.conflict) { setRecoveryConflict(record); return; }
      if (!sameProjectFiles(loadBase.files, workingProject.current.files) || JSON.stringify(loadBase.rawValues) !== JSON.stringify(workingProject.current.rawValues)) {
        setRecoveryConflict({ ...record, workingConflict: true }); return;
      }
      if (record.editScope) {
        const scope = validateBlockEditScope(record.editScope);
        assertBlockDraftScope(scope, { files: record.files, rawValues: record.values });
        activeRunScope.current = scope; setScopeNotice(describeScope(scope)); onRecoverScope?.(scope);
      }
      setMode(record.kind); setPrompt(record.prompt); setAttachments(record.attachments); setImageChoice(record.generateImages);
      setDraft(record); setPhase(record.valid ? 'ready' : 'generate'); setRecoverySaved(true);
      setStatus(t('AI draft restored from this device. Review it or continue manually; generation has not restarted.'));
      onPreview({ files: record.files, values: record.values });
    }).catch(error => { if (recoveryAlive.current) { initialAttempted.current = true; setRecoveryError(t(error.message)); } })
      .finally(() => { if (recoveryAlive.current) { setRecoveryLoading(false); onBusyChange(false); } });
    return () => { recoveryAlive.current = false; unsubscribe?.(); onBusyChange(false); };
  }, [recoveryPort]);
  useEffect(() => {
    if (disabled || recoveryLoading || initialAttempted.current || !initialRequest || settings === null) return;
    initialAttempted.current = true;
    // The host claims the request before any provider call. Prompt edits or local
    // project changes cancel automatic startup and leave the request for review.
    if (initialRequest.autoStart && settings.configured && allowInitialStart && prompt === initialRequest.prompt && mode === initialRequest.mode) generate(null, true);
  }, [settings, initialRequest, allowInitialStart, prompt, mode, disabled, recoveryLoading]);
  async function discard() {
    if (draftTransition.current) return;
    draftTransition.current = true; setTransitioning(true);
    try {
    if (recoveryPort && recoveryToken.current) {
      await flushRecovery();
      try { await recoveryPort.discard(recoveryToken.current); } catch (error) { setRecoveryError(t(error.message)); return; }
    }
    recoveryToken.current = null; allClarifications.current = []; setRecoveryConflict(null); setRecoverySaved(false); setRecoveryError('');
    setDraft(null); setError(''); setReview(null); setPhase(''); setLiveFile(null); setFileChanges({}); onPreview(null); setStatus(t("Changes discarded. Your project is unchanged."));
    } finally { draftTransition.current = false; setTransitioning(false); }
  }
  async function generate(recovery = null, initial = false) {
    if (draftTransition.current || disabled || readingAttachments || recoveryLoading || recoveryConflict || recoveryApplying) return;
    if (!recovery && editScope && editScopeStale) { setError(t('The selected preview is outdated. Refresh preview and select the blocks again.')); return; }
    if (!recovery && !initial && mode === 'create' && !(await onConfirmCreate())) return;
    if (request.current) return;
    const id = ++sequence.current, controller = new AbortController(); request.current = controller;
    if (!recovery) { recoveryToken.current = crypto.randomUUID(); allClarifications.current = []; setRecoverySaved(false); }
    const runScope = recovery?.editScope || editScope;
    activeRunScope.current = runScope || null;
    const runMode = runScope ? 'edit' : recovery ? mode === 'content' ? 'content' : 'edit' : mode, runFiles = recovery?.files || files;
    const runValues = recovery?.values || (runMode === 'create' ? {} : values);
    const continuation = recovery ? 'Continue from the retained draft. Preserve completed work and finish the original request.\n' : '';
    // Preserve the complete original brief at the public input limit. Retained
    // files already carry continuation context when the prefix will not fit.
    const runPrompt = continuation && continuation.length + prompt.length <= 6000 ? continuation + prompt : prompt;
    let completedChanges = Boolean(recovery), completedSteps = recovery?.steps || 0;
    let timedOut = false, timeoutMs = AI_RUN_TIMEOUT_MS;
    const expire = () => { timedOut = true; controller.abort(); };
    let timeout = setTimeout(expire, timeoutMs);
    setPhase('plan'); setReview(null); setScopeNotice(''); setWorking(true); onBusyChange(true); setDraft(null); onPreview(recovery ? { files: runFiles, values: runValues } : null); setError(''); setEvents([]); setElapsed(0); setReceived(0); setStatus(t("Connecting to OpenRouter…"));
    accepting.current = true; instructions.current = recovery ? [...allClarifications.current] : []; committedFiles.current = runMode === 'create' ? {} : runFiles; committedValues.current = runScope ? recovery?.values || rawValues : runValues;
    setClarification(''); setQueued(instructions.current.length); setSent(allClarifications.current.length); setLiveFile(null); if (!recovery) setFileChanges({});
    let started = false;
    let diagnosticLog;
    setDiagnostics(null);
    const live = () => sequence.current === id && !controller.signal.aborted;
    try {
      if (initial && !(await initialRequest.claim({ signal: controller.signal }))) {
        setStatus(t("This creation request has already started. You can retry manually."));
        return;
      }
      // Restoring a draft can finish before the editor's debounced analysis.
      // Resolve the content schema locally before any provider request.
      const runDefinition = runMode === 'content'
        ? (await host.validateAiDraft({ files: runFiles, values: runValues, mode: 'edit', schemaOnly: true, signal: controller.signal })).definition
        : definition;
      const connection = await host.ai.begin({ signal: controller.signal }); started = true;
      controller.signal.throwIfAborted();
      if (Number.isFinite(connection.timeoutMs) && connection.timeoutMs > 0) timeoutMs = connection.timeoutMs;
      clearTimeout(timeout); timeout = setTimeout(expire, timeoutMs);
      if (!connection.apiKey) throw new Error(t("Add your OpenRouter connection in Settings first."));
      diagnosticLog = createAiDiagnostics({ ...connection, mode: runMode });
      const { runStudioAiWorkflow } = await import('./studio-ai-workflow.js');
      controller.signal.throwIfAborted();
      const result = await runStudioAiWorkflow({ ...connection, validateDraft: host.validateAiDraft, prompt: runPrompt, mode: runMode, files: runFiles, values: runValues,
        ...(runScope ? { editScope: runScope, rawValues: recovery?.values || rawValues } : {}), definition: runDefinition,
        attachments: runScope ? attachments.map(item => ({ ...item, useOnPage: false })) : attachments, generateImages: runScope ? false : imageChoice,
        signal: controller.signal, stream: true, timeout: timeoutMs, takeInstructions: () => instructions.current.splice(0), onProgress(event) {
          if (!live()) return;
          if (event.editScope) activeRunScope.current = event.editScope;
          if (event.type === 'scope') { setScopeNotice(describeScope(event.editScope)); return; }
          if (diagnosticLog.record(event)) setDiagnostics(diagnosticLog.snapshot());
          if (event.type === 'request-start' || event.type === 'request-finished' || event.type === 'provider-error') return;
          if (event.type === 'phase') { setPhase(event.phase); return; }
          if (event.type === 'review') { setReview(event.review); return; }
          if (event.type === 'plan') { setEvents(previous => [...previous, event.plan.summary]); return; }
          if (event.values) committedValues.current = event.values;
          if (event.type === 'receiving') { setReceived(event.received); return; }
          if (event.type === 'file-set' || event.type === 'file-removed' || event.type === 'values-set') completedChanges = true;
          if (event.type === 'step-finished') completedSteps = event.step;
          if (event.type === 'instructions-received') setQueued(instructions.current.length);
          if (event.files) {
            if (!event.partial) committedFiles.current = event.files;
            onPreview({ files: event.files, renderFiles: committedFiles.current, values: committedValues.current, partial: Boolean(event.partial) });
            const path = event.path;
            if (event.type === 'draft-sync') setLiveFile(previous => previous && typeof event.files[previous.path] === 'string' ? { ...previous, content: event.files[previous.path], partial: false } : null);
            else if (path && typeof event.files[path] === 'string') setLiveFile({ path, content: event.files[path], partial: Boolean(event.partial) });
            else if (path) setLiveFile(previous => previous?.path === path ? null : previous);
          }
          if (completedChanges && !event.partial && ['file-set', 'file-removed', 'values-set'].includes(event.type)) {
            void persistRecovery({ files: committedFiles.current, values: committedValues.current, valid: false, steps: completedSteps });
          }
          if (event.type === 'file-stream' || event.type === 'draft-sync') return;
          if (event.type === 'file-set' || event.type === 'file-removed') setFileChanges(previous => ({ ...previous, ...Object.fromEntries((event.paths || [event.path]).map(path => [path, event.type === 'file-removed' ? 'deleted' : 'updated'])) }));
          const text = event.type === 'tool-validation' ? event.issueCode === 'too_big' && Number.isFinite(event.inputChars) && Number.isFinite(event.limit) ? t('The model sent {count} characters for one operation; the limit is {limit}.', { count: event.inputChars.toLocaleString(), limit: event.limit.toLocaleString() }) : event.issueCode === 'unknown_tool' ? t('The model selected an unavailable action.') : t('The model sent incomplete or invalid tool arguments.') : event.type === 'values-set' ? t('Content fields updated') : event.type === 'content-recovery' ? t('The model returned no changes. Asking once for field updates…') : event.type === 'image-start' ? t('Generating image {path}', { path: event.path }) : event.type === 'image-error' ? t('Image generation failed: {error}', { error: event.error }) : event.type === 'provider-recovery' ? t('The provider is temporarily unavailable. Retrying once…') : event.type === 'timeout-recovery' ? t("The provider timed out. Retrying once with smaller file writes…") : event.type === 'instructions-received' ? t("Clarification received. Continuing with your changes.") : event.type === 'file-set' ? t("Updated {paths}", { paths: (event.paths || [event.path]).join(', ') }) : event.type === 'file-removed' ? t("Removed {path}", { path: event.path }) : event.type === 'files-read' ? t("Read {paths}", { paths: event.paths.join(', ') }) : event.type === 'step-finished' ? t("Step {step} completed in {seconds}s", { step: event.step, seconds: event.seconds.toFixed(1) }) : event.type === 'validation' ? event.valid ? t("Template validation passed") : t("Repairing: {error}", { error: event.error }) : event.type === 'step' ? t("Step {step}: model is working…", { step: event.step }) : event.type === 'tool-start' ? t("Running {tool}…", { tool: event.tool.replaceAll('_', ' ') }) : t("Waiting for the model…");
          setStatus(text); setEvents(previous => [...previous.slice(-11), text]);
      } });
      accepting.current = false;
      if (!live()) return;
      if (result.needsClarification) {
        const message = t(result.clarification || result.error);
        setError(message); setStatus(''); setPhase('');
        if (recovery) {
          const retained = { ...recovery, valid: false, error: message };
          setDraft(retained); onPreview({ files: retained.files, values: retained.values });
          await persistRecovery(retained);
        } else { setDraft(null); onPreview(null); }
        setDiagnostics(diagnosticLog.finish(new Error(result.clarification || result.error)));
        return;
      }
      if (result.editScope) { activeRunScope.current = result.editScope; assertBlockDraftScope(result.editScope, { files: result.files, rawValues: result.values }); }
      await persistRecovery({ kind: mode, ...result }); await flushRecovery();
      controller.signal.throwIfAborted();
      onPreview({ files: result.files, values: result.values });
      setDraft({ kind: mode, ...result });
      setError(result.valid === false ? result.error : '');
      setStatus(result.valid === false ? t("Generation needs more work. Completed files are retained for review or continuation.") : t("Ready to review. Changes are visible in files and preview."));
      setDiagnostics(diagnosticLog.finish(result.valid === false ? new Error(result.error) : undefined));
    } catch (error) {
      accepting.current = false;
      if (sequence.current === id) {
        if (diagnosticLog) setDiagnostics(diagnosticLog.finish(error));
        const retained = completedChanges;
        const message = timedOut && retained ? t("Generation timed out. Completed files are retained.") : timedOut ? t("Generation exceeded {minutes} minutes. Your project is unchanged.", { minutes: Math.round(timeoutMs / 60000) }) : controller.signal.aborted ? retained ? t("Generation stopped. Completed files and images are retained for review. Your saved project is unchanged.") : t("Generation cancelled. Your project is unchanged.") : t(error.message);
        setError(message); setLiveFile(null);
        if (retained) {
          // Only completed tool operations are recoverable, never streamed fragments.
          const retainedFiles = committedFiles.current;
          const retainedValues = committedValues.current;
          setDraft({ kind: mode, files: retainedFiles, values: retainedValues, valid: false, error: message, steps: completedSteps,
            ...(activeRunScope.current ? { editScope: activeRunScope.current } : {}) });
          onPreview({ files: retainedFiles, values: retainedValues });
          await persistRecovery({ kind: mode, files: retainedFiles, values: retainedValues, valid: false, steps: completedSteps });
          setStatus(t("Generation needs more work. Completed files are retained for review or continuation."));
        } else {
          setStatus(''); setFileChanges({}); onPreview(null);
          await flushRecovery();
          if (recoveryPort && recoveryToken.current) {
            try { await recoveryPort.discard(recoveryToken.current); setRecoverySaved(false); recoveryToken.current = null; }
            catch (error) { setRecoveryError(t(error.message)); }
          }
        }
      }
    }
    finally { clearTimeout(timeout); if (started) await host.ai.finish().catch(() => {}); if (sequence.current === id) { request.current = null; setWorking(false); onBusyChange(false); } }
  }
  async function apply() {
    if (draftTransition.current || !draft || draft.editScope && draft.valid !== true) return;
    draftTransition.current = true; setTransitioning(true);
    try {
    if (draft.editScope) {
      try {
        assertBlockDraftScope(draft.editScope, { files: draft.files, rawValues: draft.values });
        if (!blockScopeBaseMatches(draft.editScope, { files, rawValues })) throw new Error('The project changed since these blocks were selected. Discard this draft and select them again.');
      } catch (cause) { setError(t(cause.message)); return; }
    }
    await flushRecovery();
    if (recoveryPort && recoveryToken.current) {
      try { await recoveryPort.applied(recoveryToken.current); } catch (error) { setRecoveryError(t(error.message)); return; }
    }
    const success = draft.kind === 'content' ? onApply(draft.values, draft.files) : onApplyProject(draft.files, draft.values, { mode: draft.kind });
    if (success === false) return;
    if (recoveryPort && recoveryToken.current) setRecoveryApplying(true);
    setDraft(null); setError(''); setAttachments([]); setReview(null); setPhase(''); setLiveFile(null); setFileChanges({}); onPreview(null); setRecoverySaved(false); recoveryToken.current = null; setStatus(t("Changes applied to your project."));
    activeRunScope.current = null; onClearEditScope?.();
    } catch (cause) { setError(t(cause.message)); }
    finally { draftTransition.current = false; setTransitioning(false); }
  }
  return <section className="ai-panel ai-panel--tab" data-working={working} aria-labelledby="ai-panel-title"><div className="ai-panel-heading"><span className="ai-icon"><Sparkles size={16} /></span><div><div className="section-kicker">OPENROUTER</div><h2 id="ai-panel-title">{t("Your landing assistant")}</h2></div><button className="btn btn-ghost btn-xs btn-square" aria-label={t("AI connection settings")} disabled={disabled || working} onClick={onSettings}><Settings2 size={16} /></button></div>{recoveryLoading && <p className="field-help" role="status">{t("Checking for a saved AI draft…")}</p>}{recoveryError && <div className="ai-message error" role="alert">{recoveryError}{draft && <button type="button" className="btn btn-outline btn-sm" onClick={() => exportRecovery(true)}>{t("Download draft source ZIP")}</button>}</div>}{recoveryConflict && <div className="ai-message error" role="alert"><p>{t(recoveryConflict.workingConflict ? "The project changed while recovery was loading. Download the recovered source ZIP before discarding this draft." : "A saved AI draft belongs to an older project revision. Your saved project has not been changed. Download the recovered source ZIP before discarding this draft.")}</p><div className="ai-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => exportRecovery()}>{t("Download recovered source ZIP")}</button><button type="button" className="btn btn-ghost btn-sm" onClick={discard}>{t("Discard recovered draft")}</button></div></div>}{recoverySaved && draft && <p className="field-help" role="status">{t("Completed draft saved on this device for recovery after reload.")}</p>}{recoveryApplying && <p className="field-help" role="status">{t("Saving applied changes. AI recovery stays available until the project is saved.")}</p>}<AiRunSummary working={working} phase={phase} review={review} draft={draft} error={error} status={status} elapsed={elapsed} received={received} model={diagnostics?.model || settings?.model} imageModel={diagnostics?.imageModel || settings?.imageModel} generateImages={generateImages} onCancel={() => request.current?.abort()} onApply={apply} onContinue={() => generate(draft)} onDiscard={discard} onSettings={onSettings} disabled={disabled || working || transitioning} />{!settings?.configured && <p className="field-help">{t("Connect your key in")} <button className="text-link" onClick={onSettings}>{t("Settings")}</button> {t("to start.")}</p>}{!activeScope && <><div className="ai-mode" role="group" aria-label={t("AI action")}>{[['edit', t("Edit project")], ['content', t("Fill content")]].map(([key, label]) => <button key={key} disabled={disabled || working || Boolean(draft) || (key === 'content' && !definition)} aria-pressed={mode === key} className={mode === key ? 'selected' : ''} onClick={() => { setMode(key); setError(''); setStatus(''); }}>{label}</button>)}</div><div className="ai-create-action"><button type="button" className="btn btn-ghost btn-xs" aria-pressed={mode === 'create'} disabled={disabled || working || Boolean(draft)} onClick={() => { setMode('create'); setError(''); setStatus(''); }}>{t("Create new project")}</button><small>{t("Replaces all files in this project.")}</small></div></>}{activeScope && <div className="ai-block-scope" role="group" aria-label={t("Selected blocks")}><strong>{t("Editing selected blocks")}</strong><ul>{activeScope.selectedInstanceIds.map(id => { const block = activeScope.blockInstances.find(item => item.id === id); return <li key={id}>{block?.label || id}</li>; })}</ul><p className="field-help">{t("Describe a template change or content for the selected instance. Shared fields outside your selection are protected.")}</p>{scopeNotice && <p className="field-help" role="status">{scopeNotice}</p>}{editScopeStale && !draft && <p className="inline-error" role="alert">{t("The selected preview is outdated. Refresh preview and select the blocks again.")}</p>}<button type="button" className="btn btn-ghost btn-xs" disabled={working || Boolean(draft)} onClick={() => { activeRunScope.current = null; onClearEditScope?.(); }}>{t("Remove editing restriction")}</button></div>}<p className="field-help ai-intro">{mode === 'edit' ? t("Describe what to change. The assistant reads your existing files and preserves the rest.") : mode === 'create' ? t("Build a new template. Applying it will replace the current project’s files.") : t("Fill editable fields while preserving the template’s structure.")}</p><label className="field ai-prompt"><span>{mode === 'edit' ? t("What should change?") : mode === 'create' ? t("Describe your landing page") : t("Business, offer, audience and language")}</span><textarea ref={promptRef} className="textarea w-full" rows={5} maxLength={6000} value={prompt} disabled={disabled || working || Boolean(draft)} onChange={event => setPrompt(event.target.value)} placeholder={mode === 'edit' ? t("Add a FAQ below the pricing section. Keep the current colors and typography…") : t("Describe the product, target audience, content and visual direction…")} /></label><PromptImages promptRef={promptRef} referencesOnly={Boolean(activeScope)} attachments={attachments} onChange={setAttachments} onBusyChange={setReadingAttachments} disabled={disabled || working || Boolean(draft)} />{!activeScope && <label className="ai-image-option"><input type="checkbox" checked={generateImages} disabled={disabled || working || Boolean(draft) || !settings?.imageModel} onChange={event => setImageChoice(event.target.checked)} />{t("Generate images requested in the brief")}<small>{settings?.imageModel ? t("Uses your image model and credits. Specify in your prompt whether images are needed and how many.") : t("Choose an image model in AI connection settings to enable this.")}</small></label>}{working && <details className="ai-current-request"><summary>{t("Current request")}</summary><p>{prompt}</p></details>}<div className="ai-actions"><button className="btn btn-primary btn-sm" disabled={disabled || working || Boolean(draft) || readingAttachments || recoveryLoading || Boolean(recoveryConflict) || recoveryApplying || !settings?.configured || !prompt.trim() || Boolean(activeScope && editScopeStale)} onClick={() => generate()}>{working ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{working ? t("Working…") : t("Generate changes")}</button></div><p className="field-help">{t("Plan → Generate → Review → Revise if needed. Review the final draft before applying.")}</p><details className="ai-disclosure-details"><summary>{t("How generation works")}</summary><p className="ai-disclosure">{mode === 'edit' ? t("Your prompt, current values and source files read by the assistant are sent to OpenRouter and the selected provider. Only attached reference images are sent; other binary assets are not sent.") : mode === 'content' ? t("Your prompt, field definitions, current values and image paths are sent to OpenRouter and the selected provider.") : t("Your prompt and generated source files are sent to OpenRouter and the selected provider.")} {mode === 'content' ? t("Requests use your paid account. Files are saved only after you apply the changes.") : t("Requests use your paid account. File changes appear here as the assistant writes. Apply the reviewed changes to keep them.")} {mode !== 'content' && t("A provider timeout may trigger one automatic recovery attempt within the run limit.")}</p></details>{(working && !draft && !error || !working && draft?.editScope && draft.valid === false) && <div className="ai-steering"><label className="field"><span>{t(working ? "Clarify while the assistant works" : "Clarify the retained draft")}</span><textarea className="textarea w-full" rows={2} maxLength={6000} value={clarification} disabled={sent >= 8} onChange={event => setClarification(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); clarify(); } }} placeholder={t("For example: keep the header and use warmer colors…")} /></label><div className="ai-actions"><button type="button" className="btn btn-outline btn-sm" disabled={!clarification.trim() || sent >= 8} onClick={clarify}>{t("Send clarification")}</button><small role="status">{queued ? t("Queued for the next model step: {count}", { count: queued }) : sent >= 8 ? t("Clarification limit reached for this run.") : t("The assistant receives your clarification at the next step.")}</small></div></div>}{liveFile && <details className="ai-live-file ai-run-details"><summary>{t("Live file changes")}</summary><div className="ai-live-heading"><button type="button" className="text-link" onClick={() => onOpenFile?.(liveFile.path)}>{liveFile.path}</button><small>{liveFile.partial ? t("Writing…") : t("Updated")}</small></div><pre aria-label={t("Live file changes")}>{liveFile.content.slice(-6000)}</pre></details>}{Object.keys(fileChanges).length > 0 && <ul className="ai-file-changes" aria-label={t("Changed files")}>{Object.entries(fileChanges).map(([path, kind]) => <li key={path}>{kind === 'deleted' ? <span>{t("Deleted {path}", { path })}</span> : <button type="button" className="text-link" onClick={() => onOpenFile?.(path)}>{path}</button>}</li>)}</ul>}{events.length > 0 && <details className="ai-run-details"><summary>{t("AI activity")}</summary><ol className="ai-activity" aria-label={t("AI activity")}>{events.map((event, index) => <li key={index}>{event}</li>)}</ol></details>}{diagnostics && <details className="ai-diagnostics"><summary>{t("Run diagnostics")}</summary><p className="field-help">{t("Timings, model, request size, token usage and provider errors. API keys and project payloads are excluded.")}</p><button type="button" className="btn btn-outline btn-xs" onClick={downloadDiagnostics}>{t("Download diagnostic log")}</button><pre className="ai-diagnostics-preview">{JSON.stringify(diagnostics, null, 2)}</pre></details>}</section>;
}
