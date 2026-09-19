import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FolderOpen, HelpCircle, LayoutGrid, Plus, ShieldCheck, WifiOff } from 'lucide-react';
import EditorShell from '@trafficops/template-editor-shell';
import { createStudioHost } from './hosts/StudioHost.js';
import { createLibraryHost } from './hosts/LibraryHost.js';
import { createStudioAiPort } from './hosts/StudioAiPort.js';
import { installedDisplayMode, watchDisplayMode } from './app-mode.js';
import { loadWorkspace, saveWorkspace } from './workspace-storage.js';
import { chooseProjectDirectory, ensureProjectPermission, forgetDirectoryProject, listDirectoryProjects, projectSnapshotEqual, readDirectoryProject, readProjectSettings, rememberDirectoryProject, supportsDirectoryProjects, updateProjectLocation } from './directory-projects.js';
import { LIMITS, projectFolders } from '@trafficops/template-editor-core';
import { cloneStudioProject, createStudioProject, deleteStudioProject, getActiveStudioProjectId, getStudioProject, listStudioProjects, saveStudioProject, setActiveStudioProjectId } from './studio-library.js';
import { readArchive } from './hosts/read-archive.js';
import { starterProject } from './starter.js';
import { getPwaState, subscribePwa } from './pwa.js';
import ProjectSwitcher from './ProjectSwitcher.jsx';
import StudioLibrary, { CreateProjectDialog } from './StudioLibrary.jsx';
import { ProjectsDialog, TourDialog } from './StudioDialogs.jsx';

