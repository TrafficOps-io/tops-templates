import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FolderOpen, HelpCircle, KeyRound, LayoutGrid, Plus, ShieldCheck, WifiOff } from 'lucide-react';
import EditorShell from '@trafficops/template-editor-shell';
import { getConversationSession, getConversationActivity, subscribeConversationActivity, releaseConversationSession } from '@trafficops/template-editor-shell/conversation-runtime';
import { createStudioHost } from './hosts/StudioHost.js';
import { createLibraryHost } from './hosts/LibraryHost.js';
import { createStudioAiPort } from './hosts/StudioAiPort.js';
import { installedDisplayMode, watchDisplayMode } from './app-mode.js';
import { loadWorkspace, saveWorkspace } from './workspace-storage.js';
import { chooseProjectDirectory, ensureProjectPermission, forgetDirectoryProject, listDirectoryProjects, projectSnapshotEqual, readDirectoryProject, readProjectMetadata, readProjectSettings, rememberDirectoryProject, supportsDirectoryProjects, updateProjectLocation } from './directory-projects.js';
import { LIMITS, projectFolders, ConflictError } from '@trafficops/template-editor-core';
import { readPortableDirectory, saveProjectToDirectory, portableProjectRecord } from './portable-project.js';
import { cloneConversationDocument, createConversationPort, deleteConversationDocument } from './studio-conversations.js';
import { mergePortableHistory, sameProjectSnapshot } from './project-transfer.js';
import ProjectImportDialog from './ProjectImportDialog.jsx';
import { cloneStudioProject, createStudioProject, deleteStudioProject, getActiveStudioProjectId, getStudioProject, listStudioProjects, saveStudioProject, setActiveStudioProjectId } from './studio-library.js';
import { readArchive } from './hosts/read-archive.js';
import { starterProject } from './starter.js';
import { getPwaState, subscribePwa } from './pwa.js';
import StudioLibrary, { CreateProjectDialog } from './StudioLibrary.jsx';
import { AiSettingsDialog, ProjectsDialog, TourDialog } from './StudioDialogs.jsx';

