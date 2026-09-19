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
  const [generatedFiles, setGeneratedFiles] = useState(null);
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
  useEffect(() => {
    if (!canPreview) { setGeneratedFiles(null); setPreviewError(''); return; }
    const renderer = createPreviewRenderer({
      render: (request, signal) => host.analyzer.render(request.state, { signal, locale: request.locale }),
      onSuccess: generated => { setGeneratedFiles(generated); setPreviewError(''); },
      onError: cause => setPreviewError(cause.message || String(cause)),
    });
    previewRenderer.current = renderer;
    return () => { renderer.dispose(); if (previewRenderer.current === renderer) previewRenderer.current = null; };
  }, [host, canPreview, locale]);
  useEffect(() => {
    if (!canPreview) return;
    previewRenderer.current?.enqueue({
      state: { ...state, files, translations: { ...state.translations, [locale]: values } },
      locale, partial: Boolean(aiDraft?.partial),
    });
  }, [state?.files, state?.translations, state?.entrypoint, files, values, aiDraft?.partial, locale, canPreview, host]);
  // Rendering returns the whole project. Page navigation stays local, even while
  // the host is still compiling a newer AI draft or streaming its next response.
  useEffect(() => {
    if (!generatedFiles) { setPreview(null); return; }
    let result;
    try {
      const page = [previewPage, state?.entrypoint, ...Object.keys(generatedFiles)].find(path => path?.endsWith('.html') && Object.hasOwn(generatedFiles, path));
      result = buildPreview(generatedFiles, page);
      setPreview({ html: result.html, page }); setPreviewError('');
    } catch (cause) { setPreview(null); setPreviewError(cause.message); }
    return () => result?.dispose();
  }, [generatedFiles, previewPage, state?.entrypoint]);
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
    error, setError, notice, setNotice, conflict, files, values, aiBusy, setAiBusy, aiDraft, setAiDraft, preview, previewError, previewPage, setPreviewPage, showPreview, setShowPreview };
}
