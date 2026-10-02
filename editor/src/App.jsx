import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import EditorShell from '@trafficops/template-editor-shell';
import { getConversationSession, getConversationActivity, subscribeConversationActivity, releaseConversationSession } from '@trafficops/template-editor-shell/conversation-runtime';
import { createFolderHost } from './hosts/FolderHost.js';
import { createStudioAiPort } from './hosts/StudioAiPort.js';
import { installedDisplayMode, watchDisplayMode } from './app-mode.js';
import { LIMITS, conversationDocumentFromFiles } from '@trafficops/template-editor-core';
import { readArchive } from './hosts/read-archive.js';
import { classifyFolder, deleteOpfsRoot, persistStorage, pickFolder, requestAccess, storageMode } from './storage/roots.js';
import { forgetOpfsOpened, forgetRecent, rememberOpfsOpened, rememberRecent } from './storage/recent.js';
import { readProjectTree } from './storage/files.js';
import { readProjectMeta, readValues } from './storage/project-meta.js';
import { adoptFolder, copyProject, createProjectInRoot, interruptImportedRuns, listKnownProjects, makeIndependent, remapConversation } from './storage/project-root.js';
import { LAST_PROJECT_KEY, accessLost, accessProblem, duplicateDecision, duplicatePermissionPlan, importIdentity, openFolderDecision, pendingEditsApply, reconnectDecision, reopenCandidate, rootReachable, storageLabels } from './storage/flows.js';
import { useFolderChoice } from './useFolderChoice.js';
import { AppHeader, ProjectNavigation, StatusNotices } from './AppChrome.jsx';
import { starterProject } from './starter.js';
import { getPwaState, subscribePwa } from './pwa.js';
import StudioLibrary, { CreateProjectDialog } from './StudioLibrary.jsx';
import { briefAttachments } from './HomeProjectChat.jsx';
import { AiSettingsDialog, TourDialog } from './StudioDialogs.jsx';
import FolderChoiceDialog from './FolderChoiceDialog.jsx';
import UnsupportedBrowser from './UnsupportedBrowser.jsx';
import { StudioUiProvider } from '@trafficops/studio-ui/i18n';
import { Skeleton } from '@trafficops/studio-ui/primitives';

const NEEDS_ACCESS = 'Studio needs permission to use this folder. Open it again and allow access, reconnect it, or remove it from the list.';
const MISSING = 'The folder was moved, renamed or deleted. Reconnect it, or remove it from the list.';
const problemOf = (kind, message) => ({ kind, message: message || (kind === 'permission' ? NEEDS_ACCESS : MISSING) });
const LOST = 'Studio can no longer reach this project folder. Editing is paused; reconnect the folder to resume saving.';
const cancelled = () => new DOMException('The operation was cancelled.', 'AbortError');
const projectName = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) || 'Untitled project';
const without = (items, key) => { if (!Object.hasOwn(items, key)) return items; const { [key]: _removed, ...rest } = items; return rest; };
const lastProject = {
  get() { try { return localStorage.getItem(LAST_PROJECT_KEY); } catch { return null; } },
  set(projectId) { try { if (projectId) localStorage.setItem(LAST_PROJECT_KEY, projectId); else localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* Storage blocked: no auto-reopen. */ } },
};

