import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, ChevronDown, Code2, Eye, Files as FilesIcon, FolderOpen, History, LoaderCircle, Maximize2, Minimize2, MoreHorizontal, Pencil, PanelRightClose, PanelRightOpen, Plus, Save, Settings2, ShieldCheck, Sparkles, SquarePen } from 'lucide-react';
import { LIMITS, changedProjectFiles, isTemplate, projectFolders, readUploads, safePath, validateFolders, validateProject } from '@trafficops/template-editor-core';
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
import { Button, ConfirmDialog, InlineNotice, Skeleton, StatusBadge, Tabs, tabPanelProps } from '@trafficops/studio-ui/primitives';
import { StudioUiProvider, useStudioUi } from '@trafficops/studio-ui/i18n';
import { useChatPort } from './useChatPort.js';
import { keptDraft, launchBlockScope } from './chat-port.js';
import { getConversationSession } from './conversation-runtime.js';
import Menu from './Menu.jsx';
import { fileAiSupport } from './file-ai-workflow.js';
import { StudioHostContext } from './host-context.js';
import { useStudioText } from './studio-i18n.js';
import { activeElement, trapFocus } from './focus.js';
import { createAiDraftValidator } from './validate-ai-draft.js';
import { useEditorProject } from './useEditorProject.js';
import { blockScopeSourceTargets, createBlockEditScope } from './block-edit-scope.js';
import { liveDraftPreview } from './chat-live-preview.js';
import { blockScopeBaseMatches, previewSelectionMatches, selectedPreviewBlocks } from './preview-selection.js';
const CodeEditor = lazy(() => import('./CodeEditor.jsx'));
// Чат — отдельный чанк: догружается при первом открытии вкладки AI.
const StudioChat = lazy(() => import('@trafficops/studio-ui/chat').then(module => ({ default: module.StudioChat })));
const activeRunStates = new Set(['queued', 'running']);

