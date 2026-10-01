import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, Check, ChevronDown, FileCode2, History, Layers, LoaderCircle, MessageSquare, Pencil, Plus, Search, Settings2, Sparkles, Square, Trash2, X } from 'lucide-react';
import { conversationChangedFiles, conversationReferenceLabel } from './conversation-diff.js';
import { addFileMention, mentionKey, mentionLabel } from './conversation-mentions.js';
import ConversationComposer from './ConversationComposer.jsx';
import AssetPreview from './AssetPreview.jsx';
import ProjectFileThumbnail from './ProjectFileThumbnail.jsx';
import './conversation-panel.css';
import { getConversationSession } from './conversation-runtime.js';
import { resolveImageGeneration } from './ai-image-choice.js';
import { useStudioText } from './studio-i18n.js';
import { blockScopeSourceTargets } from './block-edit-scope.js';
import { blockScopeBaseMatches, previewSectionOptions, previewSelectionMatches } from './preview-selection.js';

const activeStates = new Set(['queued', 'running']);
const statusLabels = { queued: 'Queued', running: 'Working…', ready: 'Changes ready', completed: 'Completed', failed: 'Needs attention', interrupted: 'Interrupted', cancelled: 'Stopped', applied: 'Applied', discarded: 'Discarded' };
const draftStates = new Set(['ready', 'failed', 'interrupted', 'cancelled']);