export default function App() {
  const [installedMode, setInstalledMode] = useState(installedDisplayMode);
  const [mode, setMode] = useState(null), [host, setHost] = useState(null), [epoch, setEpoch] = useState(0);
  const [known, setKnown] = useState([]), [current, setCurrent] = useState(null), [ready, setReady] = useState(false);
  const [problems, setProblems] = useState({}), [lost, setLost] = useState(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false), [help, setHelp] = useState(false), [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [view, setView] = useState(null), [activity, setActivity] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null), [pwa, setPwa] = useState(getPwaState), [online, setOnline] = useState(navigator.onLine);
  const update = pwa.update;
  const archive = useRef(null), snapshot = useRef(null), currentRef = useRef(null), busyRef = useRef(false), lostRef = useRef(null), modeRef = useRef(null), boot = useRef(null);
  const ai = useRef(null), hosts = useRef(new Map()), queuedImports = useRef([]), importNext = useRef(null);
  const folders = useFolderChoice(() => modeRef.current), folderChoice = folders.choice;
  // Spec A7: the AI port is always available; installedDisplayMode() only drives install and window chrome.
  function studioAi() { return ai.current ||= createStudioAiPort(); }
  const blocked = busy || Boolean(view?.busy);
  const blockedReason = blocked ? 'Wait for the current save to finish.' : '';

  // Hosts stay registered per projectId while their AI runs work in the background; a reopened project rebinds its
  // session. After a switch, the hosts (stores, channels) and sessions of idle projects are released.
  useEffect(() => {
    const current = host?.conversations?.projectId, active = new Set(getConversationActivity().map(run => run.projectId));
    for (const [id, kept] of hosts.current) {
      if (id === current || active.has(id)) continue;
      releaseConversationSession(id); kept.dispose?.(); hosts.current.delete(id);
    }
  }, [host]);
  function mount(next, entry = null) {
    snapshot.current = null; setView(null); lostRef.current = null; setLost(null);
    currentRef.current = entry; setHost(next); setCurrent(entry); setEpoch(value => value + 1);
    lastProject.set(entry?.projectId);
    if (next?.conversations) {
      const id = next.conversations.projectId, previous = hosts.current.get(id);
      hosts.current.set(id, next); getConversationSession(next).updateHost(next);
      if (previous && previous !== next) previous.dispose?.();
    }
  }
  // A folder that disappears or loses permission pauses the editor (read-only, no autosave) until it is reconnected.
  // A deleted folder can first look like missing metadata (a conflict), so other failures probe the root; a lost
  // folder is reported as such, not as a conflict.
  // The values last loaded or saved are kept for reconnecting (unsaved edits are written only over unchanged values).
  function watchAccess(next, projectId, root) {
    let savedValues;
    const guard = operation => async (...args) => {
      try {
        const result = await operation(...args);
        if (result?.translations) savedValues = result.translations[result.locale] || {};
        return result;
      } catch (cause) {
        if (cause?.name === 'AbortError' || cause?.code === 'abort') throw cause;
        if (!accessLost(cause) && await rootReachable(root).catch(() => true)) throw cause;
        folderLost(projectId);
        throw new Error(LOST, { cause });
      }
    };
    return { ...next, savedValues: () => savedValues, project: { ...next.project, open: guard(next.project.open), save: guard(next.project.save) } };
  }
  function folderLost(projectId) {
    if (currentRef.current?.projectId !== projectId || lostRef.current) return;
    lostRef.current = { projectId }; setLost(lostRef.current);
  }
  async function refreshKnown() {
    try { setKnown(await listKnownProjects()); } catch (cause) { setError(`Could not list your projects: ${cause.message}`); }
  }
  const rootSource = () => modeRef.current === 'opfs' ? 'opfs' : 'folder';
  // "Save as template" asks the App for a new root (spec A4): the picker opens in that dialog's submit.
  async function folderHost(root, meta) {
    const next = await createFolderHost({ root, meta, ai: studioAi(), createProjectRoot: ({ kind, name }) => folders.createRoot(kind, name), onProjectCreated: (created, target) => remember(created, target) });
    return watchAccess(next, meta.projectId, root);
  }
  // A project written to a new root without opening it (template, duplicate): list it.
  async function remember(meta, root) {
    if (rootSource() === 'folder') await rememberRecent({ projectId: meta.projectId, name: meta.name, kind: meta.kind, handle: root });
    else persistStorage();
    await refreshKnown();
  }
  function markProblem(projectId, problem) { setProblems(items => ({ ...items, [projectId]: problem })); }
  // A project that cannot open: its card explains why; with a project open (the switcher), the editor shows it too.
  async function cannotOpen(entry, problem) {
    markProblem(entry.projectId, problem);
    if (currentRef.current) setError(`Could not open “${entry.name}”: ${problem.message}`);
    await refreshKnown();
  }
  // Opens a project root; folder roots are remembered (and their lastOpenedAt refreshed) in the recent registry, OPFS
  // opens in localStorage, so the opened project moves up the list either way.
  async function enter(root, meta, source) {
    const entry = { projectId: meta.projectId, name: meta.name, kind: meta.kind, source, handle: root };
    if (source === 'folder') await rememberRecent({ projectId: entry.projectId, name: entry.name, kind: entry.kind, handle: root });
    else rememberOpfsOpened(entry.projectId);
    const next = await folderHost(root, meta);
    setProblems(items => without(items, entry.projectId));
    mount(next, entry); setCreating(null);
    await refreshKnown();
  }
  useEffect(() => watchDisplayMode(setInstalledMode), []);
  useEffect(() => subscribePwa(setPwa), []);
  useEffect(() => {
    const updateActivity = () => setActivity(getConversationActivity());
    updateActivity(); return subscribeConversationActivity(updateActivity);
  }, []);
  useEffect(() => {
    let alive = true;
    boot.current ||= (async () => {
      const storage = await storageMode();
      return { storage, projects: storage === 'unsupported' ? [] : await listKnownProjects() };
    })();
    boot.current.then(async ({ storage, projects }) => {
      if (!alive) return;
      modeRef.current = storage; setMode(storage); setKnown(projects);
      // Reopen the last project only without a prompt: a permission request needs a click.
      const entry = reopenCandidate(projects, lastProject.get());
      if (entry) {
        try {
          const check = reconnectDecision(entry.projectId, await classifyFolder(entry.handle));
          if (!alive) return;
          if (check.ok) await enter(entry.handle, check.meta, entry.source); else markProblem(entry.projectId, problemOf('missing', check.message));
        } catch (cause) { if (alive) { const kind = accessProblem(cause); if (kind) markProblem(entry.projectId, problemOf(kind)); else setError(`Could not reopen ${entry.name}: ${cause.message}`); } }
      }
      if (alive) setReady(true);
    }).catch(cause => { if (alive) { setError(`Could not open Studio storage: ${cause.message}`); setReady(true); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const install = event => { event.preventDefault(); setInstallPrompt(event); };
    const network = () => setOnline(navigator.onLine);
    window.addEventListener('beforeinstallprompt', install);
    window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('online', network); window.removeEventListener('offline', network); };
  }, []);
  useEffect(() => {
    const warn = event => { if (getConversationActivity().length || snapshot.current?.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function rememberSnapshot(value) { snapshot.current = value; setView(value); }
  // Saves the open editor before another project replaces it. An unreachable folder cannot be saved: ask first.
  async function preserveCurrent() {
    const value = snapshot.current;
    if (!value?.dirty) return;
    if (lostRef.current) {
      if (!window.confirm('This project folder is unavailable, so your latest edits are not saved. Leave the project anyway?')) throw cancelled();
      return;
    }
    await value.flush();
  }
  // run: one App operation at a time; errors propagate (dialogs show them). perform: errors show in the App notice.
  async function run(operation) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { return await operation(); } finally {
      busyRef.current = false; setBusy(false);
      // A ZIP chosen while Studio was busy is imported once it is idle.
      if (queuedImports.current.length) setTimeout(() => importNext.current?.(queuedImports.current.shift()), 0);
    }
  }
  function perform(operation) {
    return run(operation).catch(cause => { if (cause?.name !== 'AbortError') setError(cause?.message || String(cause)); });
  }

  // Creation from the dialog and the home prompt. Validation is synchronous; chooseRoot opens the picker before any
  // await, and the brief's attachment files are read only afterwards (spec A8). A user template arrives already read (spec A2).
  function createProject({ kind = 'landing', mode: creation, name, prompt = '', source, attachmentFiles = [], useOnPage = false, generateImages }) {
    if (busyRef.current) return;
    if (!name && creation === 'ai') name = prompt.trim().split('\n')[0].replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80) || 'New AI project';
    if (!name) throw new Error('Give your project a name.');
    if (creation === 'ai' && !prompt) throw new Error('Describe what you want to create.');
    if (creation === 'template' && !source) throw new Error('Choose a starting template.');
    if (creation === 'template' && !source.files) throw new Error('Studio needs access to this template: choose it again.');
    const rooting = folders.chooseRoot(kind, name);
    return run(async () => {
      const chosen = await rooting;
      if (chosen?.open) { await openRoot(chosen.open, chosen.classification); return; }
      // A root made for this create is removed again when the create stops before writing (best effort).
      await folders.withRoot(chosen, async root => {
        const attachments = creation === 'ai' ? await briefAttachments(attachmentFiles, useOnPage) : [];
        await preserveCurrent();
        const template = creation === 'template' ? source : null;
        const meta = await createProjectInRoot(root, { kind, name, files: template ? template.files : starterProject(true), folders: template?.folders || [], values: template?.settings,
          ...(template && !template.builtin ? { sourceTemplateId: template.id } : {}),
          ...(creation === 'ai' ? { brief: { id: crypto.randomUUID(), prompt, mode: 'create', generateImages, attachments } } : {}) });
        if (rootSource() === 'opfs') persistStorage();
        await enter(root, meta, rootSource());
      });
    }).catch(cause => { if (cause?.name !== 'AbortError') throw cause; });
  }
  // A picked folder: a project opens (copies made outside Studio are offered "Make independent"), other files are
  // adopted in place, an empty folder gets a blank project.
  async function openRoot(handle, classification) {
    const decision = openFolderDecision(classification || await classifyFolder(handle));
    if (decision.action === 'damaged') throw new Error(`This folder holds a damaged Studio project: ${decision.error}`);
    await preserveCurrent();
    if (decision.action === 'adopt') return enter(handle, await adoptFolder(handle, { name: projectName(handle.name) }), 'folder');
    if (decision.action === 'blank') return enter(handle, await createProjectInRoot(handle, { name: projectName(handle.name), files: starterProject(true) }), 'folder');
    const original = (await listKnownProjects()).find(entry => entry.projectId === decision.meta.projectId);
    if ((await duplicateDecision(original, handle)).action === 'make-independent') {
      const answer = await folders.ask({ title: `This folder is a copy of ${original.name}`, message: `“${handle.name}” has the same project identity as “${original.name}”, which Studio already knows. To open it, make it independent: it gets its own identity and its own copy of the dialogue history. The original stays unchanged.`, actions: [{ id: 'independent', label: 'Make independent', primary: true }] });
      if (answer.id !== 'independent') return;
      return enter(handle, await makeIndependent(handle), 'folder');
    }
    return enter(handle, decision.meta, 'folder');
  }
  function openFolder() {
    if (busyRef.current) return;
    const picking = pickFolder();
    return perform(async () => { const handle = await picking; if (handle) await openRoot(handle); });
  }
  // A library card: the permission prompt opens in this click (spec A8).
  function openKnown(entry) {
    if (busyRef.current || !entry) return;
    const asking = requestAccess(entry.handle);
    return perform(async () => {
      if (await asking.catch(() => 'denied') !== 'granted') return cannotOpen(entry, problemOf('permission'));
      let classification;
      try { classification = await classifyFolder(entry.handle); } catch (cause) { const kind = accessProblem(cause); if (!kind) throw cause; return cannotOpen(entry, problemOf(kind)); }
      const check = reconnectDecision(entry.projectId, classification);
      if (!check.ok) return cannotOpen(entry, problemOf('missing', check.message));
      await preserveCurrent();
      await enter(entry.handle, check.meta, entry.source);
    });
  }
  // "Folder unavailable" card: pick the folder again; it must hold the same projectId.
  function reconnect(entry) {
    if (busyRef.current) return;
    const picking = pickFolder();
    return perform(async () => {
      const handle = await picking;
      if (!handle) return;
      const check = reconnectDecision(entry.projectId, await classifyFolder(handle));
      if (!check.ok) throw new Error(check.message);
      await preserveCurrent();
      await enter(handle, check.meta, 'folder');
    });
  }
  // The open project lost its folder. Unsaved edits are written to the reconnected folder when its files still match
  // what the editor last saved; otherwise the user decides whether to discard them.
  function reconnectCurrent() {
    const entry = currentRef.current;
    if (busyRef.current || !entry) return;
    const picking = entry.source === 'folder' ? pickFolder() : Promise.resolve(entry.handle);
    return perform(async () => {
      const handle = await picking;
      if (!handle) return;
      const check = reconnectDecision(entry.projectId, await classifyFolder(handle));
      if (!check.ok) throw new Error(check.message);
      if (entry.source === 'folder') await rememberRecent({ projectId: entry.projectId, name: check.meta.name, kind: check.meta.kind, handle });
      const next = await folderHost(handle, check.meta);
      const pending = snapshot.current?.dirty ? snapshot.current : null;
      if (pending) {
        const opened = await next.project.open();
        if (pendingEditsApply(pending.baseline, opened.files, host?.savedValues?.(), opened.translations?.[opened.locale])) await next.project.save({ ...pending.state, revision: opened.revision });
        else if (!window.confirm('The folder’s files or values changed while it was unavailable. Open the folder version and discard your unsaved edits? Cancel keeps them here so you can export a ZIP first.')) { next.dispose?.(); return; }
      }
      mount(next, { ...entry, name: check.meta.name, kind: check.meta.kind, handle });
      await refreshKnown();
    });
  }
  // Forgets a listed project: its conversation session stops; a folder stays on disk, an OPFS root is deleted.
  async function forget(entry) {
    releaseConversationSession(entry.projectId); hosts.current.get(entry.projectId)?.dispose?.(); hosts.current.delete(entry.projectId);
    if (entry.source === 'opfs') { await deleteOpfsRoot(entry.folderName || entry.handle.name); forgetOpfsOpened(entry.projectId); } else await forgetRecent(entry.projectId);
    setProblems(items => without(items, entry.projectId));
    if (lastProject.get() === entry.projectId) lastProject.set(null);
    await refreshKnown();
  }
  function removeFromList(entry) { return perform(() => forget(entry)); }
  function deleteProject(entry) {
    const stops = getConversationActivity().some(run => run.projectId === entry.projectId) ? ' Its active AI runs will stop.' : '';
    const question = entry.source === 'opfs' ? `Delete “${entry.name}” and its dialogue history from this browser? This cannot be undone.${stops}` : `Remove “${entry.name}” from Studio? The folder stays on your disk.${stops}`;
    if (!window.confirm(question)) return;
    return perform(() => forget(entry));
  }

  // Spec A2: choosing a user template is its own click. Access is asked in it; the files and values are read into memory
  // (no history), so the Create click can open the picker for the new project.
  function loadTemplate(entry) {
    const asking = requestAccess(entry.handle);
    return (async () => {
      if (await asking.catch(() => 'denied') !== 'granted') throw new Error(`Studio needs permission to read the template “${entry.name}”.`);
      const meta = await readProjectMeta(entry.handle);
      if (meta?.projectId !== entry.projectId || meta.kind !== 'template') throw new Error('This template is no longer available. Choose another starting point.');
      const [tree, values] = await Promise.all([readProjectTree(entry.handle), readValues(entry.handle)]);
      return { id: entry.projectId, name: meta.name, kind: 'template', builtin: false, files: tree.files, folders: tree.folders, settings: values };
    })();
  }
  function startFromTemplate(entry) {
    if (busyRef.current) return;
    const reading = loadTemplate(entry);
    return perform(async () => setCreating({ mode: 'template', source: await reading }));
  }

  // Spec A1 + A8: the archive is read first; its "Import {name}" dialog then picks the new root in its own click.
  function importArchive(file) {
    if (!file) return;
    if (busyRef.current) { queuedImports.current.push(file); return; }
    return perform(async () => {
      if (file.size > LIMITS.portableArchive) throw new Error('Project ZIPs must be 512 MiB or smaller.');
      const imported = await readArchive(new Uint8Array(await file.arrayBuffer()), { history: true });
      return { imported, name: projectName(imported.metadata?.name || file.name.replace(/\.zip$/i, '')) };
    }).then(result => result && confirmImport(result));
  }
  importNext.current = importArchive;
  async function confirmImport({ imported, name }) {
    const kind = imported.metadata?.kind, history = Boolean(imported.conversationFiles?.threads.length);
    const label = rootSource() === 'opfs' ? 'Import' : 'Choose folder…';
    const where = rootSource() === 'opfs' ? 'It is stored in this browser.' : 'Choose an empty folder for it; Studio never overwrites an existing project.';
    const answer = await folders.ask(kind
      ? { title: `Import ${name}`, message: `Studio creates a new ${kind === 'template' ? 'template' : 'project'} from this ZIP${history ? ', with its dialogue history' : ''}. ${where}`, actions: [{ id: 'import', label, primary: true, root: { kind, name } }] }
      : { title: `Import ${name}`, message: `This ZIP holds plain files. Import them as a landing page or as a reusable template. ${where}`, actions: [{ id: 'template', label: 'Import as template', root: { kind: 'template', name } }, { id: 'landing', label: 'Import as landing', primary: true, root: { kind: 'landing', name } }] });
    if (!answer.rooting) return;
    return perform(async () => folders.withRoot(await answer.rooting, async root => {
      // A projectId Studio already knows becomes a copy: new identity, remapped history (spec A1).
      const identity = importIdentity(imported.metadata, (await listKnownProjects()).map(entry => entry.projectId));
      let conversations = imported.conversationFiles ? await conversationDocumentFromFiles(imported.conversationFiles, imported.metadata.projectId) : null;
      if (conversations) conversations = identity.copy ? remapConversation(conversations, identity.projectId) : interruptImportedRuns(conversations);
      await preserveCurrent();
      const meta = await createProjectInRoot(root, { projectId: identity.projectId, kind: kind || (answer.id === 'template' ? 'template' : 'landing'), name: identity.copy ? `${name.slice(0, 108)} (copy)` : name,
        files: imported.files, folders: imported.folders, values: imported.settings, sourceTemplateId: imported.metadata?.sourceTemplateId, conversations });
      if (rootSource() === 'opfs') persistStorage();
      await enter(root, meta, rootSource());
    }));
  }

  // Spec A8: a source without granted access takes one click to grant it, then "Choose destination…" picks the copy's root.
  function duplicateProject(entry) {
    if (busyRef.current) return;
    const name = `${entry.name.slice(0, 108)} (copy)`;
    if (duplicatePermissionPlan(entry.access, rootSource()).steps[0] !== 'grant-source') return copyTo(entry, name, folders.chooseRoot(entry.kind, name, { allowOpen: false }));
    const asking = requestAccess(entry.handle);
    return perform(async () => {
      if (await asking.catch(() => 'denied') !== 'granted') { markProblem(entry.projectId, problemOf('permission')); await refreshKnown(); return false; }
      await refreshKnown();
      return true;
    }).then(async granted => {
      if (!granted) return;
      const answer = await folders.ask({ title: `Duplicate ${entry.name}`, message: 'Studio can read the project now. Choose an empty folder for the copy.', actions: [{ id: 'destination', label: 'Choose destination…', primary: true, root: { kind: entry.kind, name } }] });
      if (answer.rooting) await copyTo(entry, name, answer.rooting);
    });
  }
  // The listed access can be stale: a permission failure marks the card and asks for the two-step duplicate.
  function copyTo(entry, name, rooting) {
    return perform(async () => folders.withRoot(await rooting, async root => {
      try { await remember(await copyProject(entry.handle, root, { name }), root); }
      catch (cause) {
        const kind = accessProblem(cause);
        if (!kind) throw cause;
        markProblem(entry.projectId, problemOf(kind)); await refreshKnown();
        throw new Error(kind === 'permission' ? `Studio lost permission to read “${entry.name}”. Choose Duplicate again to allow access.` : `“${entry.name}” could not be read: ${MISSING}`, { cause });
      }
    }));
  }

  // Save a copy… (a conflict, or an unreachable folder): the editor's current state and the project's history go to a
  // new root, which then opens. The original keeps its saved state.
  function saveCopy() {
    const value = snapshot.current, entry = currentRef.current, source = host;
    if (busyRef.current || !value || !entry) return;
    const name = `${value.state.name.slice(0, 108)} (copy)`;
    const rooting = folders.chooseRoot(entry.kind, name, { allowOpen: false });
    return perform(async () => folders.withRoot(await rooting, async root => {
      const projectId = crypto.randomUUID(), state = value.state;
      let conversations = null, historyLost = false;
      try { conversations = remapConversation(await source.conversations.load(), projectId); } catch { historyLost = true; }
      const meta = await createProjectInRoot(root, { projectId, kind: entry.kind, name, files: state.files, folders: state.folders, values: state.translations?.[state.locale] || {}, conversations });
      if (rootSource() === 'opfs') persistStorage();
      await enter(root, meta, rootSource());
      if (historyLost) setError('The copy was saved without its dialogue history, which could not be read.');
    }));
  }
  function showLibrary() {
    return perform(async () => { await preserveCurrent(); mount(null); await refreshKnown(); });
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

  const labels = current ? storageLabels(current.source, current.handle?.name || current.name) : { summary: '', help: '' };
  const cards = known.map(entry => ({ ...entry, id: entry.projectId, updatedAt: entry.lastOpenedAt, problem: problems[entry.projectId] || (entry.access === 'denied' ? problemOf('permission') : null) }));
  const statusNotice = <StatusNotices blocked={blocked} blockedReason={blockedReason} pwa={pwa} online={online} update={update} error={error} onAiSettings={() => setAiSettingsOpen(true)} onUpdate={updateStudio} onDismissError={() => setError('')} />;
  const helpButton = installedMode && <button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Open quick start guide" title="Quick start and documentation" onClick={() => setHelp(true)}><HelpCircle size={16} /></button>;
  const navigation = <ProjectNavigation blocked={blocked} blockedReason={blockedReason} busy={busy} lost={lost ? LOST : ''} conflict={Boolean(view?.conflict)} projects={known} current={current} activity={activity} help={helpButton} notices={statusNotice}
    onLibrary={showLibrary} onNewProject={() => setCreating({})} onOpen={openKnown} onReconnect={reconnectCurrent} onSaveCopy={saveCopy} />;
  const editor = host && <StudioUiProvider language={host.language} messages={host.messages}>
    <EditorShell key={epoch} host={host} aiAllowed onSnapshot={rememberSnapshot} presentation={installedMode ? 'app' : 'embedded'} previewExpandButton={false} externalModalOpen={aiSettingsOpen || help || Boolean(creating) || Boolean(folderChoice)}
      onNewProject={() => setCreating({})} onImportProject={importArchive} newProjectCreatesCopy externalBusy={busy || Boolean(lost)} storageSummary={labels.summary} storageHelp={labels.help} projectSwitcher={navigation} />
  </StudioUiProvider>;
  const library = <StudioLibrary aiEnabled aiSettings={studioAi().settings} onCreateWithAi={createProject} activity={activity} projects={cards} busy={busy} storageMode={mode} onCreate={options => setCreating(options || {})} onOpen={openKnown}
    onUseTemplate={startFromTemplate} onDuplicate={duplicateProject} onDelete={deleteProject} onImport={() => archive.current.click()} onFolder={mode === 'folder' ? openFolder : undefined} onReconnect={reconnect} onRemove={removeFromList} />;
  const content = !ready ? <div className="library-grid" role="status" aria-label="Opening your workspace…">{[0, 1, 2, 3, 4, 5].map(index => <Skeleton key={index} shape="card" height={260} />)}</div>
    : mode === 'unsupported' ? <UnsupportedBrowser /> : host ? editor : library;
  return <div className={`studio-root studio editor-root ${installedMode ? 'installed-app' : ''} ${host && installedMode ? 'is-editor' : ''}`}>
    {!(host && installedMode) && <AppHeader installPrompt={installPrompt} onInstall={() => perform(async () => { await installPrompt.prompt(); setInstallPrompt(null); })} onHelp={() => setHelp(true)} themeToggle={!host} />}
    <main className="workspace">
      {!host && mode !== 'unsupported' && <div className="studio-notices">{statusNotice}</div>}
      {host && !installedMode && <div className="studio-project-bar">{navigation}<span title={labels.help}>{current?.kind === 'template' ? 'Reusable template' : 'Landing page'} · {labels.summary}</span></div>}
      {content}
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    {creating && <CreateProjectDialog aiEnabled aiSettings={studioAi().settings} initial={creating} templates={cards.filter(entry => entry.kind === 'template' && !entry.problem)} busy={busy} onCreate={createProject} onLoadTemplate={loadTemplate} onClose={() => setCreating(null)} />}
    <input ref={archive} type="file" accept=".zip,application/zip" aria-label="Import project ZIP" hidden onChange={event => { importArchive(event.target.files[0]); event.target.value = ''; }} />
    {folderChoice && <FolderChoiceDialog choice={folderChoice} onChoose={folders.choose} />}
    {aiSettingsOpen && <AiSettingsDialog ai={studioAi()} onClose={() => setAiSettingsOpen(false)} />}
    {help && <TourDialog onClose={() => setHelp(false)} />}
  </div>;
}
