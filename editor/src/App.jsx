import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, Code2, FileImage, FolderOpen, FolderPlus, HelpCircle, LoaderCircle, Maximize2, Minimize2, Monitor, PanelRightClose, PanelRightOpen, Plus, RefreshCw, RotateCcw, Settings2, Sparkles, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { byteSize, createZip, downloadFile, isTemplate, isText, LIMITS, projectFolders, renameFile, safePath, validateFolders, validateProject } from './project.js';
import { chooseProjectDirectory, ensureProjectPermission, forgetDirectoryProject, listDirectoryProjects, projectSnapshotEqual, readDirectoryProject, readProjectSettings, rememberDirectoryProject, supportsDirectoryProjects, syncDirectoryProject, writeProjectSettings } from './directory-projects.js';
import { buildPreview } from './preview.js';
import { starterProject } from './starter.js';
import ParameterForm from './ParameterForm.jsx';
import ProjectSidebar from './ProjectSidebar.jsx';
import PathInput from './PathInput.jsx';
import { normalizeEditorCapabilities } from './capabilities.js';
import { installedDisplayMode, watchDisplayMode } from './app-mode.js';
import { loadWorkspace, saveWorkspace } from './workspace-storage.js';
import SettingsPage from './SettingsPage.jsx';
import { changedProjectFiles } from './project-changes.js';
import ProjectSwitcher, { projectLocation } from './ProjectSwitcher.jsx';
import { updateProjectLocation } from './directory-projects.js';