export default function App() {
  const [installedMode, setInstalledMode] = useState(installedDisplayMode);
  const [host, setHost] = useState(null), [epoch, setEpoch] = useState(0), [recovered, setRecovered] = useState(null);
  const [library, setLibrary] = useState([]), [current, setCurrent] = useState(null), [ready, setReady] = useState(false);
  const [projects, setProjects] = useState([]), [attached, setAttached] = useState(null), [reconnect, setReconnect] = useState(null);
  const [help, setHelp] = useState(false), [projectsOpen, setProjectsOpen] = useState(false), [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [view, setView] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null), [pwa, setPwa] = useState(getPwaState), [online, setOnline] = useState(navigator.onLine);
  const update = pwa.update;
  const snapshot = useRef(null), recoveryTimer = useRef(null), recoveryQueue = useRef(Promise.resolve()), restore = useRef(null), archive = useRef(null);
  const session = useRef(0), currentRef = useRef(null), busyRef = useRef(false);
  const ai = useRef(null);
  function studioAi() {
    if (!installedDisplayMode()) return undefined;
    return ai.current ||= createStudioAiPort({ isEnabled: installedDisplayMode });
  }
  async function clearRecovery() {
    // A browser tab must not erase an installed app's separate folder recovery.
    if (installedDisplayMode() && (attached || recovered)) await saveWorkspace(null);
  }
  const blocked = busy || Boolean(view?.busy || view?.aiBusy || view?.aiDraft);
  function refreshSaved(record) {
    setLibrary(items => [record, ...items.filter(item => item.id !== record.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    if (currentRef.current?.id === record.id) { currentRef.current = record; setCurrent(record); }
  }
  function mount(next, { record = null, project = null, recovery = null } = {}) {
    session.current++; clearTimeout(recoveryTimer.current); snapshot.current = null; setView(null);
    currentRef.current = record; setHost(next); setCurrent(record); setAttached(project); setRecovered(recovery); setReconnect(null); setEpoch(value => value + 1);
  }
  function connectLibrary(record, autoStart = false) {
    mount(createLibraryHost({ record, ai: studioAi(), autoStart: autoStart && installedDisplayMode(), onSaved: refreshSaved }), { record });
  }
  function recoveryWriter(projectId) {
    return state => {
      clearTimeout(recoveryTimer.current);
      const saved = { files: state.files, folders: state.folders, overrides: state.translations[state.locale], sourceBaseline: state.files, name: state.name, projectId, dirty: false, detached: true };
      const task = recoveryQueue.current.catch(() => {}).then(() => saveWorkspace(saved));
      recoveryQueue.current = task;
      return task;
    };
  }
  function connectFolder(project, recovery = null) {
    if (!installedDisplayMode()) throw new Error('Project folders are available only in the installed Studio app.');
    const options = recovery ? { initial: { name: recovery.name, files: recovery.files, folders: recovery.folders || [], settings: recovery.overrides || {} }, recovery: recoveryWriter(project.id) } : { directory: project.handle };
    mount(createStudioHost({ ...options, ai: studioAi(), isDirectoryEnabled: installedDisplayMode }), { project: recovery ? null : project, recovery });
    if (recovery) setReconnect(project);
  }
  useEffect(() => watchDisplayMode(setInstalledMode), []);
  useEffect(() => subscribePwa(setPwa), []);
  useEffect(() => {
    let alive = true;
    if (!restore.current) restore.current = (async () => {
      const [records, activeId, directories, workspace] = await Promise.all([listStudioProjects(), getActiveStudioProjectId(), installedDisplayMode() ? listDirectoryProjects() : [], loadWorkspace()]);
      // Keep old single-workspace installations: migrate ZIP sessions exactly once.
      if (!activeId && workspace?.files && !workspace.projectId) {
        const migrated = await saveStudioProject(createStudioProject({ kind: 'landing', name: workspace.name || 'Recovered project', files: workspace.files, folders: workspace.folders || [], settings: workspace.overrides || {} }), { expectedRevision: null });
        await setActiveStudioProjectId(migrated.id); await saveWorkspace(null);
        return { records: [migrated, ...records], active: migrated, directories };
      }
      return { records, active: records.find(item => item.id === activeId), directories, workspace };
    })();
    restore.current.then(async ({ records, active, directories, workspace }) => {
      if (!alive) return;
      setLibrary(records); setProjects(directories);
      if (active) connectLibrary(active);
      else if (installedDisplayMode() && workspace?.projectId && workspace.files) {
        const project = directories.find(item => item.id === workspace.projectId);
        const recoverFolder = () => {
          mount(createStudioHost({ initial: { name: workspace.name, files: workspace.files, folders: workspace.folders || [], settings: workspace.overrides || {} }, ai: studioAi(), recovery: recoveryWriter(workspace.projectId) }), { recovery: workspace });
          if (project) setReconnect(project);
        };
        try {
          if (project && await ensureProjectPermission(project.handle, { request: false })) {
            const disk = await readDirectoryProject(project.handle), settings = await readProjectSettings(project.handle);
            if (!alive) return;
            const same = projectSnapshotEqual({ files: workspace.files, folders: projectFolders(workspace.files, workspace.folders || []) }, { files: disk.files, folders: projectFolders(disk.files, disk.folders) }) && JSON.stringify(workspace.overrides || {}) === JSON.stringify(settings);
            connectFolder(project, (workspace.dirty || workspace.detached) && !same ? workspace : null);
          } else if (alive) recoverFolder();
        } catch (cause) {
          if (!alive) return;
          recoverFolder(); setError(`Could not read the folder. Your recovery copy is open: ${cause.message}`);
        }
      }
      if (alive) setReady(true);
    }).catch(cause => { if (alive) { setError(`Could not open device storage: ${cause.message}`); setReady(true); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const install = event => { event.preventDefault(); setInstallPrompt(event); };
    const network = () => setOnline(navigator.onLine);
    window.addEventListener('beforeinstallprompt', install);
    window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('online', network); window.removeEventListener('offline', network); };
  }, []);
  useEffect(() => () => clearTimeout(recoveryTimer.current), []);
  function rememberSnapshot(value) {
    snapshot.current = value; setView(value);
    if (currentRef.current || !installedDisplayMode()) return; // LibraryHost commits its own versioned autosaves.
    clearTimeout(recoveryTimer.current);
    const version = session.current;
    const saved = { files: value.state.files, folders: value.state.folders, overrides: value.state.translations[value.state.locale], sourceBaseline: value.baseline, name: value.state.name, projectId: attached?.id || reconnect?.id || recovered?.projectId || null, dirty: value.dirty, detached: Boolean(recovered) };
    recoveryTimer.current = setTimeout(() => {
      recoveryQueue.current = recoveryQueue.current.catch(() => {}).then(() => saveWorkspace(saved)).catch(cause => { if (session.current === version) setError(`Device recovery could not be saved: ${cause.message}`); });
    }, 250);
  }
  async function preserveCurrent() {
    const value = snapshot.current;
    if (value?.aiBusy || value?.aiDraft || value?.busy) throw new Error('Finish or discard the current operation before leaving this project.');
    clearTimeout(recoveryTimer.current); await recoveryQueue.current;
    if (!value) return;
    if (currentRef.current || attached) {
      if (value.dirty) await value.flush();
    } else {
      // A recovered folder copy remains independent until explicitly reconnected.
      const saved = await saveStudioProject(createStudioProject({ kind: 'landing', name: value.state.name || 'Recovered project', files: value.state.files, folders: value.state.folders, settings: value.state.translations[value.state.locale] }), { expectedRevision: null });
      refreshSaved(saved);
    }
  }
  async function perform(operation) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { return await operation(); } catch (cause) { if (cause.name !== 'AbortError') setError(cause.message); } finally { busyRef.current = false; setBusy(false); }
  }
  async function openProject(record) {
    await perform(async () => { await preserveCurrent(); const saved = await getStudioProject(record.id); if (!saved) throw new Error('This project was removed in another window.'); await setActiveStudioProjectId(saved.id); await clearRecovery(); connectLibrary(saved); });
  }
  async function showLibrary() {
    await perform(async () => { await preserveCurrent(); await setActiveStudioProjectId(null); await clearRecovery(); mount(null); setLibrary(await listStudioProjects()); });
  }
  async function saveConflictCopy() {
    await perform(async () => {
      const value = snapshot.current;
      if (!value || value.busy || value.aiBusy || value.aiDraft) throw new Error('Finish the current operation before copying this project.');
      const record = createStudioProject({ kind: currentRef.current?.kind || 'landing', name: `${value.state.name.slice(0, 108)} (recovered)`, files: value.state.files, folders: value.state.folders, settings: value.state.translations[value.state.locale] });
      const saved = await saveStudioProject(record, { expectedRevision: null });
      refreshSaved(saved); await setActiveStudioProjectId(saved.id); await clearRecovery(); connectLibrary(saved);
    });
  }
  async function createProject({ kind, mode, name, prompt, source }) {
    if (busyRef.current) return;
    if (mode === 'ai' && !installedDisplayMode()) throw new Error('AI is available only in the installed Studio app.');
    if (!name) throw new Error('Give your project a name.');
    if (mode === 'ai' && !prompt) throw new Error('Describe what you want to create.');
    if (mode === 'template' && !source) throw new Error('Choose a starting template.');
    busyRef.current = true; setBusy(true);
    try {
      if (mode === 'template' && !source.builtin) { source = await getStudioProject(source.id); if (!source || source.kind !== 'template') throw new Error('This template is no longer available. Choose another starting point.'); }
      await preserveCurrent();
      const candidate = mode === 'template' ? cloneStudioProject(source, { kind, name }) : createStudioProject({ kind, name, files: starterProject(true), folders: [], settings: {}, ...(mode === 'ai' ? { aiPrompt: prompt, aiStarted: false } : {}) });
      const saved = await saveStudioProject(candidate, { expectedRevision: null }); refreshSaved(saved);
      await setActiveStudioProjectId(saved.id); await clearRecovery();
      connectLibrary(saved, mode === 'ai'); setCreating(null);
      navigator.storage?.persist?.().catch(() => {});
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function importProject(file) {
    if (!file) return;
    await perform(async () => {
      if (file.size > LIMITS.archive) throw new Error('ZIP archives must be 20 MiB or smaller.');
      const imported = await readArchive(new Uint8Array(await file.arrayBuffer()));
      await preserveCurrent();
      const saved = await saveStudioProject(createStudioProject({ kind: 'template', name: file.name.replace(/\.zip$/i, '').slice(0, 120) || 'Imported template', ...imported }), { expectedRevision: null });
      refreshSaved(saved); await setActiveStudioProjectId(saved.id); await clearRecovery(); connectLibrary(saved);
    });
  }
  async function loadProject(project) {
    await perform(async () => {
      if (!installedDisplayMode()) throw new Error('Project folders are available only in the installed Studio app.');
      if (!(await ensureProjectPermission(project.handle))) throw new Error(`Studio needs read and write access to ${project.name}.`);
      await preserveCurrent();
      const remembered = await rememberDirectoryProject(project.handle, [project, ...projects]);
      await setActiveStudioProjectId(null); connectFolder(remembered); setProjects(items => [remembered, ...items.filter(item => item.id !== remembered.id)]); setProjectsOpen(false);
    });
  }
  async function addProject() {
    if (blocked || !installedDisplayMode()) return;
    try { const handle = await chooseProjectDirectory(); const project = await rememberDirectoryProject(handle, projects); await loadProject(project); }
    catch (cause) { if (cause.name !== 'AbortError') setError(cause.message); }
  }
  const statusNotice = <>{view?.conflict && <button className="btn btn-outline btn-xs" disabled={blocked} onClick={saveConflictCopy}>Save as new project</button>}{pwa.error && <span className="studio-app-error" role="status">{pwa.error.operation === 'register' ? 'Offline setup failed' : 'Update check failed'}: {pwa.error.message}</span>}{!online && <span className="studio-network" role="status"><WifiOff size={14} />Offline · local editing available</span>}{update && <button className="btn btn-primary btn-xs" disabled={blocked} onClick={() => perform(async () => { await preserveCurrent(); await update(true); })}>Update Studio</button>}{error && <span className="studio-app-error" role="alert">{error}<button className="text-link" onClick={() => setError('')}>Dismiss</button></span>}</>;
  const navigation = <div className="studio-navigation"><button className="btn btn-ghost btn-sm" disabled={blocked} onClick={showLibrary}><LayoutGrid size={16} />Library</button><button className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => setCreating({})}><Plus size={16} />New</button>{installedMode && attached && <ProjectSwitcher projects={projects} current={attached} sessionName={view?.state.name || 'Project'} disabled={blocked} onOpen={loadProject} onAdd={addProject} onManage={() => setProjectsOpen(true)} />}{statusNotice}</div>;
  return <div className={`studio editor-root ${installedMode ? 'installed-app' : ''}`}>
    <header className="topbar"><div className="topbar-inner"><a className="brand" href="https://trafficops.io/" target="_blank" rel="noreferrer" aria-label="TrafficOps website"><img src="/favicon.svg" alt="" /><span className="brand-wordmark">Traffic<span>Ops</span></span></a><span className="brand-divider" /><span className="product-name">Landing Studio</span><div className="topbar-right"><span className="privacy"><ShieldCheck size={15} />Local by design</span>{installPrompt && <button className="btn btn-ghost btn-sm" onClick={() => perform(async () => { await installPrompt.prompt(); setInstallPrompt(null); })}><ArrowDownToLine size={15} />Install Studio</button>}<button className="btn btn-ghost btn-sm" aria-label="Open quick start guide" onClick={() => setHelp(true)}><HelpCircle size={16} />Quick start</button><a className="docs-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Docs ↗</a></div></div></header>
    <main className="workspace">
      {!host && <div className="studio-notices">{statusNotice}</div>}
      {host && <div className="studio-project-bar">{navigation}<span>{current?.kind === 'template' ? 'Reusable template' : current ? 'Landing page' : 'Folder workspace'}</span>{installedMode && <button className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => setProjectsOpen(true)}><FolderOpen size={15} />Folders</button>}</div>}
      {installedMode && reconnect && <div className="reconnect-banner"><span>Recovered folder edits are kept here. Opening the folder saves an independent recovery copy first.</span><button className="btn btn-sm" disabled={blocked} onClick={() => loadProject(reconnect)}>Reconnect folder</button></div>}
      {!ready ? <p role="status">Opening your workspace…</p> : host ? <EditorShell key={epoch} host={host} aiAllowed={installedMode} onSnapshot={rememberSnapshot} recovered={recovered} initialExpanded={installedMode} previewExpandButton={false} externalModalOpen={help || projectsOpen || Boolean(creating)} onNewProject={() => setCreating({})} newProjectCreatesCopy externalBusy={busy} onManageProjects={installedMode ? () => setProjectsOpen(true) : undefined} storageHelp={attached ? 'Edits and uploads save to this folder.' : 'Autosaved on this device. Export a source ZIP for a portable backup.'} projectSwitcher={navigation} /> : <StudioLibrary aiEnabled={installedMode} projects={library} busy={busy} onCreate={options => setCreating(options || {})} onOpen={openProject} onDuplicate={record => perform(async () => { const saved = await saveStudioProject(cloneStudioProject(record, { name: `${record.name.slice(0, 113)} (copy)` }), { expectedRevision: null }); refreshSaved(saved); })} onDelete={record => { if (window.confirm(`Delete “${record.name}” from this device? Export a source ZIP first if you need a backup.`)) perform(async () => { await deleteStudioProject(record.id); setLibrary(items => items.filter(item => item.id !== record.id)); }); }} onImport={() => archive.current.click()} onFolder={installedMode && supportsDirectoryProjects() ? addProject : undefined} />}
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    <input ref={archive} type="file" accept=".zip,application/zip" aria-label="Import project ZIP" hidden onChange={event => { importProject(event.target.files[0]); event.target.value = ''; }} />
    {creating && <CreateProjectDialog aiEnabled={installedMode} initial={creating} templates={library.filter(item => item.kind === 'template')} busy={busy} onCreate={createProject} onClose={() => setCreating(null)} />}
    {help && <TourDialog installedMode={installedMode} onClose={() => setHelp(false)} />}
    {installedMode && projectsOpen && <ProjectsDialog projects={projects} currentId={attached?.id} supported={supportsDirectoryProjects()} busy={blocked} onAdd={addProject} onOpen={loadProject} onReload={loadProject} onForget={project => perform(async () => { await forgetDirectoryProject(project.id); setProjects(items => items.filter(item => item.id !== project.id)); })} onLocation={(project, value) => perform(async () => { await updateProjectLocation(project, value); setProjects(await listDirectoryProjects()); })} onClose={() => setProjectsOpen(false)} />}
  </div>;
}
