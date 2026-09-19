import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Code2, History, LoaderCircle, Maximize2, Minimize2, MoreHorizontal, Pencil, PanelRightClose, PanelRightOpen, Plus, Settings2, Sparkles } from 'lucide-react';
import { LIMITS, changedProjectFiles, inputValues, isTemplate, projectFolders, readUploads, safePath, validateFolders, validateProject } from '@trafficops/template-editor-core';
import { applyProjectDraft, downloadFile, moveProjectEntry, removeProjectEntry, renameProjectFile } from './project.js';
import ProjectSidebar from './ProjectSidebar.jsx';
import ParameterForm from './ParameterForm.jsx';
import AssetPreview from './AssetPreview.jsx';
import PathInput from './PathInput.jsx';
import ResizableWorkspace from './ResizableWorkspace.jsx';
import PreviewPanel from './PreviewPanel.jsx';
import LocaleMenu from './LocaleMenu.jsx';
import VersionsPanel from './VersionsPanel.jsx';
import Modal from './Modal.jsx';
import AiSettings from './AiSettings.jsx';
import OpenRouterPanel from './OpenRouterPanel.jsx';
import { StudioHostContext } from './host-context.js';
import { useStudioText } from './studio-i18n.js';
import { activeElement, trapFocus } from './focus.js';
import { createAiDraftValidator } from './validate-ai-draft.js';
import { useEditorProject } from './useEditorProject.js';
const CodeEditor = lazy(() => import('./CodeEditor.jsx'));