const CodeEditor = lazy(() => import('./CodeEditor.jsx'));
const message = error => error instanceof Error ? error.message : String(error);
const settingsEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function FileDialog({ operation, active, folders, onClose, onSubmit }) {
  const [value, setValue] = useState(operation === 'rename' ? active : '');
  const [error, setError] = useState('');
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  const title = operation === 'add-file' ? 'Create a file' : operation === 'add-folder' ? 'Create a folder' : operation === 'rename' ? 'Rename file' : operation === 'remove' ? 'Delete this file?' : 'Start a new project?';
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="dialog-title" onCancel={onClose}><form className="modal-box" onSubmit={async event => { event.preventDefault(); try { await onSubmit(value); onClose(); } catch (cause) { setError(message(cause)); } }}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
    {['add-file', 'add-folder', 'rename'].includes(operation) ? <><PathInput value={value} onChange={setValue} folders={folders} label={operation === 'add-folder' ? 'Folder path' : 'File path'} placeholder={operation === 'add-folder' ? 'images/gallery' : 'pages/about.tpl'} /><p className="field-help">{operation === 'add-folder' ? 'Nested folders are supported. Use a relative path without spaces.' : operation === 'rename' ? 'Renaming does not update references in other files.' : 'Include the filename and extension, for example blocks/header.tpl.'}</p></> : <p className="muted">{operation === 'remove' ? <><strong>{active}</strong> will be removed from this project.</> : 'Your current work will be replaced. Download the template ZIP first to keep it.'}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-action"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className={`btn ${operation === 'remove' ? 'btn-neutral' : 'btn-primary'}`} type="submit">{operation === 'remove' ? 'Delete file' : operation === 'reset' ? 'Create project' : operation === 'add-folder' ? 'Create folder' : operation === 'add-file' ? 'Create file' : 'Rename file'}</button></div>
  </form><button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={onClose} /></dialog>;
}

function TourDialog({ onClose }) {
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="tour-title" onCancel={onClose}><div className="modal-box tour-modal"><div className="dialog-heading"><div><span className="section-kicker">QUICK START</span><h2 id="tour-title">From template to finished pages</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close quick start" onClick={onClose}><X size={18} /></button></div><ol className="tour-steps"><li><span>1</span><div><strong>Add your project</strong><p>Connect a project folder for automatic disk saves, or open a template ZIP.</p></div></li><li><span>2</span><div><strong>Build the template</strong><p>Edit TPL, CSS, and other source files. Changes in Customize update the preview live.</p></div></li><li><span>3</span><div><strong>Choose images</strong><p>Image parameters can use existing project assets or files dropped from your computer.</p></div></li><li><span>4</span><div><strong>Take it with you</strong><p>Download generated pages. Folder projects keep source and uploads on your disk.</p></div></li></ol><div className="tour-note"><ShieldCheck size={16} /><span>The core editor is local. Optional BYOK AI sends only the data disclosed in its panel to OpenRouter.</span></div><div className="modal-action"><a className="btn btn-ghost" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Read full docs ↗</a><button type="button" className="btn btn-primary" onClick={onClose}>Start creating</button></div></div><button type="button" className="modal-backdrop" aria-label="Close quick start" onClick={onClose} /></dialog>;
}

function ProjectsDialog({ projects, currentId, supported, busy, onAdd, onOpen, onForget, onReload, onLocation, onClose }) {
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="projects-title" onCancel={onClose}><div className="modal-box projects-modal"><div className="dialog-heading"><div><span className="section-kicker">LOCAL WORKSPACES</span><h2 id="projects-title">Project folders</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close projects" onClick={onClose}><X size={18} /></button></div>
    <p className="muted projects-intro">Each project is one folder on your computer. Edits save automatically. Browsers reveal the folder name only; enter an optional full path label to distinguish folders. This label does not change the connected folder.</p>
    {!supported && <div className="project-support-note"><strong>Folder editing is unavailable in this browser.</strong><span>Use Chrome or Edge for read/write folders. ZIP import and export continue to work here.</span></div>}
    <div className="project-list">{projects.length ? projects.map(project => <div className={`project-list-row ${project.id === currentId ? 'current' : ''}`} key={project.id}><button type="button" className="project-open" disabled={busy || !supported} onClick={() => onOpen(project)}><FolderOpen size={18} /><span><strong>{project.name}</strong><small>{projectLocation(project)}</small></span></button><label className="project-path-field"><span className="field-help">Folder path label</span><input aria-label={`Folder path for ${project.name}`} className="input input-sm" defaultValue={project.displayPath || ''} placeholder={`${project.name}/`} onBlur={event => onLocation(project, event.target.value)} /></label><div className="project-row-actions">{project.id === currentId && <button type="button" className="btn btn-ghost btn-xs btn-square" disabled={busy} title="Reload from disk" aria-label={`Reload ${project.name} from disk`} onClick={() => onReload(project)}><RefreshCw size={14} /></button>}<button type="button" className="btn btn-ghost btn-xs btn-square" disabled={busy || project.id === currentId} title="Forget folder" aria-label={`Forget ${project.name}`} onClick={() => onForget(project)}><Trash2 size={14} /></button></div></div>) : <div className="project-list-empty"><FolderOpen size={24} /><span>No project folders yet.</span></div>}</div>
    <div className="modal-action"><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button><button type="button" className="btn btn-primary" disabled={!supported || busy} onClick={onAdd}>{busy ? <LoaderCircle size={16} className="spin" /> : <FolderPlus size={16} />} Add project folder</button></div>
  </div><button type="button" className="modal-backdrop" aria-label="Close projects" onClick={onClose} /></dialog>;
}

function PreviewPanel({ ready, mobile, onMobileChange, shownPage, pageNames, onPageChange, preview, error }) {
  return <section id="preview-panel" className="preview-panel" aria-label="Live preview">
    <div className="preview-toolbar"><div className="preview-label"><span className={ready ? 'status-dot' : 'status-dot pending'} /><span>LIVE PREVIEW</span></div><div className="device-tabs" aria-label="Preview size"><button title="Desktop preview" aria-label="Desktop preview" aria-pressed={!mobile} className={!mobile ? 'selected' : ''} onClick={() => onMobileChange(false)}><Monitor size={16} /></button><button title="Mobile preview" aria-label="Mobile preview" aria-pressed={mobile} className={mobile ? 'selected' : ''} onClick={() => onMobileChange(true)}><Smartphone size={15} /></button></div><label className="page-select"><select aria-label="Preview page" value={shownPage || ''} disabled={!pageNames.length} onChange={event => onPageChange(event.target.value)}>{pageNames.length ? pageNames.map(name => <option key={name}>{name}</option>) : <option value="">No pages</option>}</select><ChevronDown size={12} /></label></div>
    <div className={`preview-stage ${mobile ? 'mobile-preview' : ''}`}>{preview ? <div className="browser-frame"><div className="browser-chrome"><span /><span /><span /><div>{shownPage}</div><ShieldCheck size={12} /></div><iframe key={preview.revision} title="Generated page preview" srcDoc={preview.html} sandbox="" referrerPolicy="no-referrer" /></div> : <div className="empty-preview"><Code2 size={30} /><h3>A page is taking shape.</h3><p>{error || 'Add a .tpl file with an @layout block to get started.'}</p></div>}</div>
    <div className="preview-bottom"><span><ShieldCheck size={13} /> Static preview · local assets only</span><span>{pageNames.length} {pageNames.length === 1 ? 'page' : 'pages'}</span></div>
  </section>;
}

export default function App({ capabilities: requestedCapabilities = {} }) {
  const capabilities = useMemo(() => normalizeEditorCapabilities(requestedCapabilities), [requestedCapabilities]);
  const [installedMode, setInstalledMode] = useState(installedDisplayMode);
  const AiPanel = installedMode ? capabilities.ai?.Panel : null;

  const [files, setFiles] = useState(starterProject);
  const [sourceBaseline, setSourceBaseline] = useState(starterProject);
  const [folders, setFolders] = useState(['images']);
  const [active, setActive] = useState('index.tpl');
  const [reveal, setReveal] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [tab, setTab] = useState('settings');
  const [previewPage, setPreviewPage] = useState('index.html');
  const [workspaceExpanded, setWorkspaceExpanded] = useState(installedDisplayMode);
  const [filesCollapsed, setFilesCollapsed] = useState(() => !installedDisplayMode());
  const [expandedPreviewVisible, setExpandedPreviewVisible] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [directoryProjects, setDirectoryProjects] = useState([]);
  const [attachedProject, setAttachedProject] = useState(null);
  const [saveState, setSaveState] = useState('session');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pwaUpdate, setPwaUpdate] = useState(null);
  const [settingsPage, setSettingsPage] = useState(() => location.hash === '#settings');
  const [recoveryState, setRecoveryState] = useState('pending');
  const recoveryRevision = useRef(0);
  const [hydrated, setHydrated] = useState(() => !installedDisplayMode());
  const [projectEpoch, setProjectEpoch] = useState(0);
  const [sessionName, setSessionName] = useState('Untitled project');
  const [reconnectProject, setReconnectProject] = useState(null);
  const [aiDraft, setAiDraft] = useState(null), [aiWorking, setAiWorking] = useState(false);
  const aiLocked = aiWorking || Boolean(aiDraft);
  const aiLockedRef = useRef(aiLocked); aiLockedRef.current = aiLocked;
  const workspaceFiles = aiDraft?.files || files;
  const workspaceOverrides = aiDraft?.values || overrides;
  const changedFiles = useMemo(() => changedProjectFiles(workspaceFiles, aiDraft ? files : sourceBaseline), [workspaceFiles, aiDraft, files, sourceBaseline]);
  const restoration = useRef(false);
  const recoveryQueue = useRef(Promise.resolve());
  const archiveInput = useRef(null), dataInput = useRef(null), importWorker = useRef(null), compactTab = useRef('settings');
  const filesRef = useRef(files), foldersRef = useRef(folders), overridesRef = useRef(overrides), dirtyRef = useRef(dirty), attachedProjectRef = useRef(attachedProject);
  const savedProjectRef = useRef(null), savedSettingsRef = useRef({}), autoSaveTimer = useRef(null), saveQueue = useRef(Promise.resolve());
  const deferredFiles = useDeferredValue(workspaceFiles);
  const parsed = useMemo(() => { try { return { project: parseProject(deferredFiles) }; } catch (cause) { return { error: message(cause) }; } }, [deferredFiles]);
  const definition = parsed.project?.definition;
  const values = useMemo(() => {
    if (!definition) return {};
    const defaults = getDefaults(definition);
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, Object.hasOwn(workspaceOverrides, key) ? workspaceOverrides[key] : value]));
  }, [definition, workspaceOverrides]);
  const deferredValues = useDeferredValue(values);
  const generated = useMemo(() => {
    if (!definition) return { error: parsed.error };
    try { return { files: generateProject(deferredFiles, deferredValues) }; } catch (cause) { return { error: message(cause) }; }
  }, [definition, deferredFiles, deferredValues, parsed.error]);
  const pageNames = useMemo(() => generated.files ? Object.keys(generated.files).filter(name => /\.html?$/i.test(name)).sort() : [], [generated.files]);
  const shownPage = pageNames.includes(previewPage) ? previewPage : pageNames[0];
  const names = Object.keys(workspaceFiles).sort((a, b) => a.localeCompare(b));
  const activeValue = workspaceFiles[active];
  const ready = !generated.error && deferredFiles === workspaceFiles && deferredValues === values;

  useEffect(() => { filesRef.current = files; foldersRef.current = folders; overridesRef.current = overrides; dirtyRef.current = dirty; attachedProjectRef.current = attachedProject; }, [files, folders, overrides, dirty, attachedProject]);
  useEffect(() => watchDisplayMode(setInstalledMode), []);
  useEffect(() => { if (installedMode) { setWorkspaceExpanded(true); setFilesCollapsed(window.matchMedia('(max-width: 640px)').matches); } }, [installedMode]);
  useEffect(() => { const update = () => setSettingsPage(location.hash === '#settings'); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => {
    if (!installedMode || restoration.current) return;
    restoration.current = true;
    setHydrated(false);
    (async () => {
      const [projects, workspace] = await Promise.all([listDirectoryProjects(), loadWorkspace()]);
      setDirectoryProjects(projects);
      if (workspace?.files) {
        validateProject(workspace.files);
        replaceProject(workspace.files, workspace.folders, { settings: workspace.overrides || {} });
        setSourceBaseline(workspace.sourceBaseline || workspace.files);
        setSessionName(workspace.name || 'Untitled project');
        setDirty(Boolean(workspace.dirty));
        if (workspace.active && Object.hasOwn(workspace.files, workspace.active)) setActive(workspace.active);
      }
      const project = workspace?.projectId ? projects.find(item => item.id === workspace.projectId) : workspace ? null : projects[0];
      if (project) {
        if (await ensureProjectPermission(project.handle, { request: false })) {
          const snapshot = await readDirectoryProject(project.handle);
          const diskSettings = await readProjectSettings(project.handle);
          const sameRecovery = workspace?.files && projectSnapshotEqual(
            { files: workspace.files, folders: projectFolders(workspace.files, workspace.folders || []) },
            { files: snapshot.files, folders: projectFolders(snapshot.files, snapshot.folders) },
          ) && settingsEqual(workspace.overrides || {}, diskSettings);
          if (Object.keys(snapshot.files).length && (!workspace?.dirty || sameRecovery)) replaceProject(snapshot.files, snapshot.folders, { project, settings: diskSettings });
          else setReconnectProject(project);
        } else setReconnectProject(project);
      }
    })().catch(cause => setError(`Could not restore the last project: ${message(cause)}`)).finally(() => setHydrated(true));
  }, [installedMode]);
  useEffect(() => {
    if (!installedMode || !hydrated) return;
    const snapshot = { files, sourceBaseline, folders, overrides, active, name: attachedProject?.name || sessionName, projectId: attachedProject?.id || reconnectProject?.id || null, dirty: (attachedProject || reconnectProject) ? dirty : false };
    const revision = ++recoveryRevision.current;
    setRecoveryState('saving');
    const timer = setTimeout(() => {
      recoveryQueue.current = recoveryQueue.current.catch(() => {}).then(() => saveWorkspace(snapshot)).then(() => { if (revision === recoveryRevision.current) setRecoveryState('saved'); }).catch(cause => { setRecoveryState('error'); setError(`Device recovery could not be saved: ${message(cause)}`); });
    }, 300);
    return () => clearTimeout(timer);
  }, [installedMode, hydrated, files, folders, overrides, active, attachedProject, reconnectProject, sessionName, dirty, sourceBaseline]);
  useEffect(() => {
    const captureInstall = event => { event.preventDefault(); setInstallPrompt(event); };
    const installed = () => setInstallPrompt(null);
    const updateReady = event => setPwaUpdate(() => event.detail.update);
    const offlineReady = () => setNotice('Studio is ready to work offline.');
    window.addEventListener('beforeinstallprompt', captureInstall);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('trafficops-pwa-update', updateReady);
    window.addEventListener('trafficops-pwa-offline-ready', offlineReady);
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstall);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('trafficops-pwa-update', updateReady);
      window.removeEventListener('trafficops-pwa-offline-ready', offlineReady);
    };
  }, []);
  useEffect(() => {
    if (!generated.files || !shownPage) { setPreview(null); return; }
    try {
      const result = buildPreview(generated.files, shownPage);
      // A fresh frame prevents an earlier srcdoc navigation winning a race
      // against restored project values during the installed app's launch.
      setPreview(previous => previous?.html === result.html ? previous : { html: result.html, revision: (previous?.revision || 0) + 1 });
      return result.dispose;
    } catch (cause) { setError(message(cause)); setPreview(null); }
  }, [generated.files, shownPage]);
  useEffect(() => {
    if (!aiLocked && (!dirty || (installedMode && !attachedProject && recoveryState === 'saved'))) return;
    const handler = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, aiLocked, installedMode, attachedProject, recoveryState]);
  useEffect(() => {
    const save = event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (aiLockedRef.current) return;
      if (attachedProjectRef.current) flushDirectoryProject().catch(() => {});
      else {
        try {
          downloadFile('trafficops-template.zip', createZip(filesRef.current, { directories: foldersRef.current, settings: overridesRef.current }));
          if (!attachedProjectRef.current) { setDirty(false); setSourceBaseline(filesRef.current); }
          setNotice('Template ZIP downloaded.');
        } catch (cause) { setError(message(cause)); }
      }
    };
    window.addEventListener('keydown', save);
    return () => window.removeEventListener('keydown', save);
  }, []);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timeout); }, [notice]);
  useEffect(() => () => importWorker.current?.terminate(), []);
  useEffect(() => {
    if (!workspaceExpanded) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [workspaceExpanded]);

  useEffect(() => {
    const project = attachedProject;
    const previous = savedProjectRef.current;
    const settingsChanged = !settingsEqual(savedSettingsRef.current, overrides);
    if (!project || !previous || (projectSnapshotEqual(previous, { files, folders }) && !settingsChanged)) return undefined;
    setSaveState('pending');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { queueDirectorySave(project, files, folders, overrides).catch(() => {}); }, 650);
    return () => clearTimeout(autoSaveTimer.current);
  }, [files, folders, overrides, attachedProject]);

  function replaceProject(next, nextFolders = [], { project = null, settings = {} } = {}) {
    filesRef.current = next; foldersRef.current = nextFolders; overridesRef.current = settings; dirtyRef.current = false; attachedProjectRef.current = project;
    setReconnectProject(null); setAiDraft(null); setProjectEpoch(value => value + 1);
    setSourceBaseline(next);
    setFiles(next); setActive(Object.keys(next).find(name => isTemplate(name)) || Object.keys(next)[0]);
    const validFolders = validateFolders(next, nextFolders);
    setFolders(validFolders); setOverrides(settings); setError(''); setDirty(false); setPreviewPage('index.html');
    setAttachedProject(project);
    savedProjectRef.current = project ? { files: { ...next }, folders: [...validFolders] } : null;
    savedSettingsRef.current = project ? { ...settings } : {};
    setSaveState(project ? 'saved' : 'session');
  }

  function queueDirectorySave(project, nextFiles, nextFolders, nextSettings) {
    const requested = { files: { ...nextFiles }, folders: [...nextFolders] };
    const settings = { ...nextSettings };
    const operation = saveQueue.current.catch(() => {}).then(async () => {
      if (attachedProjectRef.current?.id !== project.id) return;
      setSaveState('saving');
      const previous = savedProjectRef.current;
      const settingsChanged = !settingsEqual(savedSettingsRef.current, settings);
      if (settingsChanged && !settingsEqual(await readProjectSettings(project.handle), savedSettingsRef.current)) throw new Error('Project values changed outside Studio. Export your work, then reload the folder.');
      const saved = await syncDirectoryProject(project.handle, previous, requested);
      savedProjectRef.current = saved;
      setSourceBaseline(saved.files);
      if (settingsChanged) await writeProjectSettings(project.handle, settings);
      if (attachedProjectRef.current?.id !== project.id) return;
      savedProjectRef.current = saved;
      savedSettingsRef.current = settings;
      const current = { files: filesRef.current, folders: foldersRef.current };
      if (projectSnapshotEqual(saved, current) && settingsEqual(settings, overridesRef.current)) {
        setDirty(false);
        setSaveState('saved');
      } else {
        setSaveState('pending');
      }
    }).catch(cause => {
      if (attachedProjectRef.current?.id === project.id) {
        setSaveState('error');
        setError(message(cause));
      }
      throw cause;
    });
    saveQueue.current = operation.catch(() => {});
    return operation;
  }

  async function flushDirectoryProject() {
    clearTimeout(autoSaveTimer.current);
    const project = attachedProjectRef.current;
    if (!project || !savedProjectRef.current) return;
    const current = { files: filesRef.current, folders: foldersRef.current };
    if (projectSnapshotEqual(savedProjectRef.current, current) && settingsEqual(savedSettingsRef.current, overridesRef.current)) return;
    await queueDirectorySave(project, current.files, current.folders, overridesRef.current);
  }

  async function loadDirectoryProject(project, { permissionGranted = false, force = false } = {}) {
    if (aiLocked) { setError('Apply or discard AI changes before switching projects.'); return false; }
    setBusy(true); setError('');
    try {
      if (!permissionGranted && !(await ensureProjectPermission(project.handle))) throw new Error(`Studio needs read and write access to ${project.name}.`);
      if (!installedMode && !attachedProjectRef.current && dirtyRef.current && !force) throw new Error('Download the current template ZIP before switching to a folder project.');
      if (reconnectProject && dirtyRef.current && !force) throw new Error('Recovered edits are available in this session. Export the project before reloading the disk copy.');
      if (!force) await flushDirectoryProject();
      else await saveQueue.current;
      await recoveryQueue.current;
      let next = await readDirectoryProject(project.handle);
      let settings = await readProjectSettings(project.handle);
      if (!Object.keys(next.files).length) {
        const initial = starterProject(true);
        next = await syncDirectoryProject(project.handle, { files: {}, folders: [] }, { files: initial, folders: [] });
        settings = {};
      }
      const remembered = await rememberDirectoryProject(project.handle, [project, ...directoryProjects]);
      replaceProject(next.files, next.folders, { project: remembered, settings });
      setDirectoryProjects(previous => [remembered, ...previous.filter(item => item.id !== remembered.id)]);
      setProjectsOpen(false);
      setNotice(`Opened ${remembered.name}. Changes save to this folder.`);
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addDirectoryProject() {
    try {
      const handle = await chooseProjectDirectory();
      const project = await rememberDirectoryProject(handle, directoryProjects);
      setDirectoryProjects(previous => [project, ...previous.filter(item => item.id !== project.id)]);
      return await loadDirectoryProject(project, { permissionGranted: true });
    } catch (cause) {
      if (cause?.name !== 'AbortError') setError(message(cause));
      return false;
    }
  }

  async function reloadDirectoryProject(project) {
    if (project.id === attachedProjectRef.current?.id && dirtyRef.current && saveState !== 'error') {
      setError('Wait for Studio to save before reloading the folder.');
      return false;
    }
    return loadDirectoryProject(project, { force: true });
  }

  async function forgetProject(project) {
    try {
      await forgetDirectoryProject(project.id);
      setDirectoryProjects(previous => previous.filter(item => item.id !== project.id));
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function installStudio() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function applyPwaUpdate() {
    if (aiLocked) { setError('Finish or discard AI changes before updating.'); return; }
    if (dirty && (attachedProject || recoveryState !== 'saved')) { setError(attachedProject ? 'Wait until the project is saved before updating Studio.' : 'Save the template ZIP before updating Studio.'); return; }
    pwaUpdate?.();
  }
  async function importArchive(file) {
    if (!file || aiLocked) return;
    setError(''); setBusy(true);
    try {
      await flushDirectoryProject();
      if (file.size > LIMITS.archive) throw new Error('Choose a ZIP smaller than 20 MiB.');
      const buffer = await file.arrayBuffer();
      const next = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./archive.worker.js', import.meta.url), { type: 'module' });
        importWorker.current?.terminate(); importWorker.current = worker;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('ZIP import took too long. Use a smaller archive.')); }, 15000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data); };
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('The archive could not be read.')); };
        worker.postMessage(buffer, [buffer]);
      });
      replaceProject(next.files, next.folders, { settings: next.settings || {} }); setSessionName(file.name.replace(/\.zip$/i, '')); setNotice(`Opened ${file.name}. Everything stays in this browser.`);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); if (archiveInput.current) archiveInput.current.value = ''; }
  }
  async function importData(file) {
    if (!file) return;
    try {
      if (file.size > LIMITS.text) throw new Error('Settings JSON must be smaller than 2 MiB.');
      const data = JSON.parse(await file.text());
      if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Settings must be a JSON object.');
      if (!definition) throw new Error('Fix the template before importing settings.');
      generateProject(files, data);
      setOverrides(data); setDirty(true); setError(''); setNotice('Settings loaded.');
    } catch (cause) { setError(message(cause)); }
    finally { if (dataInput.current) dataInput.current.value = ''; }
  }
  function exportZip(source = false) {
    try {
      if (aiLocked) throw new Error('Apply or discard AI changes before downloading.');
      if (!source && !ready) throw new Error(generated.error || 'Wait for the template to finish updating.');
      downloadFile(source ? 'trafficops-template.zip' : 'trafficops-pages.zip', createZip(source ? files : generated.files, { generated: !source, directories: source ? folders : [], settings: source ? overrides : undefined }));
      if (source && !attachedProject) { setDirty(false); setSourceBaseline(files); }
      setNotice(source ? 'Template ZIP downloaded.' : 'Your pages are ready. ZIP downloaded.');
    } catch (cause) { setError(message(cause)); }
  }
  function editSource(value) {
    if (aiLocked || busy) return;
    if (byteSize(value) > LIMITS.text) { setError('A text file may be no larger than 2 MiB.'); return; }
    setFiles(previous => ({ ...previous, [active]: value })); setDirty(true);
  }
  function previewAiProject(next) {
    setAiDraft(next);
    if (next) {
      setFilesCollapsed(false);
      if (!Object.hasOwn(next.files, active)) setActive(Object.keys(next.files).find(isTemplate) || Object.keys(next.files)[0]);
    } else if (!Object.hasOwn(filesRef.current, active)) setActive(Object.keys(filesRef.current).find(isTemplate) || Object.keys(filesRef.current)[0]);
  }
  function applyAiProject(nextFiles, nextValues = {}) {
    try {
      const next = validateProject(nextFiles);
      generateProject(next, nextValues);
      filesRef.current = next; overridesRef.current = nextValues;
      setFiles(next); setFolders(projectFolders(next)); setOverrides(nextValues);
      setActive(previous => Object.hasOwn(next, previous) ? previous : Object.keys(next).find(isTemplate));
      setError(''); setDirty(true); setNotice('AI changes applied.'); return true;
    } catch (cause) { setError(message(cause)); return false; }
  }
  async function changeProjectLocation(project, value) {
    try { const updated = await updateProjectLocation(project, value); setDirectoryProjects(previous => previous.map(item => item.id === updated.id ? updated : item)); if (attachedProject?.id === updated.id) setAttachedProject(updated); }
    catch (cause) { setError(message(cause)); }
  }
  const openSettings = () => { location.hash = 'settings'; };
  async function handleDialog(value) {
    if (aiLocked) throw new Error('Apply or discard AI changes first.');
    if (dialog === 'reset') { await flushDirectoryProject(); replaceProject(starterProject(true)); setSessionName('Untitled project'); setDirty(true); return; }
    if (dialog === 'remove') {
      const next = Object.fromEntries(Object.entries(files).filter(([name]) => name !== active));
      if (!Object.keys(next).length) throw new Error('Keep at least one file in your project.');
      setFiles(next); setActive(Object.keys(next)[0]);
    } else if (dialog === 'rename') {
      const name = value.trim(), next = renameFile(files, active, name);
      validateFolders(next, folders);
      setFiles(next); setActive(name);
    }
    else if (dialog === 'add-folder') {
      const name = safePath(value.trim());
      const nextFolders = validateFolders(files, [...folders, name]);
      if (projectFolders(files, folders).includes(name)) throw new Error('This folder already exists.');
      setFolders(nextFolders);
    }
    else {
      const name = safePath(value.trim());
      if (Object.hasOwn(files, name)) throw new Error('A file with this path already exists.');
      const next = validateProject({ ...files, [name]: isTemplate(name) ? '@layout\n  <!doctype html>\n  <html>\n    <body>\n      <h1>New page</h1>\n    </body>\n  </html>\n@endlayout\n' : '' });
      validateFolders(next, folders);
      setFiles(next); setActive(name); setTab('code');
    }
    setDirty(true);
  }

  async function addUploadedFiles(fileList, targetFolder = '', { renameCollisions = false } = {}) {
    if (aiLocked || busy) { setError('Finish the current operation before adding files.'); return []; }
    const uploads = [...(fileList || [])];
    if (!uploads.length) return [];
    try {
      const additions = {};
      for (const file of uploads) {
        const relative = file.webkitRelativePath || file.name;
        let path = safePath([targetFolder, relative].filter(Boolean).join('/'));
        if (Object.hasOwn(files, path) || Object.hasOwn(additions, path)) {
          if (!renameCollisions) throw new Error(`A file already exists: ${path}`);
          const extensionAt = path.lastIndexOf('.'), base = extensionAt > path.lastIndexOf('/') ? path.slice(0, extensionAt) : path, extension = extensionAt > path.lastIndexOf('/') ? path.slice(extensionAt) : '';
          let suffix = 2;
          while (Object.hasOwn(files, `${base}-${suffix}${extension}`) || Object.hasOwn(additions, `${base}-${suffix}${extension}`)) suffix++;
          path = `${base}-${suffix}${extension}`;
        }
        if (file.size > LIMITS.file || (isText(path) && file.size > LIMITS.text)) throw new Error(`File is too large: ${path}`);
        additions[path] = isText(path) ? await file.text() : new Uint8Array(await file.arrayBuffer());
      }
      const next = validateProject({ ...filesRef.current, ...additions });
      const nextFolders = validateFolders(next, folders);
      if (attachedProjectRef.current) await queueDirectorySave(attachedProjectRef.current, next, nextFolders, overridesRef.current);
      filesRef.current = next; foldersRef.current = nextFolders;
      setFiles(next); setFolders(nextFolders); setDirty(!attachedProjectRef.current); setError('');
      if (attachedProjectRef.current) setSaveState('saved');
      const paths = Object.keys(additions); setNotice(`${paths.length} ${paths.length === 1 ? 'file' : 'files'} ${attachedProjectRef.current ? 'saved to the project folder' : 'added to the project'}.`);
      return paths;
    } catch (cause) { setError(message(cause)); return []; }
  }

  function moveEntry(entry, targetFolder) {
    if (aiLocked) return;
    try {
      const source = safePath(entry.path), target = targetFolder ? safePath(targetFolder) : '';
      const destination = [target, source.split('/').pop()].filter(Boolean).join('/');
      if (source === destination) return;
      if (entry.type === 'file') {
        if (projectFolders(files, folders).includes(destination)) throw new Error(`A file conflicts with a folder: ${destination}`);
        const next = renameFile(files, source, destination);
        setFiles(next); if (active === source) setActive(destination);
      } else {
        if (target === source || target.startsWith(`${source}/`)) throw new Error('A folder cannot be moved inside itself.');
        const beforeFolders = projectFolders(files, folders);
        if (beforeFolders.includes(destination) && destination !== source) throw new Error(`A folder already exists: ${destination}`);
        const affected = Object.keys(files).filter(name => name.startsWith(`${source}/`));
        if (!affected.length && !beforeFolders.includes(source)) throw new Error(`Folder not found: ${source}`);
        const nextEntries = Object.entries(files).map(([name, value]) => [name.startsWith(`${source}/`) ? `${destination}${name.slice(source.length)}` : name, value]);
        const destinations = nextEntries.map(([name]) => name);
        if (new Set(destinations).size !== destinations.length) throw new Error(`Moving ${source} would overwrite an existing file.`);
        const next = Object.fromEntries(nextEntries);
        validateProject(next);
        const allFolders = beforeFolders.map(name => name === source || name.startsWith(`${source}/`) ? `${destination}${name.slice(source.length)}` : name);
        setFiles(next); setFolders(validateFolders(next, allFolders));
        if (active?.startsWith(`${source}/`)) setActive(`${destination}${active.slice(source.length)}`);
      }
      setDirty(true); setError('');
    } catch (cause) { setError(message(cause)); }
  }

  async function uploadImage(file) {
    if (!file || (!String(file.type).startsWith('image/') && !/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file.name))) { setError('Choose an image file.'); return null; }
    const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '').slice(-160) || 'image.png';
    const upload = originalName === file.name ? file : new File([file], originalName, { type: file.type });
    const paths = await addUploadedFiles([upload], 'images', { renameCollisions: true });
    return paths[0] || null;
  }

  function toggleWorkspace() {
    if (installedMode) return;
    if (!workspaceExpanded) {
      compactTab.current = tab;
      setTab('code');
      setExpandedPreviewVisible(true);
    } else {
      setTab(compactTab.current);
    }
    setWorkspaceExpanded(expanded => !expanded);
  }

  const saveLabel = attachedProject
    ? saveState === 'saving' ? `Saving to ${attachedProject.name}…` : (saveState === 'pending' || (dirty && saveState === 'saved')) ? `Changes queued for ${attachedProject.name}` : saveState === 'error' ? `Could not save to ${attachedProject.name}` : `Saved to ${attachedProject.name}`
    : installedMode ? recoveryState === 'saved' ? 'Saved on this device · connect a folder for disk saves' : recoveryState === 'error' ? 'Device save failed · export to keep your work' : 'Saving on this device…' : dirty ? 'Unsaved session · download to keep your work' : 'Session project · add a folder to save automatically';

  return <div aria-busy={!hydrated} className={`studio ${installedMode && settingsPage ? 'show-settings' : ''} ${workspaceExpanded ? 'workspace-expanded' : ''} ${installedMode ? 'installed-app' : ''}`}>
    <header className="topbar"><div className="topbar-inner"><a className="brand" href="https://trafficops.io/" target="_blank" rel="noreferrer" aria-label="TrafficOps website"><img src="/favicon.svg" alt="" /><span className="brand-wordmark">Traffic<span>Ops</span></span></a><span className="brand-divider" /><span className="product-name">Landing Studio</span><div className="topbar-right"><span className="privacy"><ShieldCheck size={15} /> Local by design</span>{installPrompt && <button className="btn btn-ghost btn-sm install-button" onClick={installStudio}><ArrowDownToLine size={15} /> Install Studio</button>}<button className="btn btn-ghost btn-sm quick-start-button" aria-label="Open quick start guide" onClick={() => setHelp(true)}><HelpCircle size={16} /> Quick start</button><a className="docs-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Docs ↗</a></div></div></header>
    {workspaceExpanded && <div className="studio-toolbar"><span className="studio-title">Landing Studio</span>{installedMode ? <ProjectSwitcher projects={directoryProjects} current={attachedProject} sessionName={sessionName} disabled={busy || !hydrated || aiLocked} onOpen={loadDirectoryProject} onAdd={addDirectoryProject} onManage={() => setProjectsOpen(true)} /> : <span>Template editor</span>}<div className="studio-toolbar-actions"><button className="btn btn-ghost btn-sm" disabled={aiLocked || !hydrated} onClick={() => setDialog('reset')} aria-label="New project"><Plus size={16} /></button><button className="btn btn-ghost btn-sm" disabled={aiLocked || busy || !hydrated} onClick={() => archiveInput.current?.click()} aria-label="Open ZIP"><ArrowUpFromLine size={16} /></button>{installedMode && <button className="btn btn-ghost btn-sm" aria-label="Open app settings" disabled={aiLocked} onClick={openSettings}><Settings2 size={17} /></button>}<button aria-label="Download landing" className="btn btn-primary btn-sm" disabled={!ready || busy || aiLocked || !hydrated} onClick={() => exportZip(false)}><ArrowDownToLine size={16} /><span>Download landing</span></button>{!installedMode && <button className="btn btn-ghost btn-sm" aria-label="Exit expanded view" onClick={toggleWorkspace}><Minimize2 size={16} /></button>}</div></div>}
    {installedMode && settingsPage && <SettingsPage onBack={() => { location.hash = ''; }} />}
    <main className="workspace" hidden={installedMode && settingsPage}>
      {!hydrated && <div className="restore-overlay" role="status"><LoaderCircle className="spin" /> Opening your last project…</div>}
      {reconnectProject && <div className="reconnect-banner" role="status"><span>{dirty ? 'Recovered unsaved edits. Export before reloading the folder.' : `Reconnect ${reconnectProject.name} to continue saving to disk.`}</span><button className="btn btn-sm" disabled={aiLocked || dirty} onClick={() => loadDirectoryProject(reconnectProject)}>Reconnect folder</button></div>}
      {aiLocked && <div className="ai-review-banner" role="status"><span>{aiWorking ? 'AI is working · files and preview update as changes arrive' : 'AI changes in preview · apply or discard to continue editing'}</span><button className="btn btn-ghost btn-xs" onClick={() => setTab('ai')}>Open AI assistant</button></div>}
      <div className="workspace-heading"><div className="workspace-intro"><div className="eyebrow"><span /> TEMPLATE STUDIO / LOCAL-FIRST</div><h1>A little code.<br /><span>A lot of possibility.</span></h1><p>Shape your template, preview every change, and take the result anywhere.</p></div><div className="project-actions">{installedMode && <button className="btn btn-outline btn-sm project-manager-button" onClick={() => installedMode ? setProjectsOpen(true) : setNotice('Install Landing Studio to connect local project folders.')}><FolderOpen size={16} /><span>{attachedProject?.name || 'Project folders'}</span>{attachedProject && <span className={`save-indicator ${saveState}`} />}</button>}<button className="btn btn-ghost btn-sm expand-workspace-button" onClick={toggleWorkspace}><Maximize2 size={16} /> Expand editor</button><button className="btn btn-ghost btn-sm" onClick={() => setDialog('reset')}><Plus size={16} /> New project</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => archiveInput.current?.click()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUpFromLine size={16} />} Open ZIP</button></div></div>
      {error && <div role="alert" className="error-banner"><span>{error}</span><button className="btn btn-ghost btn-xs btn-square" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {pwaUpdate && !installedMode && <div role="status" className="update-banner"><span>A new Studio version is ready.</span><button className="btn btn-sm btn-primary" onClick={applyPwaUpdate}>Update Studio</button></div>}
      <div className={`editor-shell ${workspaceExpanded ? 'is-expanded' : 'is-compact'} ${filesCollapsed ? 'files-collapsed' : ''} ${workspaceExpanded && !expandedPreviewVisible ? 'preview-collapsed' : ''}`}>
        <ProjectSidebar changedFiles={changedFiles} aiPreview={Boolean(aiDraft)} aiEnabled={Boolean(AiPanel)} locked={aiLocked || busy} files={workspaceFiles} folders={aiDraft ? [] : folders} active={active} projectName={attachedProject?.name || sessionName} savesToDisk={Boolean(attachedProject)} isCollapsed={filesCollapsed} onToggleCollapsed={() => setFilesCollapsed(collapsed => !collapsed)} onManageProjects={installedMode ? () => setProjectsOpen(true) : undefined} onOpenArchive={() => archiveInput.current?.click()} onSelect={name => { setActive(name); setTab('code'); }} onCreate={kind => { if (!aiLocked) setDialog(kind === 'folder' ? 'add-folder' : 'add-file'); }} onRename={() => { if (!aiLocked) setDialog('rename'); }} onDelete={() => { if (!aiLocked) setDialog('remove'); }} onMove={moveEntry} onUpload={addUploadedFiles} onExport={() => exportZip(true)} />
        <section className="author-panel"><div className="author-tabs"><div className="author-tab-list" role="tablist" aria-label="Authoring mode"><button id="settings-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}><Settings2 size={15} /> Customize</button><button id="code-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'code'} className={tab === 'code' ? 'selected' : ''} onClick={() => setTab('code')}><Code2 size={15} /> Source</button>{AiPanel && <button id="ai-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'ai'} className={tab === 'ai' ? 'selected' : ''} onClick={() => setTab('ai')}><Sparkles size={15} /> AI assistant</button>}</div>{workspaceExpanded && !installedMode && <button type="button" className="exit-expanded-button" aria-label="Exit expanded view" onClick={toggleWorkspace}><Minimize2 size={15} /> Exit</button>}</div>
          {tab === 'settings' && workspaceExpanded && <div className="settings-heading"><span>Template settings</span><div className="source-tools"><button className="btn btn-ghost btn-xs preview-toggle-button" aria-controls="preview-panel" aria-expanded={expandedPreviewVisible} onClick={() => setExpandedPreviewVisible(visible => !visible)}>{expandedPreviewVisible ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}{expandedPreviewVisible ? 'Hide preview' : 'Show preview'}</button></div></div>}
          <div id="author-content" role="tabpanel" aria-labelledby={`${tab}-tab`} className={`author-content ${tab === 'code' ? 'source-content' : ''}`}>
            {AiPanel && <div hidden={tab !== 'ai'} data-editor-capability="ai"><AiPanel key={projectEpoch} definition={definition} values={values} files={files} onPreview={previewAiProject} onBusyChange={setAiWorking} onSettings={openSettings} onApplyProject={applyAiProject} onApply={next => { try { generateProject(files, next); setOverrides(next); setDirty(true); setError(''); return true; } catch (cause) { setError(message(cause)); return false; } }} /></div>}
            {tab === 'settings' ? <fieldset disabled={aiLocked || busy}><div className="settings-intro"><div className="section-kicker">MAKE IT YOURS</div><h2>{definition?.name || 'Template settings'}</h2><p>{definition?.description || 'Your template’s parameters become the controls below.'}</p></div>{generated.error && <div role="alert" className="validation-error"><strong>{parsed.error ? 'Check your template' : 'Check your settings'}</strong><p>{generated.error}</p></div>}{definition && <ParameterForm key={projectEpoch} definition={definition} values={values} projectImages={names.filter(name => /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(name))} files={workspaceFiles} aiEnabled={Boolean(AiPanel)} onSettings={openSettings} onImageUpload={uploadImage} onChange={next => { setOverrides(next); setDirty(true); }} />}<div className="settings-actions"><button className="btn btn-ghost btn-xs" onClick={() => { setOverrides({}); setDirty(true); }}><RotateCcw size={12} /> Reset defaults</button><button className="btn btn-ghost btn-xs" onClick={() => dataInput.current?.click()}>Load JSON</button><button className="btn btn-ghost btn-xs" disabled={!definition} onClick={() => downloadFile('trafficops-data.json', JSON.stringify(values, null, 2), 'application/json')}>Save JSON</button></div></fieldset>
              : tab === 'code' ? <>{typeof activeValue === 'string' ? <Suspense fallback={<div className="empty-state"><LoaderCircle size={20} className="spin" /><p>Opening editor…</p></div>}><CodeEditor key={active} readOnly={aiLocked || busy} path={active} value={activeValue} files={workspaceFiles} onChange={editSource} onError={setError} reveal={reveal?.path === active ? reveal : null} onOpenFile={(path, selection) => { setActive(path); setTab('code'); setReveal({ path, selection }); }} previewVisible={expandedPreviewVisible} onTogglePreview={workspaceExpanded ? () => setExpandedPreviewVisible(visible => !visible) : undefined} /></Suspense> : <div className="empty-state"><FileImage size={36} /><h3>Asset included</h3><p>This file is preserved in your ZIP.<br />Reference it by its relative path.</p><code>{active}</code><span>{Math.ceil(byteSize(activeValue || '') / 1024)} KiB</span></div>}</> : null}
          </div>
        </section>
        {(!workspaceExpanded || expandedPreviewVisible) && <PreviewPanel ready={ready} mobile={mobile} onMobileChange={setMobile} shownPage={shownPage} pageNames={pageNames} onPageChange={setPreviewPage} preview={preview} error={generated.error} />}
      </div>
      <div className="workspace-footer"><div className="workspace-status"><span className={`status-dot ${dirty || saveState === 'pending' || saveState === 'saving' ? 'pending' : ''} ${saveState === 'error' ? 'error' : ''}`} /><span>{saveLabel}</span></div><button className="btn btn-primary generate-button" disabled={!ready || busy || aiLocked} onClick={() => exportZip(false)}><ArrowDownToLine size={16} /> Download landing <span className="button-detail">.zip</span></button></div>
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    {notice && <div className="toast toast-end"><div role="status" className="notice"><Check size={16} />{notice}</div></div>}
    {pwaUpdate && installedMode && <div className="toast toast-start pwa-update-toast"><div role="status" className="update-notice"><span>{dirty && (attachedProject || recoveryState !== 'saved') ? 'Studio will update after the project is saved.' : 'A new Studio version is ready.'}</span><button className="btn btn-sm btn-primary" disabled={aiLocked || (dirty && (attachedProject || recoveryState !== 'saved'))} onClick={applyPwaUpdate}>Update</button></div></div>}
    {help && <TourDialog onClose={() => setHelp(false)} />}
    {projectsOpen && <ProjectsDialog projects={directoryProjects} currentId={attachedProject?.id} supported={installedMode && supportsDirectoryProjects()} busy={busy} onAdd={addDirectoryProject} onOpen={loadDirectoryProject} onForget={forgetProject} onReload={reloadDirectoryProject} onLocation={changeProjectLocation} onClose={() => setProjectsOpen(false)} />}
    {dialog && <FileDialog operation={dialog} active={active} folders={projectFolders(files, folders)} onClose={() => setDialog(null)} onSubmit={handleDialog} />}
    <input ref={archiveInput} hidden type="file" accept=".zip,application/zip" aria-label="Open template ZIP" onChange={event => importArchive(event.target.files?.[0])} />
    <input ref={dataInput} hidden type="file" accept=".json,application/json" aria-label="Load parameter JSON" onChange={event => importData(event.target.files?.[0])} />
  </div>;
}