export default function App() {
  const [installedMode, setInstalledMode] = useState(installedDisplayMode);
  const [host, setHost] = useState(null), [epoch, setEpoch] = useState(0), [recovered, setRecovered] = useState(null);
  const [library, setLibrary] = useState([]), [current, setCurrent] = useState(null), [ready, setReady] = useState(false);
  const [projects, setProjects] = useState([]), [attached, setAttached] = useState(null), [reconnect, setReconnect] = useState(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [help, setHelp] = useState(false), [projectsOpen, setProjectsOpen] = useState(false), [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [view, setView] = useState(null);
  const [importChoice, setImportChoice] = useState(null), [activity, setActivity] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null), [pwa, setPwa] = useState(getPwaState), [online, setOnline] = useState(navigator.onLine);
  const update = pwa.update;
  const snapshot = useRef(null), recoveryTimer = useRef(null), recoveryQueue = useRef(Promise.resolve()), restore = useRef(null), archive = useRef(null);
  const session = useRef(0), currentRef = useRef(null), busyRef = useRef(false);
  const ai = useRef(null);
  const hosts = useRef(new Map());
  function studioAi() {
    if (!installedDisplayMode()) return undefined;
    return ai.current ||= createStudioAiPort({ isEnabled: installedDisplayMode });
  }
  async function clearRecovery() {
    // A browser tab must not erase an installed app's separate folder recovery.
    if (installedDisplayMode() && (attached || recovered)) await saveWorkspace(null);
  }
  const legacyAi = !host?.conversations && Boolean(view?.aiBusy || view?.aiDraft);
  const connectionBlocked = busy || Boolean(view?.busy) || legacyAi;
  const blocked = connectionBlocked;
  const blockedReason = legacyAi ? 'Finish the current AI operation before changing projects.' : connectionBlocked ? 'Wait for the current save to finish.' : '';
  function refreshSaved(record) {
    setLibrary(items => [record, ...items.filter(item => item.id !== record.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    if (currentRef.current?.id === record.id) { currentRef.current = record; setCurrent(record); }
  }
  function mount(next, { record = null, project = null, recovery = null } = {}) {
    session.current++; clearTimeout(recoveryTimer.current); snapshot.current = null; setView(null);
    currentRef.current = record; setHost(next); setCurrent(record); setAttached(project); setRecovered(recovery); setReconnect(null); setEpoch(value => value + 1);
    if (next?.conversations) { hosts.current.set(next.conversations.projectId, next); getConversationSession(next).updateHost(next); }
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
  function folderHost(project, record, recovery = null) {
    const options = recovery ? { initial: { name: recovery.name, files: recovery.files, folders: recovery.folders || [], settings: recovery.overrides || {} }, recovery: recoveryWriter(project.id) } : { directory: project.handle };
    const next = createStudioHost({ ...options, projectId: project.id, kind: record?.kind || project.kind || 'landing', name: record?.name || project.name, createdAt: record?.createdAt, appliedAiRuns: record?.appliedAiRuns, ai: studioAi(), isDirectoryEnabled: installedDisplayMode, recovery: recoveryWriter(project.id) });
    const originalSave = next.project.save;
    let cacheRevision = record?.revision ?? null;
    next.project.save = async (...args) => {
      const cached = await getStudioProject(project.id);
      if ((cached?.revision ?? null) !== cacheRevision) throw new ConflictError('This project changed in another window. Review the device and folder copies before saving.');
      const state = await originalSave(...args);
      const candidate = createStudioProject({ ...cached, kind: cached?.kind || record?.kind || 'landing', name: state.name, files: state.files, folders: state.folders, settings: state.translations[state.locale], appliedAiRuns: state.appliedAiRuns || [] }, { id: project.id, now: cached?.createdAt || Date.now() });
      try { const saved = await saveStudioProject(candidate, { expectedRevision: cacheRevision }); cacheRevision = saved.revision; refreshSaved(saved); }
      catch (cause) { setError(`Files are saved to the folder, but the device cache could not be updated: ${cause.message}`); }
      return state;
    };
    return next;
  }
  function connectFolder(project, recovery = null, knownRecord = null) {
    if (!installedDisplayMode()) throw new Error('Project folders are available only in the installed Studio app.');
    const record = knownRecord || library.find(item => item.id === project.id) || currentRef.current;
    mount(folderHost(project, record, recovery), { record: record?.id === project.id ? record : null, project: recovery ? null : project, recovery });
    if (recovery) setReconnect(project);
  }
  useEffect(() => watchDisplayMode(setInstalledMode), []);
  useEffect(() => subscribePwa(setPwa), []);
  useEffect(() => {
    const updateActivity = () => setActivity(getConversationActivity());
    updateActivity(); return subscribeConversationActivity(updateActivity);
  }, []);
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
      if (active) {
        const project = directories.find(item => item.id === active.id);
        if (project) {
          try {
            const recovery = await loadWorkspace(active.id);
            if (await ensureProjectPermission(project.handle, { request: false })) {
              const disk = await readPortableDirectory(project.handle);
              const needsRecovery = (recovery?.dirty || recovery?.detached) && !sameProjectSnapshot({ files: recovery.files, folders: recovery.folders, settings: recovery.overrides }, disk);
              if (alive) connectFolder(project, needsRecovery ? recovery : null, active);
            } else if (alive) { connectLibrary(active); setReconnect(project); }
          } catch (cause) { if (alive) { connectLibrary(active); setReconnect(project); setError(`Your device copy is open. Reconnect the folder to resume saving there: ${cause.message}`); } }
        } else connectLibrary(active);
      }
      else if (installedDisplayMode() && workspace?.projectId && workspace.files) {
        const project = directories.find(item => item.id === workspace.projectId);
        const recoverFolder = () => {
          const record = records.find(item => item.id === workspace.projectId);
          mount(project ? folderHost(project, record, workspace) : createStudioHost({ projectId: workspace.projectId, initial: { name: workspace.name, files: workspace.files, folders: workspace.folders || [], settings: workspace.overrides || {} }, ai: studioAi(), recovery: recoveryWriter(workspace.projectId) }), { record, recovery: workspace });
          if (project) setReconnect(project);
        };
        try {
          if (project && await ensureProjectPermission(project.handle, { request: false })) {
            const disk = await readDirectoryProject(project.handle), settings = await readProjectSettings(project.handle);
            if (!alive) return;
            const same = projectSnapshotEqual({ files: workspace.files, folders: projectFolders(workspace.files, workspace.folders || []) }, { files: disk.files, folders: projectFolders(disk.files, disk.folders) }) && JSON.stringify(workspace.overrides || {}) === JSON.stringify(settings);
            connectFolder(project, (workspace.dirty || workspace.detached) && !same ? workspace : null, records.find(item => item.id === workspace.projectId));
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
  useEffect(() => {
    const warn = event => { if (getConversationActivity().length || snapshot.current?.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function rememberSnapshot(value) {
    snapshot.current = value; setView(value);
    if (currentRef.current && !attached || !installedDisplayMode()) return; // LibraryHost commits its own versioned autosaves.
    clearTimeout(recoveryTimer.current);
    const version = session.current;
    const saved = { files: value.state.files, folders: value.state.folders, overrides: value.state.translations[value.state.locale], sourceBaseline: value.baseline, name: value.state.name, projectId: attached?.id || reconnect?.id || recovered?.projectId || null, dirty: value.dirty, detached: Boolean(recovered) };
    recoveryTimer.current = setTimeout(() => {
      recoveryQueue.current = recoveryQueue.current.catch(() => {}).then(() => saveWorkspace(saved)).catch(cause => { if (session.current === version) setError(`Device recovery could not be saved: ${cause.message}`); });
    }, 250);
  }
  async function preserveCurrent() {
    const value = snapshot.current;
    if (!host?.conversations && (value?.aiBusy || value?.aiDraft)) throw new Error('Finish or discard the current operation before leaving this project.');
    clearTimeout(recoveryTimer.current); await recoveryQueue.current;
    if (!value) return;
    if (currentRef.current || attached) {
      if (value.dirty) await value.flush();
    } else {
      // A recovered folder copy remains independent until explicitly reconnected.
      const id = value.state.projectId || recovered?.projectId || crypto.randomUUID();
      const existing = await getStudioProject(id);
      const saved = await saveStudioProject(createStudioProject({ ...existing, kind: existing?.kind || 'landing', name: value.state.name || 'Recovered project', files: value.state.files, folders: value.state.folders, settings: value.state.translations[value.state.locale] }, { id }), { expectedRevision: existing?.revision ?? null });
      refreshSaved(saved);
    }
  }
  async function perform(operation) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { return await operation(); } catch (cause) { if (cause.name !== 'AbortError') setError(cause.message); } finally { busyRef.current = false; setBusy(false); }
  }
  async function openProject(record) {
    const directory = installedDisplayMode() && projects.find(item => item.id === record.id);
    if (directory) return loadProject(directory);
    await perform(async () => { await preserveCurrent(); const saved = await getStudioProject(record.id); if (!saved) throw new Error('This project was removed in another window.'); await setActiveStudioProjectId(saved.id); await clearRecovery(); connectLibrary(saved); });
  }
  async function showLibrary() {
    await perform(async () => { await preserveCurrent(); await setActiveStudioProjectId(null); await clearRecovery(); mount(null); setLibrary(await listStudioProjects()); });
  }
  async function saveConflictCopy() {
    await perform(async () => {
      const value = snapshot.current;
      if (!value || value.busy || (!host?.conversations && (value.aiBusy || value.aiDraft))) throw new Error('Finish the current save before copying this project.');
      const record = createStudioProject({ kind: currentRef.current?.kind || 'landing', name: `${value.state.name.slice(0, 108)} (recovered)`, files: value.state.files, folders: value.state.folders, settings: value.state.translations[value.state.locale] });
      const saved = await saveStudioProject(record, { expectedRevision: null });
      refreshSaved(saved); await setActiveStudioProjectId(saved.id); await clearRecovery(); connectLibrary(saved);
    });
  }
  async function createProject({ kind, mode, name, prompt, source, attachments = [], generateImages }) {
    if (busyRef.current) return;
    if (mode === 'ai' && !installedDisplayMode()) throw new Error('AI is available only in the installed Studio app.');
    if (!name && mode === 'ai') name = prompt.trim().split('\n')[0].replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80) || 'New AI project';
    if (!name) throw new Error('Give your project a name.');
    if (mode === 'ai' && !prompt) throw new Error('Describe what you want to create.');
    if (mode === 'template' && !source) throw new Error('Choose a starting template.');
    busyRef.current = true; setBusy(true);
    try {
      if (mode === 'template' && !source.builtin) { source = await getStudioProject(source.id); if (!source || source.kind !== 'template') throw new Error('This template is no longer available. Choose another starting point.'); }
      await preserveCurrent();
      const candidate = mode === 'template' ? cloneStudioProject(source, { kind, name }) : createStudioProject({ kind, name, files: starterProject(true), folders: [], settings: {}, ...(mode === 'ai' ? { aiPrompt: prompt, aiStarted: false, aiAttachments: attachments, aiGenerateImages: generateImages } : {}) });
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
      const existing = imported.metadata ? await getStudioProject(imported.metadata.projectId) : null;
      if (existing) setImportChoice({ imported, existing, fileName: file.name });
      else await installImported(imported, { name: imported.metadata?.name || file.name.replace(/\.zip$/i, '').slice(0, 120) || 'Imported project' });
    });
  }
  async function installImported(imported, { copy = false, name, kind, existing, directory } = {}) {
    if (directory && !copy && !sameProjectSnapshot(imported, await readPortableDirectory(directory.handle))) throw new Error('The folder changed while you reviewed it. Open the folder again to review the latest files.');
    if (directory && !Object.keys(imported.files).length) imported = { ...imported, files: starterProject(true) };
    const portable = portableProjectRecord(imported, { copy, name: copy && existing ? `${existing.name.slice(0, 108)} (copy)` : name, kind });
    let previous = await getStudioProject(portable.record.id);
    if (existing && !copy && previous?.revision !== existing.revision) throw new Error('This project changed while you reviewed the import. Open it and import the ZIP again.');
    const conversationPort = createConversationPort({ projectId: portable.record.id, kind: portable.record.kind, name: portable.record.name });
    if (portable.conversations) {
      const local = await conversationPort.load();
      await conversationPort.save(mergePortableHistory(local, portable.conversations), { expectedRevision: local.revision });
    }
    const saved = await saveStudioProject(portable.record, { expectedRevision: previous?.revision ?? null });
    refreshSaved(saved); await setActiveStudioProjectId(saved.id); await clearRecovery();
    if (directory && !copy) {
      const remembered = await rememberDirectoryProject(directory.handle, projects, { projectId: saved.id });
      setProjects(items => [remembered, ...items.filter(item => item.id !== remembered.id)]);
      connectFolder(remembered, null, saved);
    } else {
      // Continuing a ZIP explicitly selects device storage. The old folder remains
      // on disk; removing its binding prevents a second writable location.
      if (!copy && projects.some(item => item.id === saved.id)) { await forgetDirectoryProject(saved.id); setProjects(items => items.filter(item => item.id !== saved.id)); }
      connectLibrary(saved);
    }
    setProjectsOpen(false); setImportChoice(null);
  }
  async function acceptImport(action, kind) {
    const choice = importChoice;
    await perform(async () => {
      await preserveCurrent();
      if (choice.transfer) return completeFolderTransfer(choice.record, choice.directory.handle, choice.disk);
      await installImported(choice.imported, { copy: action === 'copy', existing: choice.existing, directory: choice.directory, kind });
    });
  }
  async function loadProject(project) {
    await perform(async () => {
      if (!installedDisplayMode()) throw new Error('Project folders are available only in the installed Studio app.');
      const permission = await ensureProjectPermission(project.handle);
      await preserveCurrent();
      let imported;
      try {
        if (!permission) throw new Error(`Studio needs read and write access to ${project.name}.`);
        imported = await readPortableDirectory(project.handle);
      } catch (cause) {
        const cached = await getStudioProject(project.id);
        if (!cached) throw cause;
        await setActiveStudioProjectId(cached.id); connectLibrary(cached); setReconnect(project); setProjectsOpen(false);
        setError(`Your device copy is open. Reconnect the folder to resume saving there: ${cause.message}`); return;
      }
      const id = imported.metadata?.projectId || project.id;
      const existing = await getStudioProject(id);
      const binding = projects.find(item => item.id === id);
      const sameBinding = binding && await binding.handle.isSameEntry(project.handle).catch(() => false);
      const recovery = await loadWorkspace(id);
      if (existing && ((!sameBinding && binding) || !sameProjectSnapshot(existing, imported) || recovery?.dirty)) {
        setImportChoice({ imported: { ...imported, metadata: imported.metadata || { schema: 1, projectId: id, kind: existing.kind, name: existing.name, contentRevision: 0, metadataRevision: 0 } }, existing, directory: project, fileName: project.name });
        return;
      }
      if (existing) {
        const remembered = await rememberDirectoryProject(project.handle, [project, ...projects], { projectId: id });
        await setActiveStudioProjectId(id); connectFolder(remembered, null, existing); setProjects(items => [remembered, ...items.filter(item => item.id !== id)]); setProjectsOpen(false);
      } else await installImported({ ...imported, metadata: imported.metadata || { schema: 1, projectId: id, kind: 'landing', name: project.name, contentRevision: 0, metadataRevision: 0 } }, { directory: project });
    });
  }
  async function addProject() {
    if (blocked || !installedDisplayMode()) return;
    try {
      const handle = await chooseProjectDirectory(), metadata = await readProjectMetadata(handle);
      let known;
      for (const project of projects) if (await project.handle.isSameEntry(handle).catch(() => false)) { known = project; break; }
      await loadProject({ ...known, id: metadata?.projectId || known?.id || crypto.randomUUID(), name: handle.name, handle });
    }
    catch (cause) { if (cause.name !== 'AbortError') setError(cause.message); }
  }
  async function duplicateProject(record) {
    await perform(async () => {
      const latest = await getStudioProject(record.id);
      if (!latest) throw new Error('This project no longer exists.');
      const saved = await saveStudioProject(cloneStudioProject(latest, { name: `${latest.name.slice(0, 108)} (copy)` }), { expectedRevision: null });
      const sourcePort = createConversationPort({ projectId: latest.id }), destination = createConversationPort({ projectId: saved.id });
      const document = cloneConversationDocument(await sourcePort.load(), saved.id);
      if (document.threads.length) await destination.save(document, { expectedRevision: 0 });
      refreshSaved(saved);
    });
  }
  async function deleteProject(record) {
    const running = getConversationActivity().filter(run => run.projectId === record.id);
    if (!window.confirm(`Remove “${record.name}” and its dialogue history from this device?${running.length ? ' Its active AI runs will stop.' : ''} Connected folder files remain on your computer.`)) return;
    await perform(async () => {
      releaseConversationSession(record.id); hosts.current.delete(record.id);
      await deleteConversationDocument(record.id); await deleteStudioProject(record.id); await forgetDirectoryProject(record.id);
      setProjects(items => items.filter(item => item.id !== record.id)); setLibrary(items => items.filter(item => item.id !== record.id));
    });
  }
  async function updateStudio() {
    if (getConversationActivity().length && !window.confirm('Updating Studio interrupts active AI runs. Saved messages and drafts stay available; continuing generation requires another request. Update now?')) return;
    await perform(async () => {
      await preserveCurrent();
      for (const run of getConversationActivity()) await getConversationSession(hosts.current.get(run.projectId)).stop(run.runId);
      const started = Date.now();
      while (getConversationActivity().length && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 50));
      if (getConversationActivity().length) throw new Error('AI runs are still stopping. Wait a moment and update again.');
      await update(true);
    });
  }
  async function saveToFolder() {
    if (blocked || !installedDisplayMode()) return;
    // The picker must open in the click's user activation, before asynchronous saves.
    let handle;
    try { handle = await chooseProjectDirectory(); } catch (cause) { if (cause.name !== 'AbortError') setError(cause.message); return; }
    await perform(async () => {
      await preserveCurrent();
      const record = currentRef.current || await getStudioProject(snapshot.current?.state.projectId);
      if (!record) throw new Error('Save the project on this device before connecting a folder.');
      const disk = await readPortableDirectory(handle);
      if (disk.metadata && disk.metadata.projectId !== record.id) throw new Error('This folder belongs to another project. Choose an empty folder for this project.');
      if ((Object.keys(disk.files).length || disk.folders.length || Object.keys(disk.settings).length) && !sameProjectSnapshot(disk, record)) {
        setImportChoice({ transfer: true, record, disk, directory: { handle }, existing: { ...disk, name: handle.name }, imported: record, fileName: handle.name }); return;
      }
      await completeFolderTransfer(record, handle);
    });
  }
  async function completeFolderTransfer(record, handle, expectedSnapshot) {
    const latest = await getStudioProject(record.id);
    if (!latest || latest.revision !== record.revision) throw new Error('The project changed during folder selection. Save to a folder again with the latest files.');
    const port = host?.conversations?.projectId === record.id ? host.conversations : createConversationPort({ projectId: record.id });
    const document = await port.load();
    await saveProjectToDirectory({ record, handle, conversations: document, expectedSnapshot });
    const afterCopy = await getStudioProject(record.id);
    if (!afterCopy || afterCopy.revision !== record.revision) throw new ConflictError('The device project changed in another window during transfer. The copied folder is retained; review both copies before reconnecting.');
    const remembered = await rememberDirectoryProject(handle, projects, { projectId: record.id });
    setProjects(items => [remembered, ...items.filter(item => item.id !== record.id)]);
    await setActiveStudioProjectId(record.id); connectFolder(remembered, null, record); setProjectsOpen(false); setImportChoice(null);
    // Any checkpoint produced during the copy is mirrored by the newly bound port.
    await getConversationSession(hosts.current.get(record.id)).ready;
    await hosts.current.get(record.id).conversations.load();
  }
  const statusNotice = <>{installedMode && <button type="button" className="btn btn-ghost btn-sm" disabled={connectionBlocked} title={connectionBlocked ? blockedReason : undefined} onClick={() => setAiSettingsOpen(true)}><KeyRound size={15} />OpenRouter</button>}{view?.conflict && <button className="btn btn-outline btn-xs" disabled={blocked} onClick={saveConflictCopy}>Save as new project</button>}{pwa.error && <span className="studio-app-error" role="status">{pwa.error.operation === 'register' ? 'Offline setup failed' : 'Update check failed'}: {pwa.error.message}</span>}{!online && <span className="studio-network" role="status"><WifiOff size={14} />Offline · local editing available</span>}{update && <button className="btn btn-primary btn-xs" disabled={blocked} title={blocked ? blockedReason : undefined} onClick={updateStudio}>Update Studio</button>}{error && <span className="studio-app-error" role="alert">{error}<button className="text-link" onClick={() => setError('')}>Dismiss</button></span>}</>;
  const helpButton = <button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Open quick start guide" title="Quick start and documentation" onClick={() => setHelp(true)}><HelpCircle size={16} /></button>;
  const navigation = <div className="studio-navigation"><button className="btn btn-ghost btn-sm" disabled={blocked} title={blocked ? blockedReason : undefined} onClick={showLibrary}><LayoutGrid size={16} />Projects</button><button className="btn btn-ghost btn-sm" disabled={blocked} title={blocked ? blockedReason : undefined} onClick={() => setCreating({})}><Plus size={16} />New project</button>{current && library.length > 1 && <select className="select select-sm" aria-label="Switch project" disabled={blocked} value={current.id} onChange={event => openProject(library.find(record => record.id === event.target.value))}>{library.map(record => <option key={record.id} value={record.id}>{record.name}{activity.some(run => run.projectId === record.id) ? ' · AI working' : ''}</option>)}</select>}{installedMode && attached && <button type="button" className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => setProjectsOpen(true)}><FolderOpen size={15} />Save location</button>}{statusNotice}{installedMode && helpButton}</div>;
  return <div className={`studio editor-root ${installedMode ? 'installed-app' : ''} ${host && installedMode ? 'is-editor' : ''}`}>
    {!(host && installedMode) && <header className="topbar"><div className="topbar-inner"><a className="brand" href="https://trafficops.io/" target="_blank" rel="noreferrer" aria-label="TrafficOps website"><img src="/favicon.svg" alt="" /><span className="brand-wordmark">Traffic<span>Ops</span></span></a><span className="brand-divider" /><span className="product-name">Landing Studio</span><div className="topbar-right"><span className="privacy"><ShieldCheck size={15} />Local by design</span>{installPrompt && <button className="btn btn-ghost btn-sm" onClick={() => perform(async () => { await installPrompt.prompt(); setInstallPrompt(null); })}><ArrowDownToLine size={15} />Install Studio</button>}<button className="btn btn-ghost btn-sm" aria-label="Open quick start guide" onClick={() => setHelp(true)}><HelpCircle size={16} />Quick start</button><a className="docs-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Docs ↗</a></div></div></header>}
    <main className="workspace">
      {!host && <div className="studio-notices">{statusNotice}</div>}
      {host && !installedMode && <div className="studio-project-bar">{navigation}<span>{current?.kind === 'template' ? 'Reusable template' : current ? 'Landing page' : 'Folder workspace'}</span>{installedMode && <button className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => setProjectsOpen(true)}><FolderOpen size={15} />Folders</button>}</div>}
      {installedMode && reconnect && <div className="reconnect-banner"><span>Your device copy is open. Reconnect its folder to review changes and resume saving there.</span><button className="btn btn-sm" disabled={blocked} onClick={() => loadProject(reconnect)}>Reconnect folder</button></div>}
      {!ready ? <p role="status">Opening your workspace…</p> : host ? <EditorShell key={epoch} host={host} aiAllowed={installedMode} onSnapshot={rememberSnapshot} recovered={recovered} presentation={installedMode ? 'app' : 'embedded'} previewExpandButton={false} externalModalOpen={aiSettingsOpen || help || projectsOpen || Boolean(creating) || Boolean(importChoice)} onNewProject={() => setCreating({})} onImportProject={importProject} newProjectCreatesCopy externalBusy={busy} onManageProjects={installedMode ? () => setProjectsOpen(true) : undefined} onSaveToFolder={installedMode && supportsDirectoryProjects() ? saveToFolder : undefined} storageSummary={attached ? `Folder: ${attached.displayPath || attached.name}` : 'Saved on this device'} storageHelp={attached ? 'Files and dialogue history save to this folder. Your device keeps a recovery copy.' : 'Autosaved on this device. Save to a folder to continue this same project on your computer.'} projectSwitcher={navigation} /> : <StudioLibrary aiEnabled={installedMode} aiSettings={installedMode ? studioAi()?.settings : undefined} onCreateWithAi={createProject} activity={activity} directories={projects} projects={library} busy={busy} onCreate={options => setCreating(options || {})} onOpen={openProject} onDuplicate={duplicateProject} onDelete={deleteProject} onImport={() => archive.current.click()} onFolder={installedMode && supportsDirectoryProjects() ? addProject : undefined} />}
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    <input ref={archive} type="file" accept=".zip,application/zip" aria-label="Import project ZIP" hidden onChange={event => { importProject(event.target.files[0]); event.target.value = ''; }} />
    {importChoice && <ProjectImportDialog choice={importChoice} busy={busy} onChoose={acceptImport} onClose={() => setImportChoice(null)} />}
    {creating && <CreateProjectDialog aiEnabled={installedMode} aiSettings={installedMode ? studioAi()?.settings : undefined} initial={creating} templates={library.filter(item => item.kind === 'template')} busy={busy} onCreate={createProject} onClose={() => setCreating(null)} />}
    {installedMode && aiSettingsOpen && <AiSettingsDialog ai={studioAi()} onClose={() => setAiSettingsOpen(false)} />}
    {help && <TourDialog installedMode={installedMode} onClose={() => setHelp(false)} />}
    {installedMode && projectsOpen && <ProjectsDialog projects={projects} currentId={attached?.id} supported={supportsDirectoryProjects()} busy={blocked} onAdd={addProject} onOpen={loadProject} onReload={loadProject} onForget={project => perform(async () => { await forgetDirectoryProject(project.id); setProjects(items => items.filter(item => item.id !== project.id)); })} onLocation={(project, value) => perform(async () => { await updateProjectLocation(project, value); setProjects(await listDirectoryProjects()); })} onClose={() => setProjectsOpen(false)} />}
  </div>;
}