export default function EditorShell({ host, ...props }) {
  return <StudioHostContext.Provider value={host}><Shell host={host} {...props} /></StudioHostContext.Provider>;
}
function Shell({ host, onSnapshot, onNewProject, onImportProject, newProjectCreatesCopy = false, onManageProjects, projectSwitcher, initialExpanded = false, presentation = 'embedded', onSaveToFolder, storageSummary = '', previewExpandButton = true, showExportFooter = true, className = '', storageHelp = '', recovered, externalModalOpen = false, externalBusy = false, aiAllowed = true, toolbarStart, projectMenu, toolbarNotices, toolbarAlerts, moreMenu }) {
  const t = useStudioText(), editor = useEditorProject(host, onSnapshot, recovered, externalBusy);
  const { state, analysis, files, values, locale, locked, busy, dirty, change, report } = editor;
  const aiEnabled = aiAllowed && host.capabilities.ai && state?.availability.ai && Boolean(host.ai);
  // Conversation history and connection setup remain accessible even when
  // the host temporarily cannot run AI requests.
  const conversationsAvailable = aiAllowed && Boolean(host.ai) && (Boolean(host.conversations) || host.capabilities.ai);
  const isApp = presentation === 'app';
  const [tab, setTab] = useState(() => isApp ? conversationsAvailable && host.ai?.initialRequest ? 'ai' : 'content' : host.conversations || host.ai?.initialRequest ? 'ai' : 'content'), [aiView, setAiView] = useState('assistant'), [section, setSection] = useState('');
  const [active, setActive] = useState('index.tpl'), [reveal, setReveal] = useState(null), [imageSource, setImageSource] = useState(false);
  const [collapsed, setCollapsed] = useState(false), [mobile, setMobile] = useState(false), [expanded, setExpanded] = useState(initialExpanded);
  // Narrow app layouts show one panel at a time; wider layouts ignore it.
  const [pane, setPane] = useState('author');
  const [dialog, setDialog] = useState(null), [dialogValue, setDialogValue] = useState(''), [dialogError, setDialogError] = useState('');
  const [chatLaunch, setChatLaunch] = useState(null), [chatThreadId, setChatThreadId] = useState(null), [aiOpened, setAiOpened] = useState(false);
  const [blockSelectionBusy, setBlockSelectionBusy] = useState(false), [useOnPage, setUseOnPage] = useState(false);
  const [selectionEnabled, setSelectionEnabled] = useState(false), [selectionFrame, setSelectionFrame] = useState(null);
  const [selectionPage, setSelectionPage] = useState(''), [selectedInstanceIds, setSelectedInstanceIds] = useState([]);
  const [exporting, setExporting] = useState(null), [continueUrl, setContinueUrl] = useState(''), [shared, setShared] = useState(null);
  const [historyGroup, setHistoryGroup] = useState(''), [highlightVersions, setHighlightVersions] = useState(false), [nestedModal, setNestedModal] = useState(false);
  const root = useRef(null), workspace = useRef(null), toolbar = useRef(null), archive = useRef(null), data = useRef(null), versions = useRef(null);
  const createPrompt = useRef(''), chat = useRef(null), localeRef = useRef(locale), jump = useRef(false), id = useId(); localeRef.current = locale;
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
    if (isApp || !expanded || !workspace.current) return;
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
  }, [expanded, Boolean(state), isApp]);
  useEffect(() => {
    if (!highlightVersions) return;
    const timer = setTimeout(() => setHighlightVersions(false), 1200); return () => clearTimeout(timer);
  }, [highlightVersions]);
  useEffect(() => {
    if (!expanded && jump.current) {
      jump.current = false; versions.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); setHighlightVersions(true);
    }
  }, [expanded]);
  useEffect(() => { if (tab === 'ai' && aiView === 'assistant') setAiOpened(true); }, [tab, aiView]);
  useEffect(() => { setPane('author'); }, [tab]);
  useEffect(() => { if (!editor.showPreview) setPane(previous => previous === 'preview' ? 'author' : previous); }, [editor.showPreview]);
  // Tablet widths fold the file tree into its icon rail so the editor and preview keep usable widths.
  useEffect(() => {
    if (!isApp) return;
    const tablet = matchMedia('(min-width: 761px) and (max-width: 960px)'), fold = () => { if (tablet.matches) setCollapsed(true); };
    fold(); tablet.addEventListener('change', fold);
    return () => tablet.removeEventListener('change', fold);
  }, [isApp]);
  useEffect(() => {
    if (!aiAllowed) { setTab(previous => previous === 'ai' ? 'content' : previous); editor.setAiBusy(false); editor.setAiDraft(null); }
  }, [aiAllowed]);
  useEffect(() => {
    if (!aiEnabled || !editor.showPreview) { setSelectionEnabled(false); setSelectedInstanceIds([]); }
  }, [aiEnabled, editor.showPreview]);
  function selectionDocumentChanged(frame, currentPage) {
    const previous = selectionFrame?.sourceSnapshot;
    const sameSnapshot = currentPage === selectionPage && previous && previewSelectionMatches(frame, previous);
    setSelectionFrame(frame); setSelectionPage(currentPage);
    // Initial analysis can render an identical successor. Its new routing token
    // does not change the source snapshot or invalidate a user's first click.
    setSelectedInstanceIds(ids => sameSnapshot ? selectedPreviewBlocks(frame, ids, currentPage).map(block => block.id) : []);
  }
  function refreshSelectionPreview() { setSelectedInstanceIds([]); editor.refreshPreview(); }
  function selectionChanged(ids, frame, currentPage) {
    if (locked || blockSelectionBusy || !previewSelectionMatches(frame, { files: state.files, values, locale })) return;
    const selected = selectedPreviewBlocks(frame, ids, currentPage);
    setSelectionFrame(frame); setSelectionPage(currentPage); setSelectedInstanceIds(selected.map(block => block.id));
    // The assistant keeps its frozen scope until the user explicitly replaces
    // it with "Edit selected" or removes it. A preview click must never turn a
    // scoped request into an unrestricted project edit.
  }
  function editSelectedBlocks() {
    if (locked || blockSelectionBusy || !previewSelectionMatches(selectionFrame, { files: state.files, values, locale })) return;
    try {
      const scope = createBlockEditScope({ version: 1, page: selectionPage, locale, ...selectionFrame.selection, selectedInstanceIds },
        { files: state.files, rawValues: state.translations[locale] || {}, values });
      // Адаптер хранит editScope по ключу; в StudioChat уходит только сериализуемая ссылка на него.
      const key = JSON.stringify(scope.targets);
      chat.current?.registerBlockScope(key, scope);
      // Запуск из превью открывает новый диалог (как прежняя панель); editScope — для панели «Selected blocks».
      setChatThreadId(''); setChatLaunch({ id: crypto.randomUUID(), scope: { kind: 'block', targetId: key }, mentions: [], editScope: scope });
      showAssistant();
    } catch (cause) { report(cause); }
  }
  // «Keep draft in editor» для упавшего или прерванного рана: черновик кладётся в проект без валидации
  // (как прежняя кнопка AiRunSummary → OpenRouterPanel.onApplyProject); applyConversationDraft невалидный черновик отвергает.
  const keepDraftInEditor = useCallback(run => {
    const draft = keptDraft(run, { locale: localeRef.current, t }); if (!draft) return;
    change(previous => applyProjectDraft(previous, draft.files, draft.values, draft.locale, { mode: draft.mode }));
    setSelectedInstanceIds([]);
  }, [change, t]);
  async function createProjectWithAi() {
    const port = chat.current?.port; if (!port) return;
    // Всегда новый тред: в текущем активный ран превратил бы запрос в уточнение, а готовый — в продолжение черновика.
    const thread = await port.createThread(); setChatThreadId(thread.id);
    await port.send(thread.id, { text: createPrompt.current || t('Create a new project'), mentions: [], attachments: [], scope: { kind: 'project' }, mode: 'create' });
  }
  // Jumps to the assistant also bring its panel forward on narrow layouts, even when its tab is already selected.
  const showAssistant = () => { setTab('ai'); setAiView('assistant'); setPane('author'); };
  const openSettings = () => { setTab('ai'); setAiView('settings'); setPane('author'); };
  const openFile = (path, selection) => { editor.previewConversationDraft?.(null); setActive(path); setTab('files'); setPane('author'); setReveal(selection ? { path, selection } : null); };
  const mutate = patch => { if (!locked) change(patch); };
  function openDialog(kind, descriptor) { setDialog({ kind, descriptor: kind === 'delete' ? { type: 'file', path: active } : descriptor }); setDialogValue(kind === 'rename' ? active : kind === 'project-name' ? state.name : descriptor?.input?.value || ''); setDialogError(''); }
  function closeDialog() { setDialog(null); setDialogError(''); }
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
      if (kind === 'reload') await editor.reload();
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
    if (onImportProject) { await onImportProject(file); return; }
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
    if (!issue.path) { setTab('files'); setPane('author'); return; }
    editor.setLocale(issue.locale); setSection(issue.section); setTab('content'); setPane('author');
    requestAnimationFrame(() => { const node = root.current?.querySelector(`[id="setting-${issue.path.replaceAll('.', '-')}"]`); node?.scrollIntoView({ block: 'center' }); node?.focus(); });
  }
  if (!state) return <div className={`studio-root editor-root ${className}`} role="status">{editor.error || t('Opening project…')}</div>;
  const sections = analysis?.definition?.sections || [], shownSection = sections.find(item => item.id === section) || sections[0];
  const issues = analysis?.diagnostics || [], sourceIssues = analysis?.sourceDiagnostics || [];
  const pages = (editor.previewPages || analysis?.pages || []).map(name => ({ name, isEntry: name === state.entrypoint }));
  const page = pages.some(item => item.name === editor.previewPage) ? editor.previewPage : state.entrypoint || pages[0]?.name || '';
  const fileAiAvailability = fileAiSupport(active, state.files[active]);
  const selectedBlocks = selectedPreviewBlocks(selectionFrame, selectedInstanceIds, selectionPage);
  const selectionStale = !previewSelectionMatches(selectionFrame, { files: state.files, values, locale });
  const openFileAi = aiEnabled ? () => {
    if (locked || !fileAiAvailability.supported) return;
    setChatThreadId(''); setChatLaunch({ id: crypto.randomUUID(), scope: { kind: 'file', targetId: active }, mentions: [{ kind: 'file', id: active, label: active }] }); showAssistant();
  } : undefined;
  const savedTime = editor.savedAt ? new Date(editor.savedAt).toLocaleTimeString(host.language, { hour: '2-digit', minute: '2-digit' }) : '';
  const transientStatus = editor.conflict ? t('Not saved: conflict') : editor.aiBusy ? t('AI is working…') : editor.aiDraft ? t('Review AI changes') : editor.saving ? t('Saving…') : busy ? t('Working…') : dirty ? host.capabilities.autosave && !editor.error ? t('Saving…') : t('Unsaved changes') : '';
  const status = transientStatus || (savedTime ? t('Saved {time}', { time: savedTime }) : state.status);
  const statusTone = editor.conflict ? 'danger' : transientStatus ? 'warning' : 'success';
  const statusBadge = <StatusBadge tone={statusTone}>{status}</StatusBadge>;
  const saveStatus = editor.conflict ? t('Not saved: conflict') : editor.saving || dirty && host.capabilities.autosave && !editor.error ? t('Saving…') : dirty ? t('Unsaved changes') : savedTime ? t('Saved {time}', { time: savedTime }) : state.status;
  const saveBadge = <StatusBadge tone={editor.conflict ? 'danger' : editor.saving || dirty ? 'warning' : 'success'}>{saveStatus}</StatusBadge>;
  const templateProject = state.actions.some(action => action.id === 'version'), pageProject = state.actions.some(action => action.id === 'publish');
  const description = templateProject ? t('A template is a reusable starting point for pages. Saving a draft does not create a template version or change existing pages.') : pageProject ? t('You are editing the page draft. Saving keeps your work; publishing updates the version shown to visitors.') : '';
  const historyDescription = templateProject ? t('Template versions can be used to create pages. Drafts keep your saved work in progress.') : pageProject ? t('Publications are versions shown to visitors. Drafts keep your saved work in progress.') : t('Published versions and saved drafts of this project.');
  const titles = { 'project-name': t('Project name'), file: t('New file'), folder: t('New folder'), rename: t('Rename file'), delete: t('Delete file'), 'delete-folder': t('Delete folder'), language: t('Add language'), 'remove-language': t('Remove language'), reload: t('Reload saved project'), new: t('New project'), action: dialog?.descriptor?.label };
  const actionButtons = <><button type="button" className="btn btn-outline" disabled={locked || editor.conflict} title={host.capabilities.autosave ? t('Changes save automatically. Export Source ZIP for a portable backup.') : t('Save current edits')} onClick={editor.save}>{t('Save draft')}</button>{state.actions.filter(action => action.intent !== 'danger').map(action => <button type="button" key={action.id} className={`btn ${action.intent === 'primary' ? 'btn-primary' : 'btn-outline'}`} disabled={locked || action.disabled} onClick={() => declaredAction(action)}>{action.label}</button>)}</>;
  const groups = state.history.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row, meta: row.meta.map(item => /^\d{4}-\d\d-\d\dT/.test(item) ? new Date(item).toLocaleString(host.language) : item).join(' · '), actions: row.actions.map(action => <button key={action.id} className="btn btn-ghost btn-sm" disabled={locked || action.disabled} onClick={() => historyAction(action)}>{action.label}</button>) })) }));
  const exportButtons = (host.capabilities.sourceExport || host.capabilities.htmlExport) && <Menu className="studio-export-menu" label={t('Export')} triggerClassName="btn btn-primary btn-sm" disabled={locked} trigger={<><ArrowDownToLine size={14} />{t('Export')}</>}>
    {({ close }) => <>{host.capabilities.htmlExport && <button type="button" role="menuitem" onClick={() => { close(); setExporting({ format: 'html' }); }}><strong>{t('Landing for hosting')}</strong><small>{t('HTML and images ready to upload')}</small></button>}{host.capabilities.sourceExport && <button type="button" role="menuitem" onClick={() => { close(); setExporting({ format: 'source', includeHistory: Boolean(host.conversations) }); }}><strong>{t('Editable project')}</strong><small>{t('Source files and a portable project backup')}</small></button>}</>}
  </Menu>;
  const modeTabs = className => <div className={className} role="tablist" aria-label={t('Authoring mode')}>{[['content', t('Content'), Settings2], ['files', t('Code'), Code2], ...(conversationsAvailable ? [['ai', t('Conversations'), Sparkles]] : [])].map(([key, label, Icon]) => <button type="button" key={key} id={`${id}-${key}`} role="tab" aria-controls={`${id}-panel`} aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => { setTab(key); setPane('author'); }}><Icon size={14} aria-hidden="true" />{label}</button>)}</div>;
  const localeMenu = host.capabilities.locales && <LocaleMenu locales={Object.keys(state.translations)} value={locale} defaultLocale={state.locale} issues={Object.fromEntries(Object.keys(state.translations).map(lang => [lang, issues.filter(issue => issue.locale === lang).length]))} disabled={locked} onSelect={editor.setLocale} onAdd={() => openDialog('language')} onMakeDefault={() => mutate({ locale })} onRemove={() => openDialog('remove-language')} />;
  const previewToggle = <button className="btn btn-ghost btn-sm btn-square preview-toggle" aria-label={t(editor.showPreview ? 'Hide preview' : 'Show preview')} title={t(editor.showPreview ? 'Hide preview' : 'Show preview')} aria-expanded={editor.showPreview} onClick={() => editor.setShowPreview(value => !value)}>{editor.showPreview ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>;
  const visibleActions = state.actions.filter(action => action.intent !== 'danger'), primaryActions = visibleActions.filter(action => action.intent === 'primary');
  const saveButton = <button type="button" className="btn btn-outline btn-sm" disabled={locked || editor.conflict} title={t('Save current edits')} onClick={editor.save}>{t('Save draft')}</button>;
  // The app toolbar keeps one line: navigation and status, the authoring mode, then actions with Export as the only primary button.
  const appToolbar = <div className="studio-toolbar" ref={toolbar} tabIndex={-1}>
    <div className="studio-toolbar-start">{toolbarStart}
      <h1 className="studio-project-title"><Menu className="studio-project-menu" label={state.name} triggerClassName="studio-project-trigger" trigger={<><strong className="studio-project-name">{state.name}</strong><ChevronDown size={14} aria-hidden="true" /></>}>
        {({ close }) => <><button type="button" role="menuitem" disabled={locked} onClick={() => { close(); openDialog('project-name'); }}><Pencil size={14} />{t('Rename project')}</button>{projectMenu?.({ close })}</>}
      </Menu></h1>
      <span role="status" className="studio-toolbar-status" title={storageHelp || undefined}>{statusBadge}</span>
    </div>
    {modeTabs('studio-mode-switch')}
    <div className="studio-toolbar-actions">{toolbarNotices}{localeMenu}
      {onSaveToFolder && <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={onSaveToFolder}><FolderOpen size={14} aria-hidden="true" /><span className="studio-action-label">{t('Save to folder')}</span></button>}
      {!host.capabilities.autosave && saveButton}
      {primaryActions.map(action => <button type="button" key={action.id} className="btn btn-outline btn-sm" disabled={locked || action.disabled} onClick={() => declaredAction(action)}>{action.label}</button>)}
      {previewToggle}
      <Menu className="studio-more-menu" label={t('More options')} triggerClassName="btn btn-ghost btn-sm btn-square" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
        {({ close }) => <>
          {host.capabilities.autosave && <button type="button" role="menuitem" disabled={locked || editor.conflict} onClick={() => { close(); editor.save(); }}><Save size={14} />{t('Save now')}</button>}
          <button type="button" role="menuitem" onClick={() => { close(); editor.setShowPreview(value => !value); }}>{editor.showPreview ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}{t(editor.showPreview ? 'Hide preview' : 'Show preview')}</button>
          {visibleActions.filter(action => action.intent !== 'primary').map(action => <button type="button" role="menuitem" key={action.id} disabled={locked || action.disabled} onClick={() => { close(); declaredAction(action); }}>{action.label}</button>)}
          {groups.length > 0 && <button type="button" role="menuitem" onClick={() => { close(false); versions.current?.scrollIntoView({ block: 'center' }); setHighlightVersions(true); }}><History size={14} />{t('Versions')}</button>}
          {host.capabilities.preview && state.availability.externalPreview && <><hr /><button type="button" role="menuitem" disabled={locked} onClick={() => { close(); share(true); }}>{t('Open preview')} ↗</button><button type="button" role="menuitem" disabled={locked} onClick={() => { close(); share(); }}>{t('Copy preview link')}</button></>}
          {moreMenu?.({ close })}
        </>}
      </Menu>
      {exportButtons}
    </div>
    {toolbarAlerts}
    {(editor.error || editor.conflict) && !exporting && <div className="toolbar-error studio-shell-error" role="alert"><div><span>{editor.error}</span>{editor.conflict && <p>{t('Saving stopped because the project changed elsewhere. Your edits are kept here. Export them before reloading.')}</p>}</div><div className="studio-shell-error-actions">{editor.conflict ? <>{(host.capabilities.sourceExport || host.capabilities.htmlExport) && <button className="btn btn-outline btn-sm" disabled={locked} onClick={() => setExporting({ format: host.capabilities.sourceExport ? 'source' : 'html', includeHistory: Boolean(host.conversations) })}>{t('Export retained edits')}</button>}<button className="btn btn-outline btn-sm" disabled={locked} onClick={() => openDialog('reload')}>{t('Reload saved project')}</button></> : <button className="btn btn-ghost btn-sm" onClick={() => editor.setError('')}>{t('Dismiss')}</button>}</div></div>}
  </div>;
  const previewNote = t(editor.conversationDraft ? 'Conversation draft · Project files unchanged' : editor.interactivePreview ? 'Interactive preview · JavaScript enabled' : 'Static preview · scripts are disabled');
  const pageCount = pages.length === 1 ? t('1 page') : t('{count} pages', { count: pages.length });
  return <StudioHostContext.Provider value={context}><div ref={root} className={`studio-root editor-root ${className}`}>
    {!isApp && <header className="hosted-heading">
      <div className="hosted-identity">
        <div className="hosted-title"><h1>{state.name}</h1><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label={t('Rename project')} title={t('Rename project')} disabled={locked} onClick={() => openDialog('project-name')}><Pencil size={16} /></button></div>
        <span className={`hosted-status ${dirty ? 'is-dirty' : ''}`} role={expanded ? undefined : 'status'}><span aria-hidden="true" />{status}</span>
        {description && <p className="hosted-description">{description}</p>}
      </div>
      <div className="hosted-actions">
        {actionButtons}
        <details className="hosted-more" ref={actionsMenu} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
          <summary className="btn btn-outline btn-square" aria-label={t('More actions')}><MoreHorizontal size={18} /></summary>
          <div className="hosted-more-menu" onClick={event => { if (event.target.closest('button')) actionsMenu.current.open = false; }}>
            {host.capabilities.preview && state.availability.externalPreview && <><button type="button" disabled={locked} onClick={() => share(true)}>{t('Open preview')} ↗</button><button type="button" disabled={locked} onClick={() => share()}>{t('Copy preview link')}</button></>}
            <button type="button" disabled={locked} onClick={() => setExporting({ format: 'source' })}><ArrowDownToLine size={14} />{t('Download project')}</button>
            {!isApp && !previewExpandButton && <button type="button" onClick={() => { actionsMenu.current?.querySelector('summary').focus(); setExpanded(true); }}><Maximize2 size={14} />{t('Expand editor')}</button>}
            {onNewProject && <button type="button" disabled={locked} onClick={() => newProjectCreatesCopy ? onNewProject() : openDialog('new')}><Plus size={14} />{t('New project')}</button>}
            {host.capabilities.preview && !state.availability.externalPreview && <p>{t('External preview is not configured. Inline preview is still available.')}</p>}
          </div>
        </details>
      </div>
    </header>}
    {editor.notice && <p className="notice" role="status">{editor.notice}</p>}{!isApp && editor.error && <div className="inline-error" role="alert"><span>{editor.error}</span><button className="btn btn-ghost btn-sm" onClick={() => editor.setError('')}>{t('Dismiss')}</button></div>}
    {!isApp && editor.conflict && <div className="hosted-callout" role="alert"><span>{t('Saving stopped because the project changed elsewhere. Your edits are kept here. Export them before reloading.')}</span><button className="btn btn-outline btn-sm" disabled={locked} onClick={() => openDialog('reload')}>{t('Reload saved project')}</button></div>}
    {shared && <div className="hosted-callout"><a href={shared.url} target="_blank" rel="noopener noreferrer">{t('Preview link')}</a>{shared.expiresAt && <span>{t('Expires')} {new Date(shared.expiresAt).toLocaleString(host.language)}</span>}<button className="btn btn-ghost btn-sm" disabled={locked} onClick={() => run(async signal => { await host.preview.revoke(shared, { signal }); setShared(null); })}>{t('Revoke')}</button></div>}
    {(issues.length > 0 || sourceIssues.length > 0) && <details className="hosted-diagnostics" open><summary>{t('Needs attention')} ({issues.length + sourceIssues.length})</summary><ul>{[...issues, ...sourceIssues].map((issue, index) => <li key={index}><button onClick={() => focusIssue(issue)}>{issue.locale && `${issue.locale.toUpperCase()} · ${issue.sectionLabel || issue.section} · ${issue.label} · `}{issue.message}</button></li>)}</ul></details>}
    <ResizableWorkspace ref={workspace} popover={!isApp && expanded ? 'manual' : undefined} role={!isApp && expanded ? 'dialog' : undefined} aria-modal={!isApp && expanded ? 'true' : undefined} contentInert={externalModalOpen} aria-label={t('Template editor')} className={`editor-shell ${isApp ? `is-app pane-${pane}` : expanded ? 'is-expanded' : 'is-compact'} ${conversationsAvailable && tab === 'ai' ? 'conversations-active' : ''} ${collapsed ? 'files-collapsed' : ''} ${!editor.showPreview ? 'preview-collapsed' : ''}`} onKeyDown={event => { if (isApp || !expanded || modalOpen) return; if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); } else trapFocus(event, workspace.current); }}>
      {isApp && appToolbar}
      {!isApp && expanded && <div className="studio-toolbar" ref={toolbar} tabIndex={-1}><strong>{state.name}</strong><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label={t('Rename project')} disabled={locked} onClick={() => openDialog('project-name')}><Pencil size={14} /></button>{projectSwitcher}{storageSummary && storageSummary !== status && <span className="studio-toolbar-storage">{storageSummary}</span>}<span role="status">{statusBadge}</span><div className="studio-toolbar-actions">{groups.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { if (isApp) { versions.current?.scrollIntoView({ block: 'center' }); setHighlightVersions(true); } else { jump.current = true; setExpanded(false); } }}><History size={14} />{t('Versions')}</button>}{onSaveToFolder && <button type="button" className="btn btn-outline btn-sm" disabled={locked} onClick={onSaveToFolder}><FolderOpen size={14} />{t('Save to folder')}</button>}{actionButtons}{exportButtons}{!isApp && <button className="btn btn-ghost btn-sm" aria-label={t('Collapse editor')} onClick={() => setExpanded(false)}><Minimize2 size={16} /></button>}</div>{editor.error && <div className="toolbar-error" role="alert"><span>{editor.error}</span>{editor.conflict && <button className="btn btn-outline btn-sm" disabled={locked} onClick={() => openDialog('reload')}>{t('Reload saved project')}</button>}</div>}</div>}
      <ProjectSidebar files={files} folders={state.folders} active={active} locked={locked} changedFiles={changedProjectFiles(files, editor.baseline)} aiPreview={Boolean(editor.aiDraft)} aiEnabled={aiEnabled} projectName={state.name} storageSummary={state.status !== status ? state.status : ''} storageHelp={storageHelp} showFooter={!isApp} savesToDisk={host.capabilities.autosave || host.capabilities.lifecycle} isCollapsed={collapsed} onToggleCollapsed={() => setCollapsed(value => !value)} onManageProjects={isApp ? undefined : onManageProjects} onSelect={openFile} onCreate={openDialog} onRename={() => openDialog('rename')} onDelete={() => openDialog('delete')} onDeleteFolder={path => openDialog('delete-folder', { type: 'folder', path })} onMove={(entry, folder) => { try { const { active: nextActive, ...next } = moveProjectEntry(state, entry, folder, active); mutate(next); setActive(nextActive); } catch (cause) { report(cause); } }} onUpload={upload} onExport={undefined} onOpenArchive={() => archive.current.click()} />
      <section className="author-panel">{!isApp && <div className="author-tabs">{modeTabs('author-tab-list')}<div className="author-tab-actions">{localeMenu}{previewToggle}</div></div>}
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={`author-content ${tab === 'files' ? 'source-content' : ''}`}>
          {tab === 'content' && <>{sections.length > 0 && <Tabs id={`${id}-sections`} className="hosted-sections" label={t('Sections')} value={shownSection?.id} onChange={setSection} items={sections.map(item => { const count = issues.filter(issue => issue.locale === locale && issue.section === item.id).length; return { id: item.id, label: item.label, badge: count > 0 ? <StatusBadge tone="warning">{t('{count} issues', { count })}</StatusBadge> : undefined }; })} />}{shownSection ? <fieldset disabled={locked} {...tabPanelProps(`${id}-sections`, shownSection.id)}><ParameterForm disabled={locked} sectionTitles={false} definition={{ ...analysis.definition, sections: [shownSection] }} values={values} files={files} projectImages={Object.keys(files).filter(path => /\.(?:png|jpe?g|webp|svg|gif|avif)$/i.test(path))} aiEnabled={aiEnabled} onSettings={openSettings} onImageUpload={uploadImage} errors={issues.filter(issue => issue.locale === locale)} onChange={next => mutate(previous => ({ translations: { ...previous.translations, [locale]: next } }))} /></fieldset> : <div className="empty-content-actions"><p>{t('This project has no editable fields.')}</p><p className="field-help">{t('Open the source files or ask the assistant to update the page.')}</p><div className="ai-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('files')}>{t('Open files')}</button>{aiEnabled && <button type="button" className="btn btn-primary btn-sm" onClick={() => { showAssistant(); }}><Sparkles size={14} />{t('Open AI assistant')}</button>}</div></div>}{shownSection && <div className="settings-actions"><Menu label={t('Content actions')} className="content-actions-menu" triggerClassName="btn btn-ghost btn-sm" trigger={<><MoreHorizontal size={14} aria-hidden="true" />{t('Content actions')}</>}>
            {({ close }) => <><button type="button" role="menuitem" disabled={locked} onClick={() => { close(); mutate({ translations: { ...state.translations, [locale]: {} } }); }}>{t('Reset defaults')}</button><button type="button" role="menuitem" disabled={locked} onClick={() => { close(); data.current.click(); }}>{t('Load JSON')}</button><button type="button" role="menuitem" onClick={() => { close(); downloadFile('trafficops-data.json', JSON.stringify(values, null, 2), 'application/json'); }}>{t('Save JSON')}</button></>}
          </Menu></div>}</>}
          {tab === 'files' && (typeof files[active] === 'string' && (!/\.svg$/i.test(active) || imageSource) ? <Suspense fallback={<div className="source-loading" role="status" aria-label={t('Opening editor…')}><LoaderCircle className="spin" size={24} aria-hidden="true" /></div>}><CodeEditor key={active} dialect={host.dialect} path={active} value={files[active]} files={files} onChange={value => mutate(previous => ({ files: { ...previous.files, [active]: value } }))} reveal={reveal?.path === active ? reveal : null} onOpenFile={openFile} onError={editor.setError} onEditWithAi={openFileAi} aiEditDisabled={!fileAiAvailability.supported} aiEditReason={fileAiAvailability.reason} readOnly={locked} /></Suspense> : <AssetPreview key={active} path={active} value={files[active]} onEditSource={typeof files[active] === 'string' ? () => setImageSource(true) : undefined} onEditWithAi={openFileAi} aiEditDisabled={locked || !fileAiAvailability.supported} aiEditReason={fileAiAvailability.reason} />)}
          {conversationsAvailable && <><div hidden={tab !== 'ai' || aiView !== 'assistant'} className="conversations-active">{host.conversations
            ? <ShellChat host={context} chatRef={chat} mounted={aiOpened} threadId={chatThreadId} onThreadChange={setChatThreadId} launch={chatLaunch} onLaunch={setChatLaunch} selectionStale={selectionStale} useOnPage={useOnPage} onUseOnPageChange={setUseOnPage} disabled={externalBusy || busy} onBlockSelectionBusyChange={setBlockSelectionBusy} previewRunId={editor.conversationDraft?.runId}
              chatContext={{ state, locale, sectionFrame: selectionStale || editor.conversationDraft ? null : selectionFrame, t, language: host.language, previewRunId: editor.conversationDraft?.runId, useOnPage, onSent: () => setUseOnPage(false),
                onApplyRun: editor.applyConversationDraft, onPreviewDraft: editor.previewConversationDraft, onKeepDraft: keepDraftInEditor, onOpenFile: openFile,
                onOpenSection: target => { setTab('content'); setPane('author'); if (target.kind === 'field') setSection(target.id.replace(/^field:/, '').split('.')[0]); } }}
              onSettings={openSettings} onCreateProject={text => { createPrompt.current = text; setDialog({ kind: 'ai-create' }); }} />
            : <InlineNotice tone="warning">{t('This host does not support persistent conversations.')}</InlineNotice>}</div>{tab === 'ai' && aiView === 'settings' && <AiSettings onBack={() => setAiView('assistant')} />}</>}
        </div>
      </section>
      {editor.showPreview && <PreviewPanel pages={pages} page={page} onPageChange={editor.setPreviewPage} onSetEntry={host.capabilities.entrypoint ? entrypoint => mutate({ entrypoint }) : undefined} entryDisabled={Boolean(editor.conversationDraft)} locked={locked} mobile={mobile} onMobileChange={setMobile} preview={editor.preview} error={editor.previewError} ready={Boolean(editor.preview)} interactive={editor.interactivePreview} paused={editor.previewPaused} updating={editor.previewBusy} onDisplayed={editor.previewDisplayed} onRefresh={refreshSelectionPreview} onTogglePaused={editor.togglePreviewPaused} selectionAvailable={aiEnabled && !editor.conversationDraft && Boolean(editor.preview?.selection)} selectionEnabled={selectionEnabled} onSelectionEnabledChange={setSelectionEnabled} selectedBlocks={selectedBlocks} selectionLocked={locked || blockSelectionBusy} selectionStale={selectionStale} onSelectionChange={selectionChanged} onSelectionDocumentChange={selectionDocumentChanged} onEditSelected={editSelectedBlocks} {...(previewExpandButton && !isApp && !expanded ? { expanded: false, onToggleExpanded: () => setExpanded(true) } : {})} note={previewNote} showBottom={!isApp} />}
      {isApp && <footer className="studio-statusbar"><span className="studio-statusbar-location" title={storageHelp || undefined}><ShieldCheck size={13} aria-hidden="true" />{storageSummary || storageHelp || state.status}</span><span className="studio-statusbar-save" role="status" title={storageHelp || undefined}>{saveBadge}</span>{editor.showPreview && <span className={`studio-statusbar-preview ${editor.previewPaused || editor.previewBusy || editor.conversationDraft || editor.previewError ? 'is-important' : ''}`}>{editor.previewError || (editor.previewPaused ? t('Automatic preview paused') : editor.previewBusy ? t('Updating preview…') : previewNote)}</span>}<span className="studio-statusbar-pages">{pageCount}</span></footer>}
      {isApp && <nav className="studio-pane-switch" aria-label={t('Workspace panels')}>{[['files', t('Files'), FilesIcon], ['author', t('Edit'), SquarePen], ...(editor.showPreview ? [['preview', t('Preview'), Eye]] : [])].map(([key, label, Icon]) => <button type="button" key={key} aria-pressed={pane === key} onClick={() => setPane(key)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}</nav>}
      {dialog?.kind === 'ai-create' && <ConfirmDialog t={t} title={t('Generate a new project?')} description={t('Replaces every file in the project.')} confirmLabel={t('Create a new project')} danger
        onClose={closeDialog} onConfirm={() => { closeDialog(); createProjectWithAi().catch(report); }} />}
      {dialog && dialog.kind !== 'ai-create' && <Modal title={titles[dialog.kind]} onClose={closeDialog} onSubmit={submitDialog} confirmLabel={dialog.kind === 'action' && dialog.descriptor.input ? dialog.descriptor.label : t(['delete', 'delete-folder'].includes(dialog.kind) ? 'Delete' : 'Apply')} confirmFirst={!dialog.descriptor?.input && ['delete', 'delete-folder', 'remove-language', 'reload', 'new', 'action'].includes(dialog.kind)} busy={busy}>
        {!['delete', 'delete-folder', 'remove-language', 'reload', 'new', 'action'].includes(dialog.kind) && (dialog.kind === 'project-name' ? <input className="input w-full" aria-label={t('Project name')} value={dialogValue} maxLength={120} required onChange={event => setDialogValue(event.target.value)} /> : dialog.kind === 'language' ? <input className="input w-full" aria-label={t('Language code')} value={dialogValue} onChange={event => setDialogValue(event.target.value)} placeholder="en, ru, uk" /> : <PathInput value={dialogValue} onChange={setDialogValue} folders={projectFolders(files, state.folders)} label={t('Path')} />)}
        {['delete', 'delete-folder'].includes(dialog.kind) && <p>{dialog.descriptor.path}</p>}{dialog.kind === 'delete-folder' && <p className="field-help">{t('This deletes the folder and all files and subfolders inside it. References in other files are not updated.')}</p>}{dialog.kind === 'remove-language' && <p>{locale.toUpperCase()}</p>}{dialog.kind === 'rename' && <p className="field-help">{t('Renaming does not update references in other files.')}</p>}{dialog.kind === 'new' && <p>{t('This replaces all files in the current project. Export your work first if you want to keep it.')}</p>}{dialog.kind === 'reload' && <p>{t('Reloading discards the edits shown here and opens the last saved project.')}</p>}{dialog.kind === 'action' && <>{dialog.descriptor.confirmation && <p>{dialog.descriptor.confirmation}</p>}{dialog.descriptor.input && <label className="field"><span>{dialog.descriptor.input.label}</span><input className="input w-full" aria-label={dialog.descriptor.input.label} value={dialogValue} maxLength={dialog.descriptor.input.maxLength} required disabled={busy} onChange={event => setDialogValue(event.target.value)} />{dialog.descriptor.input.help && <small className="field-help">{dialog.descriptor.input.help}</small>}</label>}</>}{dialogError && <p role="alert" className="inline-error">{dialogError}</p>}
      </Modal>}
      {exporting && <Modal title={t('Export')} onClose={() => setExporting(null)} onSubmit={exportZip} confirmLabel={t('Download')} busy={busy}><h3 className="export-format">{t(exporting.format === 'source' ? 'Editable project' : 'Landing for hosting')}</h3><p className="export-purpose">{t(exporting.format === 'source' ? 'Backup or reopen this editable project in Studio.' : 'Extract this archive and upload its files to your hosting.')}</p>{exporting.format === 'source' && host.conversations && <label className="export-history-option"><input type="checkbox" checked={exporting.includeHistory !== false} disabled={busy} onChange={event => setExporting({ ...exporting, includeHistory: event.target.checked })} /><span>{t('Include conversation history')}</span></label>}<p className="field-help">{locale.toUpperCase()} · {exporting.history ? t('Saved version') : t('Current edits')}</p>{exporting.format === 'html' && host.capabilities.preview && <label className="field"><span>{t('Continue URL')}</span><input className="input w-full" value={continueUrl} onChange={event => setContinueUrl(event.target.value)} placeholder="https://…" /><small>{t('Used by the continue link in the exported page.')}</small></label>}{editor.error && <p className="inline-error" role="alert">{editor.error}</p>}</Modal>}
    </ResizableWorkspace>
    {showExportFooter && !isApp && <div className="workspace-footer"><span>{status}</span>{host.capabilities.htmlExport && <button className="btn btn-primary" disabled={locked} onClick={() => setExporting({ format: 'html' })}><ArrowDownToLine size={15} />{t('Download landing')}</button>}</div>}
    {groups.length > 0 && <div ref={versions}><VersionsPanel title={t('Versions')} description={historyDescription} groups={groups} group={historyGroup} onGroupChange={setHistoryGroup} highlighted={highlightVersions} onDismissHighlight={() => setHighlightVersions(false)} actions={state.actions.filter(action => action.intent === 'danger').map(action => <button key={action.id} className="btn btn-ghost btn-sm" disabled={locked || action.disabled} onClick={() => declaredAction(action)}>{action.label}</button>)} /></div>}
    <input ref={archive} type="file" accept=".zip,application/zip" aria-label={t('Open template ZIP')} hidden onChange={event => { importArchive(event.target.files[0]); event.target.value = ''; }} />
    <input ref={data} type="file" accept=".json,application/json" aria-label={t('Load parameter JSON')} hidden onChange={async event => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; try { const next = JSON.parse(await file.text()); if (!next || Array.isArray(next) || typeof next !== 'object') throw new Error(t('Parameter data must be a JSON object.')); mutate({ translations: { ...state.translations, [locale]: next } }); } catch (cause) { report(cause); } }} />
  </div></StudioHostContext.Provider>;
}

