import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConflictError, inputValues } from '@trafficops/template-editor-core';
import { buildPreview } from './preview.js';
import { createPreviewRenderer } from './preview-renderer.js';
import { mergeChangeSet } from './conversation-changes.js';
import { assertBlockDraftScope, assertBlockScopeBase } from './block-edit-scope.js';

export function useEditorProject(host, onSnapshot, recovered, externalBusy = false) {
  const [state, setState] = useState(null), [analysis, setAnalysis] = useState(null), [baseline, setBaseline] = useState({});
  const [locale, setLocale] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [aiBusy, setAiBusy] = useState(false), [aiDraft, setAiDraft] = useState(null);
  const [conversationDraft, previewConversationDraft] = useState(null), [draftAnalysis, setDraftAnalysis] = useState(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(null), [previewError, setPreviewError] = useState(''), [previewPage, setPreviewPage] = useState('');
  const [previewPaused, setPreviewPaused] = useState(false), [previewBusy, setPreviewBusy] = useState(false);
  const displayedPreview = useRef(null), visiblePreview = useRef(null), previewResources = useRef(new Set()), latestPreviewRequest = useRef(null), previewRevision = useRef(0);
  const releasePreview = useCallback(frame => { if (previewResources.current.delete(frame)) frame.dispose?.(); }, []);
  const releasePreviews = useCallback(() => {
    for (const frame of previewResources.current) releasePreview(frame);
    displayedPreview.current = null; visiblePreview.current = null;
  }, [releasePreview]);
  const [showPreview, setShowPreview] = useState(host.capabilities.inlinePreview);
  const current = useRef(null), dirtyRef = useRef(false), editVersion = useRef(0), saving = useRef(false), mounted = useRef(false);
  const savePromise = useRef(null), applying = useRef(false);
  const autosavePaused = useRef(false);
  const operations = useRef(new Set()), snapshotCallback = useRef(onSnapshot), previewRenderer = useRef(null);
  current.current = state; dirtyRef.current = dirty; snapshotCallback.current = onSnapshot;
  const locked = externalBusy || busy || aiBusy || Boolean(aiDraft);
  const files = aiDraft?.files || state?.files || {};
  const renderFiles = aiDraft?.renderFiles || files;
  const draftValues = aiDraft?.values;
  const values = useMemo(() => inputValues(analysis?.definition, aiDraft?.values || state?.translations?.[locale] || {}), [analysis?.definition, state?.translations, locale, draftValues]);
  const report = useCallback(cause => {
    if (!mounted.current || cause.code === 'abort' || cause.name === 'AbortError') return;
    setError(cause.message || String(cause));
    if (cause.code === 'conflict') setConflict(true);
    if (cause.diagnostics?.length || cause.sourceDiagnostics?.length) setAnalysis(previous => ({ ...previous, diagnostics: cause.diagnostics || [], sourceDiagnostics: cause.sourceDiagnostics || [] }));
  }, []);
  const install = useCallback((next, { preserveAnalysis = false } = {}) => {
    autosavePaused.current = false;
    current.current = next; setState(next); setAnalysis(previous => next.analysis || (preserveAnalysis ? previous : null)); setBaseline(next.files); setDirty(false); dirtyRef.current = false;
    setLocale(previous => Object.hasOwn(next.translations, previous) ? previous : next.locale);
    setConflict(false); setError(''); editVersion.current++;
  }, []);
  const operation = useCallback(async callback => {
    const controller = new AbortController(); operations.current.add(controller);
    try { return await callback(controller.signal); } finally { operations.current.delete(controller); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    operation(signal => host.project.open({ signal })).then(next => { if (mounted.current) { install(next); if (recovered?.dirty) { setDirty(true); dirtyRef.current = true; setBaseline(recovered.sourceBaseline || next.files); } } }).catch(report);
    return () => { mounted.current = false; for (const controller of operations.current) controller.abort(); };
  }, [host, install, operation, report]);
  const change = useCallback(patch => {
    if (applying.current) return;
    autosavePaused.current = false;
    editVersion.current++;
    setState(previous => { const next = { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) }; current.current = next; return next; });
    setDirty(true); dirtyRef.current = true; setNotice('');
  }, []);
  const save = useCallback(async ({ propagate = false } = {}) => {
    if (saving.current) {
      if (propagate && savePromise.current) return savePromise.current;
      if (propagate) throw new Error('Wait for the current save to finish.');
      return;
    }
    if (conflict) {
      if (propagate) throw new ConflictError();
      return;
    }
    if (!current.current) return;
    saving.current = true; setBusy(true); setError('');
    const submitted = current.current, version = editVersion.current;
    try {
      const pending = operation(signal => host.project.save(submitted, { signal }));
      savePromise.current = pending;
      const next = await pending;
      if (!mounted.current) return next;
      autosavePaused.current = false;
      // Local save snapshots may omit analysis. Keep the working form mounted
      // while fresh diagnostics run, preserving rich-text selection and history.
      if (editVersion.current === version) install(next, { preserveAnalysis: true });
      else {
        const buffered = { ...current.current, revision: next.revision, contentRevision: next.contentRevision, appliedAiRuns: next.appliedAiRuns, status: next.status, history: next.history, actions: next.actions };
        current.current = buffered; setState(buffered); setBaseline(next.files);
      }
      return next;
    } catch (cause) {
      // Returning to idle must not repeatedly retry a full disk, denied folder
      // or unavailable server. Keep the error until an edit or explicit retry.
      autosavePaused.current = true;
      report(cause);
      if (propagate) throw cause;
    } finally { savePromise.current = null; saving.current = false; if (mounted.current) setBusy(false); }
  }, [host, conflict, operation, install, report]);
  // App navigation uses the same save/install path as the editor so a later
  // operation failure leaves the open editor on the newly persisted revision.
  const flush = useCallback(async () => {
    if (savePromise.current) await savePromise.current;
    while (dirtyRef.current) await save({ propagate: true });
    return current.current;
  }, [save]);
  const applyConversationDraft = useCallback(async (run, { allowStaleContext = false } = {}) => {
    if (applying.current) throw new Error('Changes are already being applied.');
    if (!run?.result?.files || !run.base || !run.result.valid || run.result.discussion || run.recoveredConflict || !['ready', 'interrupted'].includes(run.state)) throw new Error('This conversation has no validated draft ready to apply.');
    // Autosaving hosts persist pending edits first; explicit-save hosts (PW Apps) must not save the user's unsaved edits implicitly.
    const persists = Boolean(host.capabilities.autosave);
    if (persists) await flush(); else if (savePromise.current) await savePromise.current;
    const previous = current.current;
    if (!previous) throw new Error('Open the project before applying changes.');
    if (previous.appliedAiRuns?.includes(run.id)) return previous;
    const version = editVersion.current, targetLocale = run.locale || run.base.locale || previous.locale;
    const blockScope = run.scope?.kind === 'block' ? run.result.editScope || run.scope.editScope : null;
    if (blockScope) {
      if (run.result.valid !== true) throw new Error('Complete validation and review before applying selected-block changes.');
      assertBlockDraftScope(blockScope, { files: run.result.files, rawValues: run.result.values });
      assertBlockScopeBase(blockScope, { files: previous.files, rawValues: previous.translations[targetLocale] || {} });
    }
    const merged = mergeChangeSet({ base: run.base, proposal: run.result, current: previous, locale: targetLocale, allowStaleContext, readSet: run.readSet });
    if (merged.conflicts.length || merged.requiresContextReview) {
      const cause = new ConflictError(merged.conflicts.length ? 'The project changed since this draft started. Review the conflicting files or continue the conversation with the latest project.' : 'The project context changed. Review the updated candidate before applying.');
      Object.assign(cause, { conflicts: merged.conflicts, staleReadSet: merged.staleReadSet, requiresContextReview: merged.requiresContextReview, candidate: merged.state });
      throw cause;
    }
    const candidate = { ...merged.state, appliedAiRuns: [...(previous.appliedAiRuns || []), run.id].slice(-200) };
    if (blockScope) assertBlockDraftScope(blockScope, { files: candidate.files, rawValues: candidate.translations[targetLocale] || {} });
    const validated = await operation(async signal => {
      const checked = await host.analyzer.analyze(candidate, { signal });
      const issues = [...(checked.sourceDiagnostics || []), ...(checked.diagnostics || [])];
      if (issues.length) throw new Error(issues.map(issue => issue.message).join(' '));
      await host.analyzer.render(candidate, { signal, locale: targetLocale });
      return { ...candidate, analysis: checked };
    });
    if (!mounted.current || editVersion.current !== version || current.current.revision !== previous.revision || saving.current) throw new ConflictError('The editor changed during validation. Review the latest project and apply again.');
    if (blockScope) {
      assertBlockScopeBase(blockScope, { files: current.current.files, rawValues: current.current.translations[targetLocale] || {} });
      assertBlockDraftScope(blockScope, { files: validated.files, rawValues: validated.translations[targetLocale] || {} });
    }
    if (!persists) {
      // Explicit-save hosts: applied AI changes update only the working copy; Save draft persists them like any other edit.
      editVersion.current++; current.current = validated; setState(validated); setAnalysis(validated.analysis); setDirty(true); dirtyRef.current = true;
      previewConversationDraft(null); setNotice('Conversation changes applied.');
      return validated;
    }
    applying.current = true; saving.current = true; setBusy(true);
    try {
      const pending = operation(signal => host.project.save(validated, { signal }));
      savePromise.current = pending;
      const saved = await pending;
      if (mounted.current) { install(saved); previewConversationDraft(null); setNotice('Conversation changes applied.'); }
      return saved;
    } finally {
      savePromise.current = null; applying.current = false; saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [flush, host, operation, install]);
  useEffect(() => {
    if (!host.capabilities.autosave || !state || !dirty || locked || conflict || autosavePaused.current) return;
    const timer = setTimeout(save, 650); return () => clearTimeout(timer);
  }, [host, state, dirty, locked, conflict, save]);
  useEffect(() => {
    if (state) snapshotCallback.current?.({ state, dirty, busy, aiBusy, aiDraft, baseline, flush, conflict });
  }, [state, dirty, busy, aiBusy, aiDraft, baseline, flush, conflict]);
  useEffect(() => {
    if (!state) return;
    const controller = new AbortController();
    const snapshot = { ...state, files: renderFiles, translations: aiDraft ? { ...state.translations, [locale]: aiDraft.values } : state.translations };
    const timer = setTimeout(() => host.analyzer.analyze(snapshot, { signal: controller.signal }).then(next => {
      if (!controller.signal.aborted) { setAnalysis(next); if (!current.current.entrypoint && next.entrypoint) setState(previous => ({ ...previous, entrypoint: next.entrypoint })); }
    }).catch(report), 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [state?.files, state?.translations, state?.entrypoint, renderFiles, draftValues, host, locale, report]);
  useEffect(() => {
    setDraftAnalysis(null);
    if (!conversationDraft || !state) return;
    const controller = new AbortController();
    const targetLocale = conversationDraft.locale || locale;
    host.analyzer.analyze({ ...state, files: conversationDraft.files, translations: { ...state.translations, [targetLocale]: conversationDraft.values || {} } }, { signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) setDraftAnalysis(next); }).catch(cause => { if (!controller.signal.aborted) setPreviewError(cause.message); });
    return () => controller.abort();
  }, [conversationDraft, host, locale, Boolean(state)]);
  const canPreview = Boolean(state && showPreview && locale && host.capabilities.inlinePreview && state.availability.inlinePreview);
  const interactivePreview = Boolean(host.livePreview);
  const previewAnalysis = conversationDraft ? draftAnalysis || analysis : analysis;
  const previewPages = previewAnalysis?.pages || [];
  const resolvedPreviewPage = previewPages.includes(previewPage) ? previewPage : state?.entrypoint || previewPages[0] || '';
  useEffect(() => {
    if (!canPreview) { releasePreviews(); setPreview(null); setPreviewError(''); setPreviewBusy(false); return; }
    const renderer = createPreviewRenderer({
      latestOnly: true,
      render: async (request, signal) => {
        if (host.livePreview) return host.livePreview.render(request.state, { signal, locale: request.locale, page: request.page, keepRevisionId: visiblePreview.current?.id });
        const generated = await host.analyzer.render(request.state, { signal, locale: request.locale });
        const page = [request.page, request.state.entrypoint, ...Object.keys(generated)].find(path => path?.endsWith('.html') && Object.hasOwn(generated, path));
        return { ...buildPreview(generated, page), page };
      },
      onSuccess: (result, request) => {
        const previous = displayedPreview.current;
        const frame = { ...result, revision: ++previewRevision.current,
          sourceSnapshot: { files: request.state.files, values: request.state.translations[request.locale], locale: request.locale } };
        previewResources.current.add(frame);
        displayedPreview.current = frame; setPreview(frame); setPreviewError('');
        if (previous !== visiblePreview.current) releasePreview(previous);
      },
      onError: cause => setPreviewError(cause.message || String(cause)),
      onBusy: setPreviewBusy,
    });
    previewRenderer.current = renderer;
    return () => { renderer.dispose(); if (previewRenderer.current === renderer) previewRenderer.current = null; };
  }, [host, canPreview, locale, releasePreview, releasePreviews]);
  const previewLocale = conversationDraft?.locale || locale;
  latestPreviewRequest.current = state && {
    state: { ...state, files: conversationDraft?.files || files, translations: { ...state.translations, [previewLocale]: conversationDraft?.values || values } },
    locale: previewLocale, page: resolvedPreviewPage, partial: Boolean(aiDraft?.partial),
  };
  useEffect(() => {
    if (!canPreview || previewPaused) return;
    previewRenderer.current?.enqueue(latestPreviewRequest.current);
  }, [state?.files, state?.translations, state?.entrypoint, files, values, aiDraft?.partial, locale, resolvedPreviewPage, previewPaused, canPreview, host, conversationDraft, draftAnalysis]);
  const refreshPreview = useCallback(() => {
    if (latestPreviewRequest.current) previewRenderer.current?.enqueue(latestPreviewRequest.current);
  }, []);
  const togglePreviewPaused = useCallback(() => {
    previewRenderer.current?.clear();
    if (!previewPaused && displayedPreview.current !== visiblePreview.current) {
      const pending = displayedPreview.current;
      displayedPreview.current = visiblePreview.current; setPreview(visiblePreview.current);
      releasePreview(pending);
    }
    setPreviewPaused(!previewPaused);
  }, [previewPaused, releasePreview]);
  const previewDisplayed = useCallback(frame => {
    if (!previewResources.current.has(frame)) return;
    const previous = visiblePreview.current; visiblePreview.current = frame;
    if (previous !== frame) releasePreview(previous);
  }, [releasePreview]);
  useEffect(() => () => { releasePreviews(); host.livePreview?.dispose?.(); }, [host, releasePreviews]);
  useEffect(() => {
    const keydown = event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault(); if (!locked) save();
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [save, locked]);
  useEffect(() => {
    if (!dirty && !aiBusy && !aiDraft) return;
    const handler = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, aiBusy, aiDraft]);
  async function reload() {
    setBusy(true);
    try { const next = await operation(signal => host.project.open({ signal })); if (mounted.current) install(next); } catch (cause) { report(cause); } finally { if (mounted.current) setBusy(false); }
  }
  return { state, current, setState, install, analysis, baseline, locale, setLocale, busy, setBusy, dirty, locked, change, save, flush, reload, operation, report,
    error, setError, notice, setNotice, conflict, files, values, aiBusy, setAiBusy, aiDraft, setAiDraft, preview, previewError, previewPage, setPreviewPage, showPreview, setShowPreview,
    interactivePreview, previewPaused, previewBusy, refreshPreview, togglePreviewPaused, previewDisplayed,
    conversationDraft, previewConversationDraft, applyConversationDraft, previewAnalysis, previewPages };
}