export default function EditorShell({ host, ...props }) {
  return <StudioHostContext.Provider value={host}><Shell host={host} {...props} /></StudioHostContext.Provider>;
}
function Shell({ host, onSnapshot, onNewProject, newProjectCreatesCopy = false, onManageProjects, projectSwitcher, initialExpanded = false, previewExpandButton = true, showExportFooter = true, className = '', storageHelp = '', recovered, externalModalOpen = false, externalBusy = false, aiAllowed = true }) {
  const t = useStudioText(), editor = useEditorProject(host, onSnapshot, recovered, externalBusy);
  const { state, analysis, files, values, locale, locked, busy, dirty, change, report } = editor;
  const [tab, setTab] = useState(host.ai?.initialRequest ? 'ai' : 'content'), [aiView, setAiView] = useState('assistant'), [section, setSection] = useState('');
  const [active, setActive] = useState('index.tpl'), [reveal, setReveal] = useState(null), [imageSource, setImageSource] = useState(false);
  const [collapsed, setCollapsed] = useState(false), [mobile, setMobile] = useState(false), [expanded, setExpanded] = useState(initialExpanded);
  const [dialog, setDialog] = useState(null), [dialogValue, setDialogValue] = useState(''), [dialogError, setDialogError] = useState('');
  const [exporting, setExporting] = useState(null), [continueUrl, setContinueUrl] = useState(''), [shared, setShared] = useState(null);
  const [historyGroup, setHistoryGroup] = useState(''), [highlightVersions, setHighlightVersions] = useState(false), [nestedModal, setNestedModal] = useState(false);
  const root = useRef(null), workspace = useRef(null), toolbar = useRef(null), archive = useRef(null), data = useRef(null), versions = useRef(null);
  const createResolve = useRef(null), localeRef = useRef(locale), jump = useRef(false), id = useId(); localeRef.current = locale;
  const actionsMenu = useRef(null);
  useEffect(() => {
    const close = event => { if (actionsMenu.current && !event.composedPath().includes(actionsMenu.current)) actionsMenu.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const modalOpen = Boolean(dialog || exporting || nestedModal || externalModalOpen);
  const context = useMemo(() => ({ ...host, validateAiDraft: createAiDraftValidator(host.analyzer, () => editor.current.current, () => localeRef.current) }), [host]);
  useEffect(() => { if (!Object.hasOwn(files, active)) setActive(Object.keys(files)[0] || ''); }, [files, active]);
  useEffect(() => { setImageSource(false); }, [active]);
  useEffect(() => {
    if (!root.current) return;
    const observe = () => setNestedModal(Boolean(root.current?.querySelector('dialog[open]')));
    const observer = new MutationObserver(observe); observer.observe(root.current, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
    return () => observer.disconnect();
  }, [Boolean(state)]);
  useLayoutEffect(() => {
    if (!expanded || !workspace.current) return;
    const element = workspace.current, previous = activeElement(element), body = element.ownerDocument.body, overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    // Top layer keeps the overlay attached to the viewport even inside a transformed host.
    if (typeof element.showPopover === 'function' && !element.matches(':popover-open')) element.showPopover();
    toolbar.current?.focus();
    return () => {
      if (element.matches(':popover-open')) element.hidePopover();
      body.style.overflow = overflow;
      requestAnimationFrame(() => {
        // The compact preview button is recreated after leaving fullscreen.
        const target = previous?.isConnected && previous !== body ? previous : root.current?.querySelector('[data-editor-expand]');
        target?.focus();
      });
    };
  }, [expanded, Boolean(state)]);
  useEffect(() => {
    if (!highlightVersions) return;
    const timer = setTimeout(() => setHighlightVersions(false), 1200); return () => clearTimeout(timer);
  }, [highlightVersions]);
  useEffect(() => {
    if (!expanded && jump.current) {
      jump.current = false; versions.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); setHighlightVersions(true);
    }
  }, [expanded]);
  useEffect(() => () => createResolve.current?.(false), []);
  useEffect(() => {
    if (!aiAllowed) { setTab(previous => previous === 'ai' ? 'content' : previous); editor.setAiBusy(false); editor.setAiDraft(null); }
  }, [aiAllowed]);
  const openSettings = () => { setTab('ai'); setAiView('settings'); };
  const openFile = (path, selection) => { setActive(path); setTab('files'); setReveal(selection ? { path, selection } : null); };
  const mutate = patch => { if (!locked) change(patch); };
  function openDialog(kind, descriptor) { setDialog({ kind, descriptor: kind === 'delete' ? { type: 'file', path: active } : descriptor }); setDialogValue(kind === 'rename' ? active : kind === 'project-name' ? state.name : descriptor?.input?.value || ''); setDialogError(''); }
  function closeDialog() { if (dialog?.kind === 'ai-create') { createResolve.current?.(false); createResolve.current = null; } setDialog(null); setDialogError(''); }
  async function run(callback) {
    if (locked) return;
    editor.setBusy(true); editor.setError(''); editor.setNotice('');
    try { return await editor.operation(callback); } catch (cause) { report(cause); } finally { editor.setBusy(false); }
  }
  async function lifecycle(action, target, inputValue, dialogAction = false) {
    const operation = async signal => {
      const result = await host.lifecycle.run(action, editor.current.current, { signal, locale, target, inputValue });
      if (result.persisted) editor.install(result.state); else editor.setState(result.state);
      editor.setNotice(result.notice);
    };
    // Keep input dialogs open on errors so a name or validation issue can be fixed.
    if (!dialogAction) return run(operation);
    editor.setBusy(true);
    try { await editor.operation(operation); } catch (cause) { report(cause); throw cause; } finally { editor.setBusy(false); }
  }
  function declaredAction(action, target) { if (action.confirmation || action.input) openDialog('action', { ...action, target }); else lifecycle(action.id, target); }
  async function submitDialog(event) {
    event.preventDefault(); setDialogError('');
    try {
      const kind = dialog.kind;
      if (kind === 'ai-create') { createResolve.current?.(true); createResolve.current = null; }
      else if (kind === 'reload') await editor.reload();
      else if (kind === 'new') onNewProject?.();
      else if (kind === 'project-name') { if (!dialogValue.trim()) throw new Error(t('Project name is required.')); mutate({ name: dialogValue.trim() }); }
      else if (kind === 'action') {
        if (dialog.descriptor.input && !dialogValue.trim()) throw new Error(t('A name is required.'));
        await lifecycle(dialog.descriptor.id, dialog.descriptor.target, dialog.descriptor.input ? dialogValue.trim() : undefined, true);
      }
      else if (kind === 'language') {
        const lang = dialogValue.trim().toLowerCase().replace('_', '-');
        if (!/^[a-z]{2}(-[a-z]{2})?$/.test(lang) || Object.hasOwn(state.translations, lang) || Object.keys(state.translations).length >= 10) throw new Error(t('Choose a new language code, for example en, ru or uk.'));
        mutate({ translations: { ...state.translations, [lang]: {} } }); editor.setLocale(lang);
      } else if (kind === 'remove-language') {
        if (locale === state.locale) throw new Error(t('The default language cannot be removed.'));
        const next = { ...state.translations }; delete next[locale]; mutate({ translations: next }); editor.setLocale(state.locale);
      } else if (kind === 'delete' || kind === 'delete-folder') {
        const { active: nextActive, ...next } = removeProjectEntry(state, dialog.descriptor, active);
        mutate(next); setActive(nextActive);
      } else {
        const path = safePath(dialogValue.trim());
        if (kind === 'folder') {
          if (projectFolders(files, state.folders).includes(path)) throw new Error(t('This folder already exists.'));
          mutate({ folders: validateFolders(files, [...state.folders, path]) });
        } else if (kind === 'rename') { mutate(renameProjectFile(state, active, path)); setActive(path); }
        else {
          if (Object.hasOwn(files, path)) throw new Error(t('A file with this path already exists.'));
          const next = validateProject({ ...files, [path]: isTemplate(path) ? '@layout\n  <html><body><h1>New page</h1></body></html>\n@endlayout\n' : '' }); validateFolders(next, state.folders); mutate({ files: next }); openFile(path);
        }
      }
      setDialog(null);
    } catch (cause) { setDialogError(cause.message); }
  }
  async function importArchive(file) {
    if (!file) return;
    await run(async signal => {
      if (file.size > LIMITS.archive) throw new Error(t('ZIP archives must be 20 MiB or smaller.'));
      const imported = await host.project.import(new Uint8Array(await file.arrayBuffer()), { signal });
      change(previous => ({ files: imported.files, folders: imported.folders, entrypoint: imported.entrypoint || null, translations: { ...previous.translations, [locale]: imported.settings } })); openFile(Object.keys(imported.files)[0]);
    });
  }
  async function upload(list, folder = '') {
    if (locked || !list?.length) return;
    try { const next = await readUploads(Array.from(list), folder, files); mutate({ files: next }); } catch (cause) { report(cause); }
  }
  async function uploadImage(file) {
    if (locked) throw new Error(t('Finish the current operation before adding files.'));
    const name = file.name.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^\.+/, '') || 'image.png';
    let path = `images/${name}`, suffix = 2;
    while (Object.hasOwn(editor.current.current.files, path)) path = `images/${suffix++}-${name}`;
    const next = { ...editor.current.current.files, [path]: /\.svg$/i.test(path) ? await file.text() : new Uint8Array(await file.arrayBuffer()) };
    validateProject(next); change({ files: next }); return path;
  }
  async function exportZip(event) {
    event.preventDefault();
    await run(async signal => {
      const result = await host.project.export(editor.current.current, { ...exporting, continueUrl, signal, locale });
      downloadFile(result.name, result.bytes, result.mime); setExporting(null);
    });
  }
  async function share(open = false, target) {
    if (locked) return;
    const opened = open ? window.open('about:blank', '_blank') : null; if (opened) opened.opener = null;
    await run(async signal => {
      try {
        const result = target ? await host.preview.history(target, { signal, locale }) : await host.preview.create(editor.current.current, { signal, locale, shared: true });
        if (!target) setShared(result);
        if (opened) opened.location.replace(result.url); else if (!open) { await navigator.clipboard.writeText(result.url); editor.setNotice(t('Preview link copied.')); }
      } catch (cause) { opened?.close(); throw cause; }
    });
  }
  function historyAction(action) {
    if (action.operation === 'export') setExporting({ format: action.format || 'source', history: action.target });
    else if (action.operation === 'preview') share(true, action.target);
    else declaredAction(action, action.target);
  }
  function focusIssue(issue) {
    if (issue.file) { openFile(issue.file, { lineNumber: issue.line || 1, column: issue.column || 1 }); return; }
    if (!issue.path) { setTab('files'); return; }
    editor.setLocale(issue.locale); setSection(issue.section); setTab('content');
    requestAnimationFrame(() => { const node = root.current?.querySelector(`[id="setting-${issue.path.replaceAll('.', '-')}"]`); node?.scrollIntoView({ block: 'center' }); node?.focus(); });
  }
  if (!state) return <div className={`editor-root ${className}`} role="status">{editor.error || t('Opening project…')}</div>;
  const sections = analysis?.definition?.sections || [], shownSection = sections.find(item => item.id === section) || sections[0];
  const issues = analysis?.diagnostics || [], sourceIssues = analysis?.sourceDiagnostics || [];
  const pages = (analysis?.pages || []).map(name => ({ name, isEntry: name === state.entrypoint }));
  const page = pages.some(item => item.name === editor.previewPage) ? editor.previewPage : state.entrypoint || pages[0]?.name || '';
  const aiEnabled = aiAllowed && host.capabilities.ai && state.availability.ai && Boolean(host.ai);
  const transientStatus = editor.aiBusy ? t('AI is working…') : editor.aiDraft ? t('Review AI changes') : busy ? t('Working…') : dirty ? t('Unsaved changes') : '';
  const status = [state.status, transientStatus].filter(Boolean).join(' · ');
  const templateProject = state.actions.some(action => action.id === 'version'), pageProject = state.actions.some(action => action.id === 'publish');
  const description = templateProject ? t('A template is a reusable starting point for pages. Saving a draft does not create a template version or change existing pages.') : pageProject ? t('You are editing the page draft. Saving keeps your work; publishing updates the version shown to visitors.') : '';
  const historyDescription = templateProject ? t('Template versions can be used to create pages. Drafts keep your saved work in progress.') : pageProject ? t('Publications are versions shown to visitors. Drafts keep your saved work in progress.') : t('Published versions and saved drafts of this project.');
  const titles = { 'project-name': t('Project name'), file: t('New file'), folder: t('New folder'), rename: t('Rename file'), delete: t('Delete file'), 'delete-folder': t('Delete folder'), language: t('Add language'), 'remove-language': t('Remove language'), reload: t('Reload saved project'), new: t('New project'), 'ai-create': t('Create new project'), action: dialog?.descriptor?.label };
  const actionButtons = <><button type="button" className="btn btn-outline" disabled={locked || editor.conflict} onClick={editor.save}>{t('Save draft')}</button>{state.actions.filter(action => action.intent !== 'danger').map(action => <button type="button" key={action.id} className={`btn ${action.intent === 'primary' ? 'btn-primary' : 'btn-outline'}`} disabled={locked || action.disabled} onClick={() => declaredAction(action)}>{action.label}</button>)}</>;
  const groups = state.history.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row, meta: row.meta.map(item => /^\d{4}-\d\d-\d\dT/.test(item) ? new Date(item).toLocaleString(host.language) : item).join(' · '), actions: row.actions.map(action => <button key={action.id} className="btn btn-ghost btn-sm" disabled={locked || action.disabled} onClick={() => historyAction(action)}>{action.label}</button>) })) }));
  return <StudioHostContext.Provider value={context}><div ref={root} className={`editor-root ${className}`}>
    <header className="hosted-heading">
      <div className="hosted-identity">
        <div className="hosted-title"><h1>{state.name}</h1><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label={t('Rename project')} title={t('Rename project')} disabled={locked} onClick={() => openDialog('project-name')}><Pencil size={16} /></button></div>
        <span className={`hosted-status ${dirty ? 'is-dirty' : ''}`} role="status"><span aria-hidden="true" />{status}</span>
        {description && <p className="hosted-description">{description}</p>}
      </div>
      <div className="hosted-actions">
        {actionButtons}
        <details className="hosted-more" ref={actionsMenu} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
          <summary className="btn btn-outline btn-square" aria-label={t('More actions')}><MoreHorizontal size={18} /></summary>
          <div className="hosted-more-menu" onClick={event => { if (event.target.closest('button')) actionsMenu.current.open = false; }}>
            {host.capabilities.preview && state.availability.externalPreview && <><button type="button" disabled={locked} onClick={() => share(true)}>{t('Open preview')} ↗</button><button type="button" disabled={locked} onClick={() => share()}>{t('Copy preview link')}</button></>}
            <button type="button" disabled={locked} onClick={() => setExporting({ format: 'source' })}><ArrowDownToLine size={14} />{t('Download project')}</button>
            {!previewExpandButton && <button type="button" onClick={() => { actionsMenu.current?.querySelector('summary').focus(); setExpanded(true); }}><Maximize2 size={14} />{t('Expand editor')}</button>}
            {onNewProject && <button type="button" disabled={locked} onClick={() => newProjectCreatesCopy ? onNewProject() : openDialog('new')}><Plus size={14} />{t('New project')}</button>}
            {host.capabilities.preview && !state.availability.externalPreview && <p>{t('External preview is not configured. Inline preview is still available.')}</p>}
          </div>
        </details>
      </div>
    </header>
    {editor.notice && <p className="notice" role="status">{editor.notice}</p>}{editor.error && <div className="inline-error" role="alert"><span>{editor.error}</span><button className="btn btn-ghost btn-xs" onClick={() => editor.setError('')}>{t('Dismiss')}</button></div>}
    {editor.conflict && <div className="hosted-callout" role="alert"><span>{t('Saving stopped because the project changed elsewhere. Your edits are kept here. Export them before reloading.')}</span><button className="btn btn-outline btn-sm" disabled={locked} onClick={() => openDialog('reload')}>{t('Reload saved project')}</button></div>}
    {shared && <div className="hosted-callout"><a href={shared.url} target="_blank" rel="noopener noreferrer">{t('Preview link')}</a>{shared.expiresAt && <span>{t('Expires')} {new Date(shared.expiresAt).toLocaleString(host.language)}</span>}<button className="btn btn-ghost btn-xs" disabled={locked} onClick={() => run(async signal => { await host.preview.revoke(shared, { signal }); setShared(null); })}>{t('Revoke')}</button></div>}
    {(issues.length > 0 || sourceIssues.length > 0) && <details className="hosted-diagnostics" open><summary>{t('Needs attention')} ({issues.length + sourceIssues.length})</summary><ul>{[...issues, ...sourceIssues].map((issue, index) => <li key={index}><button onClick={() => focusIssue(issue)}>{issue.locale && `${issue.locale.toUpperCase()} · ${issue.sectionLabel || issue.section} · ${issue.label} · `}{issue.message}</button></li>)}</ul></details>}
    <ResizableWorkspace ref={workspace} popover={expanded ? 'manual' : undefined} role={expanded ? 'dialog' : undefined} aria-modal={expanded && !modalOpen ? 'true' : undefined} aria-label={expanded ? t('Template editor') : undefined} className={`editor-shell ${expanded ? 'is-expanded' : 'is-compact'} ${collapsed ? 'files-collapsed' : ''} ${!editor.showPreview ? 'preview-collapsed' : ''}`} onKeyDown={event => { if (!expanded || modalOpen) return; if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); } else trapFocus(event, workspace.current); }}>
      {expanded && <div className="studio-toolbar" ref={toolbar} tabIndex={-1}><strong>{state.name}</strong><button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t('Rename project')} disabled={locked} onClick={() => openDialog('project-name')}><Pencil size={14} /></button>{projectSwitcher}<span role="status">{status}</span><div className="studio-toolbar-actions">{groups.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { jump.current = true; setExpanded(false); }}><History size={14} />{t('Versions')}</button>}{actionButtons}{host.capabilities.htmlExport && <button className="btn btn-primary btn-sm" disabled={locked} onClick={() => setExporting({ format: 'html' })}><ArrowDownToLine size={14} />{t('Download landing')}</button>}<button className="btn btn-ghost btn-sm" aria-label={t('Collapse editor')} onClick={() => setExpanded(false)}><Minimize2 size={16} /></button></div>{editor.error && <div className="toolbar-error" role="alert"><span>{editor.error}</span>{editor.conflict && <button className="btn btn-outline btn-xs" disabled={locked} onClick={() => openDialog('reload')}>{t('Reload saved project')}</button>}</div>}</div>}
      <ProjectSidebar files={files} folders={state.folders} active={active} locked={locked} changedFiles={changedProjectFiles(files, editor.baseline)} aiPreview={Boolean(editor.aiDraft)} aiEnabled={aiEnabled} projectName={state.name} storageSummary={state.status} storageHelp={storageHelp} savesToDisk={host.capabilities.autosave || host.capabilities.lifecycle} isCollapsed={collapsed} onToggleCollapsed={() => setCollapsed(value => !value)} onManageProjects={onManageProjects} onSelect={openFile} onCreate={openDialog} onRename={() => openDialog('rename')} onDelete={() => openDialog('delete')} onDeleteFolder={path => openDialog('delete-folder', { type: 'folder', path })} onMove={(entry, folder) => { try { const { active: nextActive, ...next } = moveProjectEntry(state, entry, folder, active); mutate(next); setActive(nextActive); } catch (cause) { report(cause); } }} onUpload={upload} onExport={() => setExporting({ format: 'source' })} onOpenArchive={() => archive.current.click()} />
      <section className="author-panel"><div className="author-tabs"><div className="author-tab-list" role="tablist" aria-label={t('Authoring mode')}>{[['content', t('Content'), Settings2], ['files', t('Files'), Code2], ...(aiEnabled ? [['ai', t('AI assistant'), Sparkles]] : [])].map(([key, label, Icon]) => <button type="button" key={key} id={`${id}-${key}`} role="tab" aria-controls={`${id}-panel`} aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={14} />{label}</button>)}</div><div className="author-tab-actions">{host.capabilities.locales && <LocaleMenu locales={Object.keys(state.translations)} value={locale} defaultLocale={state.locale} issues={Object.fromEntries(Object.keys(state.translations).map(lang => [lang, issues.filter(issue => issue.locale === lang).length]))} disabled={locked} onSelect={editor.setLocale} onAdd={() => openDialog('language')} onMakeDefault={() => mutate({ locale })} onRemove={() => openDialog('remove-language')} />}<button className="btn btn-ghost btn-xs btn-square" aria-label={t(editor.showPreview ? 'Hide preview' : 'Show preview')} aria-expanded={editor.showPreview} onClick={() => editor.setShowPreview(value => !value)}>{editor.showPreview ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button></div></div>
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={`author-content ${tab === 'files' ? 'source-content' : ''}`}>
          {tab === 'content' && <><nav className="hosted-sections">{sections.map(item => <button key={item.id} className={shownSection?.id === item.id ? 'selected' : ''} onClick={() => setSection(item.id)}>{item.label}{issues.some(issue => issue.locale === locale && issue.section === item.id) && ' ⚠'}</button>)}</nav>{shownSection ? <fieldset disabled={locked}><ParameterForm definition={{ ...analysis.definition, sections: [shownSection] }} values={values} files={files} projectImages={Object.keys(files).filter(path => /\.(?:png|jpe?g|webp|svg|gif|avif)$/i.test(path))} aiEnabled={aiEnabled} onSettings={openSettings} onImageUpload={uploadImage} errors={issues.filter(issue => issue.locale === locale)} onChange={next => mutate(previous => ({ translations: { ...previous.translations, [locale]: next } }))} /></fieldset> : <p className="field-help">{t('This project has no editable fields.')}</p>}<div className="settings-actions"><button className="btn btn-ghost btn-xs" disabled={locked} onClick={() => mutate({ translations: { ...state.translations, [locale]: {} } })}>{t('Reset defaults')}</button><button className="btn btn-ghost btn-xs" disabled={locked} onClick={() => data.current.click()}>{t('Load JSON')}</button><button className="btn btn-ghost btn-xs" onClick={() => downloadFile('trafficops-data.json', JSON.stringify(values, null, 2), 'application/json')}>{t('Save JSON')}</button></div></>}
          {tab === 'files' && (typeof files[active] === 'string' && (!/\.svg$/i.test(active) || imageSource) ? <Suspense fallback={<div className="source-loading" role="status" aria-label={t('Opening editor…')}><LoaderCircle className="spin" size={24} aria-hidden="true" /></div>}><CodeEditor key={active} dialect={host.dialect} path={active} value={files[active]} files={files} onChange={value => mutate(previous => ({ files: { ...previous.files, [active]: value } }))} reveal={reveal?.path === active ? reveal : null} onOpenFile={openFile} onError={editor.setError} readOnly={locked} /></Suspense> : <AssetPreview key={active} path={active} value={files[active]} onEditSource={typeof files[active] === 'string' ? () => setImageSource(true) : undefined} />)}
          {aiEnabled && <><div hidden={tab !== 'ai' || aiView !== 'assistant'}><OpenRouterPanel disabled={externalBusy || busy} allowInitialStart={!dirty} onOpenFile={openFile} definition={analysis?.definition} values={values} files={state.files} onSettings={openSettings} onBusyChange={editor.setAiBusy} onPreview={editor.setAiDraft} onConfirmCreate={() => new Promise(resolve => { createResolve.current = resolve; openDialog('ai-create'); })} onApply={next => change(previous => ({ translations: { ...previous.translations, [locale]: next } }))} onApplyProject={(next, nextValues, options) => change(previous => applyProjectDraft(previous, next, nextValues, locale, options))} /></div>{tab === 'ai' && aiView === 'settings' && <AiSettings onBack={() => setAiView('assistant')} />}</>}
        </div>
      </section>
      {editor.showPreview && <PreviewPanel pages={pages} page={page} onPageChange={editor.setPreviewPage} onSetEntry={host.capabilities.entrypoint ? entrypoint => mutate({ entrypoint }) : undefined} locked={locked} mobile={mobile} onMobileChange={setMobile} preview={editor.preview} error={editor.previewError} ready={Boolean(editor.preview)} {...(previewExpandButton && !expanded ? { expanded: false, onToggleExpanded: () => setExpanded(true) } : {})} note={t('Static preview · scripts are disabled')} />}
      {dialog && <Modal title={titles[dialog.kind]} onClose={closeDialog} onSubmit={submitDialog} confirmLabel={dialog.kind === 'action' && dialog.descriptor.input ? dialog.descriptor.label : t(dialog.kind === 'ai-create' ? 'Create new project' : ['delete', 'delete-folder'].includes(dialog.kind) ? 'Delete' : 'Apply')} confirmFirst={!dialog.descriptor?.input && ['delete', 'delete-folder', 'remove-language', 'reload', 'new', 'ai-create', 'action'].includes(dialog.kind)} busy={busy}>
        {!['delete', 'delete-folder', 'remove-language', 'reload', 'new', 'ai-create', 'action'].includes(dialog.kind) && (dialog.kind === 'project-name' ? <input className="input w-full" aria-label={t('Project name')} value={dialogValue} maxLength={120} required onChange={event => setDialogValue(event.target.value)} /> : dialog.kind === 'language' ? <input className="input w-full" aria-label={t('Language code')} value={dialogValue} onChange={event => setDialogValue(event.target.value)} placeholder="en, ru, uk" /> : <PathInput value={dialogValue} onChange={setDialogValue} folders={projectFolders(files, state.folders)} label={t('Path')} />)}
        {['delete', 'delete-folder'].includes(dialog.kind) && <p>{dialog.descriptor.path}</p>}{dialog.kind === 'delete-folder' && <p className="field-help">{t('This deletes the folder and all files and subfolders inside it. References in other files are not updated.')}</p>}{dialog.kind === 'remove-language' && <p>{locale.toUpperCase()}</p>}{dialog.kind === 'rename' && <p className="field-help">{t('Renaming does not update references in other files.')}</p>}{['new', 'ai-create'].includes(dialog.kind) && <p>{t('This replaces all files in the current project. Export your work first if you want to keep it.')}</p>}{dialog.kind === 'reload' && <p>{t('Reloading discards the edits shown here and opens the last saved project.')}</p>}{dialog.kind === 'action' && <>{dialog.descriptor.confirmation && <p>{dialog.descriptor.confirmation}</p>}{dialog.descriptor.input && <label className="field"><span>{dialog.descriptor.input.label}</span><input className="input w-full" aria-label={dialog.descriptor.input.label} value={dialogValue} maxLength={dialog.descriptor.input.maxLength} required disabled={busy} onChange={event => setDialogValue(event.target.value)} />{dialog.descriptor.input.help && <small className="field-help">{dialog.descriptor.input.help}</small>}</label>}</>}{dialogError && <p role="alert" className="inline-error">{dialogError}</p>}
      </Modal>}
      {exporting && <Modal title={t('Download project')} onClose={() => setExporting(null)} onSubmit={exportZip} confirmLabel={t('Download')} busy={busy}><label className="field"><span>{t('Archive format')}</span><select className="select w-full" value={exporting.format} onChange={event => setExporting({ ...exporting, format: event.target.value })} disabled={Boolean(exporting.history)}>{host.capabilities.sourceExport && <option value="source">{t('Source ZIP')}</option>}{host.capabilities.htmlExport && <option value="html">{t('HTML ZIP')}</option>}</select></label><p className="field-help">{locale.toUpperCase()} · {exporting.history ? t('Saved version') : t('Current edits')}</p>{exporting.format === 'html' && host.capabilities.preview && <label className="field"><span>{t('Continue URL')}</span><input className="input w-full" value={continueUrl} onChange={event => setContinueUrl(event.target.value)} placeholder="https://…" /><small>{t('Used by the continue link in the exported page.')}</small></label>}{editor.error && <p className="inline-error" role="alert">{editor.error}</p>}</Modal>}
    </ResizableWorkspace>
    {showExportFooter && <div className="workspace-footer"><span role="status">{status}</span>{host.capabilities.htmlExport && <button className="btn btn-primary" disabled={locked} onClick={() => setExporting({ format: 'html' })}><ArrowDownToLine size={15} />{t('Download landing')}</button>}</div>}
    {groups.length > 0 && <div ref={versions}><VersionsPanel title={t('Versions')} description={historyDescription} groups={groups} group={historyGroup} onGroupChange={setHistoryGroup} highlighted={highlightVersions} onDismissHighlight={() => setHighlightVersions(false)} actions={state.actions.filter(action => action.intent === 'danger').map(action => <button key={action.id} className="btn btn-ghost btn-sm" disabled={locked || action.disabled} onClick={() => declaredAction(action)}>{action.label}</button>)} /></div>}
    <input ref={archive} type="file" accept=".zip,application/zip" aria-label={t('Open template ZIP')} hidden onChange={event => { importArchive(event.target.files[0]); event.target.value = ''; }} />
    <input ref={data} type="file" accept=".json,application/json" aria-label={t('Load parameter JSON')} hidden onChange={async event => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; try { const next = JSON.parse(await file.text()); if (!next || Array.isArray(next) || typeof next !== 'object') throw new Error(t('Parameter data must be a JSON object.')); mutate({ translations: { ...state.translations, [locale]: next } }); } catch (cause) { report(cause); } }} />
  </div></StudioHostContext.Provider>;
}