function messageText(message) {
  return message.prompt || message.text || (message.parts || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
}
function TextChanges({ original, draft }) {
  const t = useStudioText(), [expanded, setExpanded] = useState(false);
  const before = String(original ?? '').split('\n'), after = String(draft ?? '').split('\n');
  let start = 0, end = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (end < Math.min(before.length, after.length) - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const removed = before.slice(start, before.length - end), added = after.slice(start, after.length - end), truncated = removed.length > 80 || added.length > 80;
  return <div><pre className="conversation-diff" tabIndex={0}><span>{before.slice(Math.max(0, start - 2), start).join('\n')}</span>{removed.slice(0, expanded ? undefined : 80).map((line, index) => <span className="diff-removed" key={`b${index}`}>− {line}\n</span>)}{added.slice(0, expanded ? undefined : 80).map((line, index) => <span className="diff-added" key={`a${index}`}>+ {line}\n</span>)}<span>{after.slice(after.length - end, after.length - end + 2).join('\n')}</span></pre>{truncated && <button type="button" className="text-link" onClick={() => setExpanded(value => !value)}>{t(expanded ? 'Show fewer changes' : 'Show full changes')}</button>}</div>;
}

export default function ConversationPanel({ host, state, locale, sectionFrame, launchRequest, onApplyRun, onPreviewDraft, onOpenFile, onSettings, onBlockSelectionBusyChange, onClearBlockScope, selectionStale = false, disabled = false }) {
  const t = useStudioText(), session = useMemo(() => getConversationSession(host), [host]);
  const [document, setDocument] = useState(() => session.getSnapshot()), [selected, setSelected] = useState('');
  const [prompt, setPrompt] = useState(''), [attachments, setAttachments] = useState([]), [mentions, setMentions] = useState([]);
  const [scope, setScope] = useState({ kind: 'project' }), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [settings, setSettings] = useState(null), [imageChoice, setImageChoice] = useState(undefined);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [applying, setApplying] = useState(false);
  const [rename, setRename] = useState(null), [conflict, setConflict] = useState(null), [reviewedContext, setReviewedContext] = useState(false), [previewRun, setPreviewRun] = useState(''), [mergedPreview, setMergedPreview] = useState(false);
  const [deleteThread, setDeleteThread] = useState(null), [historyOpen, setHistoryOpen] = useState(false);
  const historyId = useId(), navigationArea = useRef(null), scrollArea = useRef(null), reviewArea = useRef(null), followMessages = useRef(true);
  const mounted = useRef(true), initialized = useRef(false);
  const threads = document?.threads || [], runs = document?.runs || [];
  const thread = threads.find(item => item.id === selected), threadRuns = runs.filter(item => item.threadId === selected);
  const latestRun = threadRuns.at(-1), currentRun = threadRuns.find(item => item.id === previewRun) || latestRun;
  const draft = currentRun?.result || currentRun?.checkpoint;
  const visibleDraft = currentRun && draftStates.has(currentRun.state) && draft?.files;
  const canApply = currentRun && ['ready', 'interrupted'].includes(currentRun.state) && draft?.valid === true && !draft.discussion && !currentRun.recoveredConflict;
  const changed = visibleDraft ? conversationChangedFiles(currentRun.base?.files, draft.files) : {};
  const files = state?.files || {};
  const availableSections = sectionFrame?.sourceSnapshot?.locale === locale && previewSelectionMatches(sectionFrame, { files, values: sectionFrame.sourceSnapshot.values, locale }) ? previewSectionOptions(sectionFrame) : [];
  const blockSelectionBusy = runs.some(run => run.scope?.kind === 'block' && activeStates.has(run.state)) || Boolean(previewRun && currentRun?.scope?.kind === 'block');
  const blockScope = currentRun?.scope?.kind === 'block' && !['applied', 'discarded'].includes(currentRun.state) ? currentRun.scope.editScope : scope.kind === 'block' ? scope.editScope : null;
  const blockScopeStale = Boolean(blockScope && (selectionStale && !draft || blockScope.locale !== locale
    || !blockScopeBaseMatches(blockScope, { files, rawValues: state.translations[locale] || {} })));
  useEffect(() => { onBlockSelectionBusyChange?.(blockSelectionBusy); return () => onBlockSelectionBusyChange?.(false); }, [blockSelectionBusy, onBlockSelectionBusyChange]);
  useEffect(() => {
    mounted.current = true; let alive = true;
    const unsubscribe = session.subscribe(value => { if (alive) setDocument(value || session.getSnapshot()); });
    session.ready.then(() => {
      if (!alive) return;
      const value = session.getSnapshot(); setDocument(value); setLoading(false);
      if (!initialized.current) { initialized.current = true; setSelected(value.threads?.filter(item => !item.archived).at(-1)?.id || ''); }
    }).catch(cause => { if (alive) { setLoading(false); setError(cause.message); } });
    return () => { alive = false; mounted.current = false; unsubscribe?.(); onPreviewDraft?.(null); };
  }, [session]);
  useEffect(() => {
    let alive = true;
    session.ready.then(() => session.reconcileApplied(state.appliedAiRuns || [])).catch(cause => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [session, state.appliedAiRuns]);
  useEffect(() => {
    let alive = true;
    const load = () => host.ai?.settings.load().then(value => { if (alive) setSettings(value); }).catch(cause => { if (alive) setError(cause.message); });
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; window.removeEventListener('trafficops-ai-settings', load); };
  }, [host.ai]);
  useEffect(() => {
    if (!launchRequest) return;
    setSelected(''); setPrompt(''); setAttachments([]); setMentions(launchRequest.mentions || []); setScope(launchRequest.scope);
    setError(''); setConflict(null); setPreviewRun(''); setDeleteThread(null); setHistoryOpen(false); onPreviewDraft?.(null);
  }, [launchRequest]);
  useEffect(() => {
    const candidate = mergedPreview && conflict?.candidate;
    if (candidate) onPreviewDraft?.({ files: candidate.files, values: candidate.translations[currentRun.locale] || {}, locale: currentRun.locale, runId: currentRun.id });
    else if (previewRun && visibleDraft) onPreviewDraft?.({ ...draft, locale: currentRun.locale, runId: currentRun.id });
    else onPreviewDraft?.(null);
  }, [previewRun, currentRun?.updatedAt, visibleDraft, mergedPreview, conflict]);
  useEffect(() => {
    if (selected) setScope(runs.filter(run => run.threadId === selected).at(-1)?.scope || { kind: 'project' });
  }, [selected]);
  useEffect(() => {
    if (conflict && !applying) { setConflict(null); setReviewedContext(false); setMergedPreview(false); setError(t('The project changed again. Review the changes before applying.')); }
  }, [state.files, state.translations]);
  useEffect(() => { followMessages.current = true; }, [selected]);
  useEffect(() => {
    const area = scrollArea.current;
    if (area && followMessages.current && !previewRun) area.scrollTop = area.scrollHeight;
  }, [selected, thread?.messages?.length, latestRun?.updatedAt, previewRun]);
  useEffect(() => {
    if (previewRun && reviewArea.current && scrollArea.current) scrollArea.current.scrollTop = reviewArea.current.offsetTop;
  }, [previewRun]);
  useEffect(() => {
    if ((rename || deleteThread) && scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [rename?.id, deleteThread?.id]);
  useEffect(() => {
    if (!historyOpen) return;
    navigationArea.current?.querySelector('input')?.focus({ preventScroll: true });
    const closeOutside = event => { if (!navigationArea.current?.contains(event.target)) setHistoryOpen(false); };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [historyOpen]);
  function newThread() {
    setHistoryOpen(false);
    setSelected(''); setPrompt(''); setMentions([]); setAttachments([]); setScope({ kind: 'project' }); setPreviewRun(''); setConflict(null); setDeleteThread(null); setError('');
  }
  function openThread(item) {
    setHistoryOpen(false);
    setSelected(item.id); setPrompt(''); setMentions([]); setAttachments([]); setScope({ kind: 'project' }); setPreviewRun(''); setConflict(null); setDeleteThread(null); setError('');
  }
  function openCurrentFile(path, selection) { setPreviewRun(''); onOpenFile?.(path, selection); }
  function openReference(item) {
    const path = typeof item === 'string' ? item : item.path, source = files[path];
    if (item.kind === 'section' && typeof source === 'string' && source.slice(item.start, item.end) === item.content) {
      const before = source.slice(0, item.start).split('\n');
      openCurrentFile(path, { lineNumber: before.length, column: before.at(-1).length + 1 });
    } else openCurrentFile(path);
  }
  function removeScope() {
    if (['file', 'block'].includes(scope.kind)) {
      setSelected(''); setPreviewRun(''); setConflict(null); setError('');
      if (scope.kind === 'file') setMentions(value => addFileMention(value, scope.path));
      else onClearBlockScope?.();
    }
    setScope({ kind: 'project' });
  }
  async function action(callback) {
    setError('');
    try { return await callback(); } catch (cause) { if (mounted.current) setError(cause.message || String(cause)); }
  }
  async function send() {
    const brief = prompt.trim(); if (!brief || disabled || applying || blockScopeStale) return;
    await action(async () => {
      const id = await session.submit({ threadId: selected || undefined, prompt: brief, attachments, mentions, scope, snapshot: state, locale, sectionFrame,
        generateImages: resolveImageGeneration(imageChoice, settings) });
      if (mounted.current) { setSelected(id); setPrompt(''); setAttachments([]); setMentions([]); setArchived(false); setPreviewRun(''); }
    });
  }
  async function apply(run, allowStaleContext = false) {
    if (disabled || applying || !canApply) return;
    setApplying(true); setError('');
    try {
      const saved = await onApplyRun(run, { allowStaleContext });
      await session.markApplied(run.id, saved.revision);
      if (mounted.current) { setPreviewRun(''); setConflict(null); setReviewedContext(false); }
    } catch (cause) {
      if (mounted.current) {
        setError(cause.message || String(cause));
        if (cause.code === 'conflict') { setConflict(cause); setReviewedContext(false); setMergedPreview(false); }
      }
    } finally { if (mounted.current) setApplying(false); }
  }
  function renderRun(run) {
    return <div className="conversation-run" key={run.id}><div className="conversation-run-heading"><strong className={`conversation-status ${run.state}`}>{activeStates.has(run.state) && <LoaderCircle size={14} className="spin" />}{t(statusLabels[run.state] || run.state)}</strong>{run.phase && activeStates.has(run.state) && <small>{t(run.phase.charAt(0).toUpperCase() + run.phase.slice(1))}</small>}</div>{run.error && !(thread?.messages || []).some(message => message.role === 'assistant' && message.runId === run.id && messageText(message) === run.error) && <p className="field-help">{run.error}</p>}{run.result?.summary && !(thread?.messages || []).some(message => message.role === 'assistant' && message.runId === run.id && messageText(message) === run.result.summary) && <p>{run.result.summary}</p>}<div className="conversation-run-actions">{activeStates.has(run.state) && <button type="button" className="btn btn-outline btn-xs" onClick={() => action(() => session.stop(run.id))}><Square size={12} />{t('Stop')}</button>}{draftStates.has(run.state) && (run.result?.files || run.checkpoint?.files) && <button type="button" className="btn btn-outline btn-xs" disabled={disabled} onClick={() => { setPreviewRun(run.id); setConflict(null); }}>{t('Review changes')}</button>}{['failed', 'interrupted', 'cancelled'].includes(run.state) && <button type="button" className="btn btn-outline btn-xs" disabled={disabled} onClick={() => action(() => session.continue(run.id, { prompt: prompt.trim() || undefined, snapshot: state, locale }))}>{t('Continue')}</button>}</div></div>;
  }
  const filtered = threads.filter(item => Boolean(item.archived) === archived && `${item.title} ${(item.messages || []).map(messageText).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  return <section className="conversation-panel" aria-label={t('Project conversations')}>
    <header className="conversation-heading"><h2><MessageSquare size={16} aria-hidden="true" />{t('Project conversations')}</h2><div className="conversation-heading-actions"><button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t('AI settings')} title={t('AI settings')} onClick={onSettings}><Settings2 size={16} /></button></div></header>
    <div className="conversation-navigation-area" ref={navigationArea} onKeyDown={event => { if (event.key === 'Escape' && historyOpen) { event.preventDefault(); event.stopPropagation(); setHistoryOpen(false); navigationArea.current?.querySelector('[aria-expanded]')?.focus(); } }}>
    <div className="conversation-navigation"><button type="button" className="btn btn-ghost btn-sm conversation-history-toggle" aria-expanded={historyOpen} aria-controls={historyId} onClick={() => setHistoryOpen(value => !value)}><History size={15} />{t('Conversation history')}<span className="conversation-history-count" aria-hidden="true">{threads.length}</span><ChevronDown size={13} className={historyOpen ? 'is-open' : ''} /></button><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label={t('New conversation')} title={t('New conversation')} onClick={newThread}><Plus size={18} /></button></div>
    <div className="conversation-history-region" id={historyId} hidden={!historyOpen}>
      <div className="conversation-history-tools"><label className="conversation-search"><Search size={14} /><input className="input input-sm" aria-label={t('Search conversations')} placeholder={t('Search conversations')} value={search} onChange={event => setSearch(event.target.value)} /></label><button type="button" className="btn btn-ghost btn-xs" aria-pressed={archived} onClick={() => setArchived(value => !value)}><Archive size={14} />{t('Archived')}</button></div>
      {loading ? <p role="status">{t('Loading conversations…')}</p> : <nav className="conversation-history" aria-label={t('Conversation history')}>{filtered.length ? filtered.map(item => {
        const run = runs.filter(value => value.threadId === item.id).at(-1);
        return <button type="button" className={item.id === selected ? 'selected' : ''} key={item.id} onClick={() => openThread(item)} aria-current={item.id === selected ? 'page' : undefined}><span title={item.title}>{item.title}</span><small className={`conversation-status ${run?.state || ''}`}>{run ? t(statusLabels[run.state] || run.state) : t('Conversation')}</small></button>;
      }) : <p className="field-help">{t(archived ? 'No archived conversations.' : search ? 'No matching conversations.' : 'Your conversations will appear here.')}</p>}</nav>}
    </div>
    </div>
    <div className="conversation-thread-heading"><h3 title={thread?.title}>{thread?.title || t('New conversation')}</h3>{thread && <div className="conversation-thread-actions"><button type="button" className="btn btn-ghost btn-xs" aria-label={t('Rename conversation')} onClick={() => setRename({ id: thread.id, title: thread.title })}><Pencil size={13} /></button><button type="button" className="btn btn-ghost btn-xs" onClick={() => action(() => session.archive(thread.id, !thread.archived))}><Archive size={13} />{t(thread.archived ? 'Restore' : 'Archive')}</button>{thread.archived && <button type="button" className="btn btn-ghost btn-xs" disabled={disabled || threadRuns.some(run => activeStates.has(run.state))} onClick={() => setDeleteThread({ id: thread.id, title: thread.title })}><Trash2 size={13} />{t('Delete conversation')}</button>}</div>}</div>
    <div className="conversation-thread-scroll" ref={scrollArea} onScroll={event => { const area = event.currentTarget; followMessages.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80; }}>
    {deleteThread && <section className="conversation-delete" role="group" aria-label={t('Delete conversation?')}><h3>{t('Delete conversation?')}</h3><p>{deleteThread.title}</p><p className="field-help">{t('Saved messages and draft changes will be deleted. Changes already applied to your project stay in its files.')}</p><div className="conversation-run-actions"><button type="button" className="btn btn-error btn-sm" disabled={disabled || runs.some(run => run.threadId === deleteThread.id && activeStates.has(run.state))} onClick={() => action(async () => { await session.deleteThread(deleteThread.id); setDeleteThread(null); if (selected === deleteThread.id) newThread(); })}>{t('Delete permanently')}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteThread(null)}>{t('Cancel')}</button></div></section>}
    {rename && <form className="conversation-rename" onSubmit={event => { event.preventDefault(); action(async () => { await session.rename(rename.id, rename.title.trim()); setRename(null); }); }}><input autoFocus className="input input-sm" aria-label={t('Conversation title')} maxLength={120} required value={rename.title} onChange={event => setRename({ ...rename, title: event.target.value })} /><button type="submit" className="btn btn-primary btn-xs"><Check size={13} />{t('Save')}</button><button type="button" className="btn btn-ghost btn-xs" aria-label={t('Cancel')} onClick={() => setRename(null)}><X size={13} /></button></form>}
    <div className="conversation-messages" aria-live="polite">{!thread && <div className="conversation-empty"><span className="conversation-empty-icon"><Sparkles size={22} aria-hidden="true" /></span><h3>{t('What shall we work on?')}</h3><p>{t('Describe a task, attach a reference, or mention a file or section with @.')}</p></div>}{(thread?.messages || []).map((message, index, messages) => <Fragment key={message.id}><article className={`conversation-message ${message.role}`}><small>{t(message.role === 'user' ? 'You' : 'Assistant')}</small><p>{messageText(message)}</p>{message.attachments?.length > 0 && <ul className="conversation-message-references">{message.attachments.map(item => <li key={item.id}>{item.mime?.startsWith('image/') && item.dataUrl && <img src={item.dataUrl} alt="" />}<span>{item.name}</span></li>)}</ul>}{message.mentions?.length > 0 && <div className="conversation-mentions">{message.mentions.map(item => <button className="conversation-mention" type="button" key={mentionKey(item)} title={item.kind === 'section' ? `${mentionLabel(item)} · ${item.page}` : mentionLabel(item)} onClick={() => openReference(item)}>{item.kind === 'section' ? <Layers className="conversation-section-icon" size={16} /> : <ProjectFileThumbnail path={item.path || item} value={files[item.path || item]} />}<span className="conversation-mention-label">@{mentionLabel(item)}</span></button>)}</div>}</article>{threadRuns.filter(run => (run.id === message.runId || run.messageId === message.id) && !messages.slice(index + 1).some(next => next.runId === run.id || next.id === run.messageId)).map(renderRun)}</Fragment>) }{threadRuns.filter(run => !(thread?.messages || []).some(message => message.runId === run.id || message.id === run.messageId)).map(renderRun)}</div>

    {previewRun && visibleDraft && <section className="conversation-review" ref={reviewArea} aria-label={t('Review conversation changes')}><div className="conversation-thread-heading"><h3>{t('Review changes')}</h3><button type="button" className="btn btn-ghost btn-xs" onClick={() => setPreviewRun('')}>{t('Show current project')}</button></div><p className="field-help">{t('The preview shows this conversation’s draft. Your project files are unchanged.')}</p>{Object.keys(changed).map(path => <details key={path} className="conversation-file-diff"><summary><FileCode2 size={14} />{path}<small>{t(changed[path] === 'deleted' ? 'Deleted' : changed[path] === 'added' ? 'Added' : 'Changed')}</small></summary><button type="button" className="text-link" onClick={() => openCurrentFile(path)}>{t('Open current file')}</button>{typeof draft.files[path] === 'string' || typeof currentRun.base?.files?.[path] === 'string' ? <TextChanges original={currentRun.base?.files?.[path]} draft={draft.files[path]} /> : <div className="conversation-image-comparison">{[['Before', currentRun.base?.files?.[path]], ['After', draft.files[path]]].map(([label, value]) => <div key={label}><h4>{t(label)}</h4>{value ? <AssetPreview path={path} value={value} /> : <p>{t('No file')}</p>}</div>)}</div>}</details>)}
      {visibleDraft && JSON.stringify(currentRun.base?.translations?.[currentRun.locale] || {}) !== JSON.stringify(draft.values || {}) && <details className="conversation-file-diff"><summary>{t('Content changes')}</summary><TextChanges original={JSON.stringify(currentRun.base?.translations?.[currentRun.locale] || {}, null, 2)} draft={JSON.stringify(draft.values || {}, null, 2)} /></details>}
      {conflict?.candidate && <section className="conversation-merged-review"><h3>{t('Changes to the current project')}</h3><p className="field-help">{t('Review what will change in your latest project before confirming.')}</p>{Object.keys(conversationChangedFiles(files, conflict.candidate.files)).map(path => <details className="conversation-file-diff" key={path}><summary>{path}</summary>{typeof conflict.candidate.files[path] === 'string' || typeof files[path] === 'string' ? <TextChanges original={files[path]} draft={conflict.candidate.files[path]} /> : <div className="conversation-image-comparison">{[['Before', files[path]], ['After', conflict.candidate.files[path]]].map(([label, value]) => <div key={label}><h4>{t(label)}</h4>{value ? <AssetPreview path={path} value={value} /> : <p>{t('No file')}</p>}</div>)}</div>}</details>)}<details className="conversation-file-diff"><summary>{t('Content changes')}</summary><TextChanges original={JSON.stringify(state.translations[currentRun.locale] || {}, null, 2)} draft={JSON.stringify(conflict.candidate.translations[currentRun.locale] || {}, null, 2)} /></details><button type="button" className="btn btn-outline btn-xs" disabled={disabled} onClick={() => setMergedPreview(value => !value)}>{t(mergedPreview ? 'Show original conversation draft' : 'Preview updated project')}</button></section>}
      {conflict && <div className="conversation-conflict" role="alert"><p>{t('The project changed while the assistant worked. Review the current files before applying.')}</p>{(conflict.conflicts || []).length > 0 && <p>{t('Some changes overlap. Continue the conversation with the current project to resolve them.')}</p>}{[...(conflict.conflicts || []), ...(conflict.staleReadSet || [])].map((item, index) => { const path = typeof item === 'string' ? item : item.kind === 'values' ? '' : item.path; return <details key={index}><summary>{t(conversationReferenceLabel(item))}</summary>{path && typeof files[path] === 'string' && <pre>{files[path].slice(0, 12000)}</pre>}</details>; })}{conflict.requiresContextReview && !(conflict.conflicts || []).length && <label><input type="checkbox" checked={reviewedContext} onChange={event => setReviewedContext(event.target.checked)} />{t('I reviewed the current files')}</label>}</div>}
      <div className="conversation-run-actions"><button type="button" className="btn btn-primary btn-sm" disabled={disabled || applying || !canApply || Boolean(conflict)} onClick={() => apply(currentRun)}>{applying ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{t('Apply to project')}</button>{conflict?.requiresContextReview && !(conflict.conflicts || []).length && <button type="button" className="btn btn-primary btn-sm" disabled={disabled || applying || !canApply || !reviewedContext} onClick={() => apply(currentRun, true)}>{t('Apply after reviewing updated context')}</button>}{conflict && <button type="button" className="btn btn-outline btn-sm" disabled={disabled || applying} onClick={() => action(async () => { await session.continue(currentRun.id, { snapshot: state, locale, rebase: true }); setPreviewRun(''); setConflict(null); })}>{t('Continue with current project')}</button>}<button type="button" className="btn btn-ghost btn-sm" disabled={disabled || applying} onClick={() => action(async () => { await session.discard(currentRun.id); setPreviewRun(''); setConflict(null); })}>{t('Discard changes')}</button></div>
    </section>}
    </div>
    <div className="conversation-compose-area">
    {blockScope && <div className="ai-block-scope" role="group" aria-label={t('Selected blocks')}><strong>{t('Editing selected blocks')}</strong><ul>{blockScope.selectedInstanceIds.map(id => <li key={id}>{blockScope.blockInstances.find(block => block.id === id)?.label || id}</li>)}</ul><p className="field-help">{t('Describe a template change or content for the selected instance. Shared fields outside your selection are protected.')}</p>{blockScope.intent && <p className="field-help" role="status">{blockScope.intent === 'content' ? t('Content changes affect only the selected instances.') : t('Template changes affect all {count} instances of these source blocks.', { count: blockScope.blockInstances.filter(instance => blockScopeSourceTargets(blockScope).some(source => source.id === instance.sourceId)).length })}</p>}{blockScopeStale && <p className="inline-error" role="alert">{t('The selected preview is outdated. Refresh preview and select the blocks again.')}</p>}</div>}
    {scope.kind !== 'project' && <div className="conversation-scope"><span>{scope.kind === 'file' ? `@${scope.path}` : t(scope.kind === 'block' ? 'Selected blocks' : scope.kind === 'content' ? 'Content only' : 'Discuss without changes')}</span><button type="button" className="btn btn-ghost btn-xs" disabled={scope.kind === 'block' && blockSelectionBusy} onClick={removeScope}>{t('Remove scope')}</button></div>}
    {error && <p className="inline-error" role="alert">{t(error)}</p>}
    {!settings?.configured && !loading && <p className="field-help">{t('Connect your key in')} <button type="button" className="text-link" onClick={onSettings}>{t('Settings')}</button> {t('to start.')}</p>}
    <ConversationComposer prompt={prompt} onPromptChange={setPrompt} attachments={attachments} onAttachmentsChange={setAttachments} mentions={mentions} onMentionsChange={setMentions} files={files} sections={availableSections} onSubmit={send} disabled={disabled || loading || applying || !settings?.configured || blockScopeStale}
      scope={scope} onScopeChange={setScope} settings={settings} imageOnly={Boolean(blockScope)} generateImages={!blockScope && resolveImageGeneration(imageChoice, settings)} onGenerateImagesChange={blockScope ? undefined : setImageChoice} />
    <small className="conversation-disclosure">{t('Messages and referenced files are sent to your selected AI provider. Review changes before applying.')}</small>
    </div>
  </section>;
}
