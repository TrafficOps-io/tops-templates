import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConflictError, inputValues } from '@trafficops/template-editor-core';
import { buildPreview } from './preview.js';
import { createPreviewRenderer } from './preview-renderer.js';

export function useEditorProject(host, onSnapshot, recovered, externalBusy = false) {
  const [state, setState] = useState(null), [analysis, setAnalysis] = useState(null), [baseline, setBaseline] = useState({});
  const [locale, setLocale] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [aiBusy, setAiBusy] = useState(false), [aiDraft, setAiDraft] = useState(null);
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
  const install = useCallback(next => {
    autosavePaused.current = false;
    current.current = next; setState(next); setAnalysis(next.analysis || null); setBaseline(next.files); setDirty(false); dirtyRef.current = false;
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
    autosavePaused.current = false;
    editVersion.current++;
    setState(previous => { const next = { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) }; current.current = next; return next; });
    setDirty(true); dirtyRef.current = true; setNotice('');
  }, []);
  const save = useCallback(async ({ propagate = false } = {}) => {
    if (saving.current) {
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
      const next = await operation(signal => host.project.save(submitted, { signal }));
      if (!mounted.current) return next;
      autosavePaused.current = false;
      if (editVersion.current === version) install(next);
      else { setState(value => ({ ...value, revision: next.revision, status: next.status, history: next.history, actions: next.actions })); setBaseline(next.files); }
      return next;
    } catch (cause) {
      // Returning to idle must not repeatedly retry a full disk, denied folder
      // or unavailable server. Keep the error until an edit or explicit retry.
      autosavePaused.current = true;
      report(cause);
      if (propagate) throw cause;
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }, [host, conflict, operation, install, report]);
  // App navigation uses the same save/install path as the editor so a later
  // operation failure leaves the open editor on the newly persisted revision.
  const flush = useCallback(async () => dirtyRef.current ? save({ propagate: true }) : current.current, [save]);
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
  const canPreview = Boolean(state && showPreview && locale && host.capabilities.inlinePreview && state.availability.inlinePreview);
  const interactivePreview = Boolean(host.livePreview);
  const previewPages = analysis?.pages || [];
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
      onSuccess: result => {
        const previous = displayedPreview.current;
        const frame = { ...result, revision: ++previewRevision.current };
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
  latestPreviewRequest.current = state && {
    state: { ...state, files, translations: { ...state.translations, [locale]: values } },
    locale, page: resolvedPreviewPage, partial: Boolean(aiDraft?.partial),
  };
  useEffect(() => {
    if (!canPreview || previewPaused) return;
    previewRenderer.current?.enqueue(latestPreviewRequest.current);
  }, [state?.files, state?.translations, state?.entrypoint, files, values, aiDraft?.partial, locale, resolvedPreviewPage, previewPaused, canPreview, host]);
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
    interactivePreview, previewPaused, previewBusy, refreshPreview, togglePreviewPaused, previewDisplayed };
}