// Чат вкладки AI: порт над сессией разговоров хоста, StudioChat грузится лениво при первом открытии вкладки.
function ShellChat({ host, chatRef, mounted, threadId, onThreadChange, launch, onLaunch, disabled, chatContext, onSettings, onCreateProject, onBlockSelectionBusyChange, previewRunId, selectionStale, useOnPage, onUseOnPageChange }) {
  const t = chatContext.t, ui = useStudioUi();
  const [aiSettings, setAiSettings] = useState(null), [composerScope, setComposerScope] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => host.ai?.settings.load().then(value => { if (alive) setAiSettings(value); }).catch(() => { if (alive) setAiSettings(null); });
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; window.removeEventListener('trafficops-ai-settings', load); };
  }, [host.ai]);
  const chat = useChatPort(host, { ...chatContext, settings: aiSettings });
  chatRef.current = chat;
  useEffect(() => () => { if (chatRef.current === chat) chatRef.current = null; }, [chat, chatRef]);
  // Пока ран с областью «Блок» активен или его черновик в превью, выделение в превью заблокировано (как раньше в ConversationPanel).
  const session = useMemo(() => getConversationSession(host), [host]);
  const document = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const blockBusy = document.runs.some(run => run.scope?.kind === 'block' && (activeRunStates.has(run.state) || run.id === previewRunId));
  useEffect(() => { onBlockSelectionBusyChange(blockBusy); return () => onBlockSelectionBusyChange(false); }, [blockBusy, onBlockSelectionBusyChange]);
  // Выбор диалога: если его последний ран блочный и работает или ждёт уточнения, композер получает область этого рана.
  const selectThread = useCallback(id => {
    onThreadChange(id);
    const run = id ? session.getSnapshot().runs.filter(item => item.threadId === id).at(-1) : null, draft = run?.result || run?.checkpoint;
    if (run?.scope?.kind === 'block' && run.scope.editScope && (activeRunStates.has(run.state) || (run.state === 'failed' && draft?.needsClarification))) {
      const key = JSON.stringify(run.scope.editScope.targets ?? run.id);
      chat.registerBlockScope(key, run.scope.editScope);
      onLaunch({ id: crypto.randomUUID(), scope: { kind: 'block', targetId: key }, mentions: [], editScope: run.scope.editScope });
    }
  }, [chat, onLaunch, onThreadChange, session]);
  // Редактор открывается на последнем неархивном диалоге сессии (как прежняя панель), если диалог ещё не выбран.
  const decided = useRef(false); if (threadId !== null) decided.current = true;
  useEffect(() => {
    let alive = true;
    session.ready.then(() => {
      if (!alive || decided.current) return;
      decided.current = true;
      const latest = session.getSnapshot().threads.filter(item => !item.archived).at(-1);
      if (latest) selectThread(latest.id);
    }).catch(() => {});
    return () => { alive = false; };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  // Панель «Selected blocks»: область последнего незавершённого блочного рана диалога, иначе — до первой отправки — область
  // запуска «Edit selected», пока композер её держит (снятый чип Block скрывает панель, onScopeChange).
  const threadRuns = threadId ? document.runs.filter(run => run.threadId === threadId) : [], latestRun = threadRuns.at(-1);
  const blockScope = latestRun?.scope?.kind === 'block' && !['applied', 'discarded'].includes(latestRun.state) ? latestRun.scope.editScope
    : !latestRun ? launchBlockScope(launch, composerScope) : null;
  const scopeChanged = useCallback(scope => setComposerScope({ launchId: launch?.id, scope }), [launch?.id]);
  // Live preview of the open conversation's latest run (chat-live-preview.js).
  const livePreviewRun = useRef(''), onPreviewDraft = chatContext.onPreviewDraft;
  useEffect(() => {
    const next = liveDraftPreview(latestRun, livePreviewRun.current);
    if (next.kind === 'show') { livePreviewRun.current = next.runId; onPreviewDraft?.(next.draft); }
    else if (next.kind === 'clear') { if (previewRunId === livePreviewRun.current) onPreviewDraft?.(null); livePreviewRun.current = ''; }
  }, [latestRun?.id, latestRun?.state, latestRun?.checkpoint, latestRun?.result]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasDraft = Boolean(latestRun?.result || latestRun?.checkpoint), { state, locale } = chatContext;
  const blockScopeStale = Boolean(blockScope && ((selectionStale && !hasDraft) || (blockScope.locale && blockScope.locale !== locale)
    || !blockScopeBaseMatches(blockScope, { files: state.files, rawValues: state.translations?.[locale] || {} })));
  const actions = [{ id: 'create', label: t('Create a new project'), danger: true, onSelect: ({ text }) => onCreateProject(text) }, { id: 'settings', label: t('AI settings'), onSelect: onSettings }];
  // The page-image option only matters while images are attached; the connection card replaces the composer until AI is set up.
  const footer = ({ attachments = [] }) => <>{previewRunId && <div className="ai-preview-exit" role="status"><span>{t('The preview shows this conversation’s draft. Your project files are unchanged.')}</span><Button variant="ghost" size="sm" onClick={() => chatContext.onPreviewDraft?.(null)}>{t('Show current project')}</Button></div>}
    {blockScope && <BlockScopePanel scope={blockScope} stale={blockScopeStale} t={t} />}
    {(useOnPage || attachments.some(file => file.type?.startsWith('image/'))) && <label className="ai-use-on-page"><input type="checkbox" className="checkbox checkbox-xs" checked={useOnPage} onChange={event => onUseOnPageChange(event.target.checked)} />{t('Use attached images on the page')}</label>}
    <small className="conversation-disclosure">{t('Messages and referenced files are sent to your selected AI provider. Review changes before applying.')}</small></>;
  const setup = aiSettings && !aiSettings.configured && <InlineNotice tone="info" className="ai-setup-card" title={host.ai.settings.owner === 'user' ? t('Set up OpenRouter') : undefined} actions={<Button variant="primary" size="sm" onClick={onSettings}>{t(host.ai.settings.owner === 'user' ? 'Connect OpenRouter' : 'AI settings')}</Button>}>{host.ai.settings.owner === 'user' ? t('Add your OpenRouter API key and choose a text model. Save the connection to start chatting without reloading Studio.') : t('Connect your key in Settings to start.')}</InlineNotice>;
  if (!mounted) return null;
  // StudioUiProvider внешнего хоста (portalContainer embed) сохраняется; иначе язык и перекрытия берутся из хоста.
  return <StudioUiProvider language={ui?.language ?? host.language} messages={ui?.messages ?? host.messages} portalContainer={ui?.portalContainer}>
    <Suspense fallback={<div className="studio-chat-loading" aria-busy="true" aria-label={t('Loading conversations…')}><Skeleton shape="block" height="100%" /><div><Skeleton shape="line" width="40%" /><Skeleton shape="block" /><Skeleton shape="block" height={96} /></div></div>}>
      <StudioChat port={chat.port} threadId={threadId || ''} onThreadChange={selectThread} onScopeChange={scopeChanged} launch={launch} disabled={disabled} actions={actions} footer={footer} setup={setup} />
    </Suspense>
  </StudioUiProvider>;
}

// Замороженное выделение блоков (разметка прежней ConversationPanel): подписи экземпляров, охват шаблонных правок, устаревшее выделение.
function BlockScopePanel({ scope, stale, t }) {
  const instances = scope.blockInstances || [], sources = scope.intent === 'content' ? [] : blockScopeSourceTargets(scope);
  return <div className="ai-block-scope" role="group" aria-label={t('Selected blocks')}><strong>{t('Editing selected blocks')}</strong>
    <ul>{(scope.selectedInstanceIds || []).map(id => <li key={id}>{instances.find(block => block.id === id)?.label || id}</li>)}</ul>
    <p className="field-help">{t('Describe a template change or content for the selected instance. Shared fields outside your selection are protected.')}</p>
    {scope.intent && <p className="field-help" role="status">{scope.intent === 'content' ? t('Content changes affect only the selected instances.') : t('Template changes affect all {count} instances of these source blocks.', { count: instances.filter(instance => sources.some(source => source.id === instance.sourceId)).length })}</p>}
    {stale && <p className="inline-error" role="alert">{t('The selected preview is outdated. Refresh preview and select the blocks again.')}</p>}
  </div>;
}
