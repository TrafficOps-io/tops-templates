import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FolderOpen, HelpCircle, KeyRound, LayoutGrid, Plus, ShieldCheck, WifiOff } from 'lucide-react';
import EditorShell from '@trafficops/template-editor-shell';
import { getConversationSession, getConversationActivity, subscribeConversationActivity, releaseConversationSession } from '@trafficops/template-editor-shell/conversation-runtime';
import { createFolderHost } from './hosts/FolderHost.js';
import { createStudioAiPort } from './hosts/StudioAiPort.js';
import { installedDisplayMode, watchDisplayMode } from './app-mode.js';
import { LIMITS, conversationDocumentFromFiles } from '@trafficops/template-editor-core';
import { readArchive } from './hosts/read-archive.js';
import { classifyFolder, createOpfsRoot, createSubfolder, deleteOpfsRoot, folderSlug, persistStorage, pickFolder, requestAccess, storageMode } from './storage/roots.js';
import { forgetRecent, rememberRecent } from './storage/recent.js';
import { readProjectTree } from './storage/files.js';
import { readProjectMeta, readValues } from './storage/project-meta.js';
import { adoptFolder, copyProject, createProjectInRoot, interruptImportedRuns, listKnownProjects, makeIndependent, remapConversation } from './storage/project-root.js';
import { LAST_PROJECT_KEY, accessLost, duplicateDecision, duplicatePermissionPlan, importIdentity, openFolderDecision, pendingEditsApply, reconnectDecision, reopenCandidate, rootDecision, rootReachable, storageLabels } from './storage/flows.js';
import { starterProject } from './starter.js';
import { getPwaState, subscribePwa } from './pwa.js';
import StudioLibrary, { CreateProjectDialog } from './StudioLibrary.jsx';
import { briefAttachments } from './HomeProjectChat.jsx';
import { AiSettingsDialog, TourDialog } from './StudioDialogs.jsx';
import FolderChoiceDialog from './FolderChoiceDialog.jsx';
import UnsupportedBrowser from './UnsupportedBrowser.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { StudioUiProvider } from '@trafficops/studio-ui/i18n';
import { Skeleton } from '@trafficops/studio-ui/primitives';

const NEEDS_ACCESS = 'Studio needs permission to use this folder. Reconnect it, or remove it from the list.';
const MISSING = 'The folder was moved, renamed or deleted. Reconnect it, or remove it from the list.';
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
  const [unavailable, setUnavailable] = useState({}), [lost, setLost] = useState(null), [folderChoice, setFolderChoice] = useState(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false), [help, setHelp] = useState(false), [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [view, setView] = useState(null), [activity, setActivity] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null), [pwa, setPwa] = useState(getPwaState), [online, setOnline] = useState(navigator.onLine);
  const update = pwa.update;
  const archive = useRef(null), snapshot = useRef(null), currentRef = useRef(null), busyRef = useRef(false), lostRef = useRef(null), modeRef = useRef(null), boot = useRef(null);
  const ai = useRef(null), hosts = useRef(new Map());
  // D7: the AI port is always available; installedDisplayMode() only drives install and window chrome.
  function studioAi() { return ai.current ||= createStudioAiPort(); }
  const blocked = busy || Boolean(view?.busy);
  const blockedReason = blocked ? 'Wait for the current save to finish.' : '';

  // Hosts stay registered per projectId so a background AI run keeps its session; a reopened project rebinds it.
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
  function watchAccess(next, projectId, root) {
    const guard = operation => async (...args) => {
      try { return await operation(...args); } catch (cause) {
        if (cause?.name === 'AbortError' || cause?.code === 'abort') throw cause;
        if (!accessLost(cause) && await rootReachable(root).catch(() => true)) throw cause;
        folderLost(projectId);
        throw new Error(LOST, { cause });
      }
    };
    return { ...next, project: { ...next.project, open: guard(next.project.open), save: guard(next.project.save) } };
  }
  function folderLost(projectId) {
    if (currentRef.current?.projectId !== projectId || lostRef.current) return;
    lostRef.current = { projectId }; setLost(lostRef.current);
  }
  async function refreshKnown() {
    try { setKnown(await listKnownProjects()); } catch (cause) { setError(`Could not list your projects: ${cause.message}`); }
  }
  const rootSource = () => modeRef.current === 'opfs' ? 'opfs' : 'folder';
  // "Save as template" asks the App for a new root (D4): the picker opens in that dialog's submit.
  async function folderHost(root, meta) {
    const next = await createFolderHost({ root, meta, ai: studioAi(), createProjectRoot: ({ kind, name }) => createRoot(kind, name), onProjectCreated: (created, target) => remember(created, target) });
    return watchAccess(next, meta.projectId, root);
  }
  // A project written to a new root without opening it (template, duplicate): list it.
  async function remember(meta, root) {
    if (rootSource() === 'folder') await rememberRecent({ projectId: meta.projectId, name: meta.name, kind: meta.kind, handle: root });
    else persistStorage();
    await refreshKnown();
  }
  function markUnavailable(projectId, message) { setUnavailable(items => ({ ...items, [projectId]: message })); }
  // Opens a project root; folder roots are remembered (and their lastOpenedAt refreshed) in the recent registry.
  async function enter(root, meta, source) {
    const entry = { projectId: meta.projectId, name: meta.name, kind: meta.kind, source, handle: root };
    if (source === 'folder') await rememberRecent({ projectId: entry.projectId, name: entry.name, kind: entry.kind, handle: root });
    const next = await folderHost(root, meta);
    setUnavailable(items => without(items, entry.projectId));
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
          if (check.ok) await enter(entry.handle, check.meta, entry.source); else markUnavailable(entry.projectId, check.message);
        } catch (cause) { if (alive) { if (accessLost(cause)) markUnavailable(entry.projectId, MISSING); else setError(`Could not reopen ${entry.name}: ${cause.message}`); } }
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
    try { return await operation(); } finally { busyRef.current = false; setBusy(false); }
  }
  function perform(operation) {
    return run(operation).catch(cause => { if (cause?.name !== 'AbortError') setError(cause?.message || String(cause)); });
  }

  // FolderChoiceDialog: ask() resolves { id, picking, rooting } once the user chooses. In that click (D8), an action
  // marked `pick` opens the folder picker and hands the pending pick back; one with `root: { kind, name }` starts
  // chooseRoot (no "open existing" offer) and hands back its pending root.
  function ask(choice) { return new Promise(resolve => setFolderChoice({ ...choice, resolve })); }
  function chooseFolderAction(id) {
    const choice = folderChoice;
    if (!choice) return;
    const action = choice.actions.find(item => item.id === id);
    setFolderChoice(null);
    choice.resolve({ id: action ? id : 'cancel', picking: action?.pick ? pickFolder() : null, rooting: action?.root ? chooseRoot(action.root.kind, action.root.name, { allowOpen: false }) : null });
  }
  // D8: call synchronously at the start of a click flow; the picker is its first prompt. Resolves { root } for a new
  // project, { open, classification } when the user chose to open the project the folder already holds (offered only
  // with allowOpen), or null.
  function chooseRoot(kind, name, { allowOpen = true } = {}) {
    if (modeRef.current === 'opfs') return createOpfsRoot(crypto.randomUUID()).then(root => ({ root }));
    return settleRoot(pickFolder(), kind, name, { allowOpen });
  }
  async function settleRoot(picking, kind, name, { allowOpen }) {
    const subject = kind === 'template' ? 'template' : 'project';
    for (;;) {
      const handle = await picking;
      if (!handle) return null;
      const classification = await classifyFolder(handle), decision = rootDecision(classification);
      if (decision.action === 'use') return { root: handle };
      const another = { id: 'another', label: 'Choose another…', pick: true };
      const answer = await ask(decision.action === 'offer-subfolder'
        ? { title: `“${handle.name}” already has files`, message: `Studio keeps each ${subject} in its own folder. Create the subfolder “${folderSlug(name)}” inside “${handle.name}”, or choose another folder.`, actions: [another, { id: 'subfolder', label: `Create subfolder ${folderSlug(name)}`, primary: true }] }
        : decision.action === 'offer-open'
          ? allowOpen
            ? { title: `“${handle.name}” already holds a project`, message: `This folder holds the Studio project “${decision.meta.name}”. Open it, or choose another folder for the new ${subject}.`, actions: [another, { id: 'open', label: `Open ${decision.meta.name}`, primary: true }] }
            : { title: `“${handle.name}” already holds a project`, message: `This folder holds the Studio project “${decision.meta.name}”, which Studio never overwrites. Choose another folder for the new ${subject}.`, actions: [{ ...another, primary: true }] }
          : { title: 'This folder holds a damaged project', message: `${decision.error} Choose another folder for the new ${subject}.`, actions: [{ ...another, primary: true }] });
      if (answer.id === 'another') { picking = answer.picking; continue; }
      if (answer.id === 'subfolder') return { root: await createSubfolder(handle, name) };
      if (answer.id === 'open') return { open: handle, classification };
      return null;
    }
  }
  /** A new, empty project root (a picked folder or an OPFS root), or null when cancelled. Same D8 rule as chooseRoot. */
  function createRoot(kind, name) { return chooseRoot(kind, name, { allowOpen: false }).then(result => result?.root ?? null); }

  // Creation from the dialog and the home prompt. Validation is synchronous; chooseRoot opens the picker before any
  // await, and the brief's attachment files are read only afterwards (D8). A user template arrives already read (D2).
  function createProject({ kind = 'landing', mode: creation, name, prompt = '', source, attachmentFiles = [], useOnPage = false, generateImages }) {
    if (busyRef.current) return;
    if (!name && creation === 'ai') name = prompt.trim().split('\n')[0].replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80) || 'New AI project';
    if (!name) throw new Error('Give your project a name.');
    if (creation === 'ai' && !prompt) throw new Error('Describe what you want to create.');
    if (creation === 'template' && !source) throw new Error('Choose a starting template.');
    if (creation === 'template' && !source.files) throw new Error('Studio needs access to this template: choose it again.');
    const rooting = chooseRoot(kind, name);
    return run(async () => {
      const chosen = await rooting;
      if (!chosen) return;
      if (chosen.open) { await openRoot(chosen.open, chosen.classification); return; }
      const attachments = creation === 'ai' ? await briefAttachments(attachmentFiles, useOnPage) : [];
      await preserveCurrent();
      const template = creation === 'template' ? source : null;
      const meta = await createProjectInRoot(chosen.root, { kind, name, files: template ? template.files : starterProject(true), folders: template?.folders || [], values: template?.settings,
        ...(template && !template.builtin ? { sourceTemplateId: template.id } : {}),
        ...(creation === 'ai' ? { brief: { id: crypto.randomUUID(), prompt, mode: 'create', generateImages, attachments } } : {}) });
      if (rootSource() === 'opfs') persistStorage();
      await enter(chosen.root, meta, rootSource());
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
      const answer = await ask({ title: `This folder is a copy of ${original.name}`, message: `“${handle.name}” has the same project identity as “${original.name}”, which Studio already knows. To open it, make it independent: it gets its own identity and its own copy of the dialogue history. The original stays unchanged.`, actions: [{ id: 'independent', label: 'Make independent', primary: true }] });
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
  // A library card: the permission prompt opens in this click (D8).
  function openKnown(entry) {
    if (busyRef.current || !entry) return;
    const asking = requestAccess(entry.handle);
    return perform(async () => {
      if (await asking.catch(() => 'denied') !== 'granted') { markUnavailable(entry.projectId, NEEDS_ACCESS); return; }
      let classification;
      try { classification = await classifyFolder(entry.handle); } catch (cause) { if (!accessLost(cause)) throw cause; markUnavailable(entry.projectId, MISSING); return; }
      const check = reconnectDecision(entry.projectId, classification);
      if (!check.ok) { markUnavailable(entry.projectId, check.message); return; }
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
        if (pendingEditsApply(pending.baseline, opened.files)) await next.project.save({ ...pending.state, revision: opened.revision });
        else if (!window.confirm('The folder changed while it was unavailable. Open the folder version and discard your unsaved edits? Cancel keeps them here so you can export a ZIP first.')) { next.dispose?.(); return; }
      }
      mount(next, { ...entry, name: check.meta.name, kind: check.meta.kind, handle });
      await refreshKnown();
    });
  }
  // Forgets a listed project: its conversation session stops; a folder stays on disk, an OPFS root is deleted.
  async function forget(entry) {
    releaseConversationSession(entry.projectId); hosts.current.get(entry.projectId)?.dispose?.(); hosts.current.delete(entry.projectId);
    if (entry.source === 'opfs') await deleteOpfsRoot(entry.folderName || entry.handle.name); else await forgetRecent(entry.projectId);
    setUnavailable(items => without(items, entry.projectId));
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

  // D2: choosing a user template is its own click. Access is asked in it; the files and values are read into memory
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

  // D1 + D8: the archive is read first; its "Import {name}" dialog then picks the new root in its own click.
  function importArchive(file) {
    if (!file) return;
    return perform(async () => {
      if (file.size > LIMITS.portableArchive) throw new Error('Project ZIPs must be 512 MiB or smaller.');
      const imported = await readArchive(new Uint8Array(await file.arrayBuffer()), { history: true });
      return { imported, name: projectName(imported.metadata?.name || file.name.replace(/\.zip$/i, '')) };
    }).then(result => result && confirmImport(result));
  }
  async function confirmImport({ imported, name }) {
    const kind = imported.metadata?.kind, history = Boolean(imported.conversationFiles?.threads.length || imported.conversations?.threads.length);
    const label = rootSource() === 'opfs' ? 'Import' : 'Choose folder…';
    const where = rootSource() === 'opfs' ? 'It is stored in this browser.' : 'Choose an empty folder for it; Studio never overwrites an existing project.';
    const answer = await ask(kind
      ? { title: `Import ${name}`, message: `Studio creates a new ${kind === 'template' ? 'template' : 'project'} from this ZIP${history ? ', with its dialogue history' : ''}. ${where}`, actions: [{ id: 'import', label, primary: true, root: { kind, name } }] }
      : { title: `Import ${name}`, message: `This ZIP holds plain files. Import them as a landing page or as a reusable template. ${where}`, actions: [{ id: 'template', label: 'Import as template', root: { kind: 'template', name } }, { id: 'landing', label: 'Import as landing', primary: true, root: { kind: 'landing', name } }] });
    if (!answer.rooting) return;
    return perform(async () => {
      const chosen = await answer.rooting;
      if (!chosen?.root) return;
      // A projectId Studio already knows becomes a copy: new identity, remapped history (D1).
      const identity = importIdentity(imported.metadata, (await listKnownProjects()).map(entry => entry.projectId));
      let conversations = imported.conversationFiles ? await conversationDocumentFromFiles(imported.conversationFiles, imported.metadata.projectId) : imported.conversations || null;
      if (conversations) conversations = identity.copy ? remapConversation(conversations, identity.projectId) : interruptImportedRuns(conversations);
      await preserveCurrent();
      const meta = await createProjectInRoot(chosen.root, { projectId: identity.projectId, kind: kind || (answer.id === 'template' ? 'template' : 'landing'), name: identity.copy ? `${name.slice(0, 108)} (copy)` : name,
        files: imported.files, folders: imported.folders, values: imported.settings, sourceTemplateId: imported.metadata?.sourceTemplateId, conversations });
      if (rootSource() === 'opfs') persistStorage();
      await enter(chosen.root, meta, rootSource());
    });
  }

  // D8: a source without granted access takes one click to grant it, then "Choose destination…" picks the copy's root.
  function duplicateProject(entry) {
    if (busyRef.current) return;
    const name = `${entry.name.slice(0, 108)} (copy)`;
    if (duplicatePermissionPlan(entry.access, rootSource()).steps[0] !== 'grant-source') return copyTo(entry, name, chooseRoot(entry.kind, name, { allowOpen: false }));
    const asking = requestAccess(entry.handle);
    return perform(async () => {
      if (await asking.catch(() => 'denied') !== 'granted') { markUnavailable(entry.projectId, NEEDS_ACCESS); return false; }
      await refreshKnown();
      return true;
    }).then(async granted => {
      if (!granted) return;
      const answer = await ask({ title: `Duplicate ${entry.name}`, message: 'Studio can read the project now. Choose an empty folder for the copy.', actions: [{ id: 'destination', label: 'Choose destination…', primary: true, root: { kind: entry.kind, name } }] });
      if (answer.rooting) await copyTo(entry, name, answer.rooting);
    });
  }
  function copyTo(entry, name, rooting) {
    return perform(async () => {
      const chosen = await rooting;
      if (!chosen?.root) return;
      await remember(await copyProject(entry.handle, chosen.root, { name }), chosen.root);
    });
  }

  // Save a copy… (a conflict, or an unreachable folder): the editor's current state and the project's history go to a
  // new root, which then opens. The original keeps its saved state.
  function saveCopy() {
    const value = snapshot.current, entry = currentRef.current, source = host;
    if (busyRef.current || !value || !entry) return;
    const name = `${value.state.name.slice(0, 108)} (copy)`;
    const rooting = chooseRoot(entry.kind, name, { allowOpen: false });
    return perform(async () => {
      const chosen = await rooting;
      if (!chosen?.root) return;
      const projectId = crypto.randomUUID(), state = value.state;
      let conversations = null, historyLost = false;
      try { conversations = remapConversation(await source.conversations.load(), projectId); } catch { historyLost = true; }
      const meta = await createProjectInRoot(chosen.root, { projectId, kind: entry.kind, name, files: state.files, folders: state.folders, values: state.translations?.[state.locale] || {}, conversations });
      if (rootSource() === 'opfs') persistStorage();
      await enter(chosen.root, meta, rootSource());
      if (historyLost) setError('The copy was saved without its dialogue history, which could not be read.');
    });
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
  const cards = known.map(entry => ({ ...entry, id: entry.projectId, updatedAt: entry.lastOpenedAt, unavailable: unavailable[entry.projectId] || (entry.access === 'denied' ? NEEDS_ACCESS : '') }));
  const lostAlert = lost && <span className="folder-unavailable" role="alert" title={LOST}>Folder unavailable<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={reconnectCurrent}><FolderOpen size={14} />Reconnect</button></span>;
  const statusNotice = <><button type="button" className="btn btn-ghost btn-sm" disabled={blocked} title={blocked ? blockedReason : 'OpenRouter'} onClick={() => setAiSettingsOpen(true)}><KeyRound size={15} /><span className="studio-navigation-label">OpenRouter</span></button>{pwa.error && <span className="studio-app-error" role="status">{pwa.error.operation === 'register' ? 'Offline setup failed' : 'Update check failed'}: {pwa.error.message}</span>}{!online && <span className="studio-network" role="status"><WifiOff size={14} />Offline · local editing available</span>}{update && <button className="btn btn-primary btn-sm" disabled={blocked} title={blocked ? blockedReason : undefined} onClick={updateStudio}>Update Studio</button>}{error && <span className="studio-app-error" role="alert">{error}<button className="text-link" onClick={() => setError('')}>Dismiss</button></span>}</>;
  const helpButton = <button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Open quick start guide" title="Quick start and documentation" onClick={() => setHelp(true)}><HelpCircle size={16} /></button>;
  const navigation = <div className="studio-navigation"><button className="btn btn-ghost btn-sm" disabled={blocked} title={blocked ? blockedReason : 'Projects'} onClick={showLibrary}><LayoutGrid size={16} /><span className="studio-navigation-label">Projects</span></button><button className="btn btn-ghost btn-sm" disabled={blocked} title={blocked ? blockedReason : 'New project'} onClick={() => setCreating({})}><Plus size={16} /><span className="studio-navigation-label">New project</span></button>{current && known.length > 1 && <select className="select select-sm" aria-label="Switch project" disabled={blocked} value={current.projectId} onChange={event => openKnown(known.find(entry => entry.projectId === event.target.value))}>{known.map(entry => <option key={entry.projectId} value={entry.projectId}>{entry.name}{activity.some(run => run.projectId === entry.projectId) ? ' · AI working' : ''}</option>)}</select>}{lostAlert}{(lost || view?.conflict) && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={saveCopy}>Save a copy…</button>}{statusNotice}{installedMode && helpButton}<ThemeToggle /></div>;
  const content = !ready ? <div className="library-grid" role="status" aria-label="Opening your workspace…">{[0, 1, 2, 3, 4, 5].map(index => <Skeleton key={index} shape="card" height={260} />)}</div>
    : mode === 'unsupported' ? <UnsupportedBrowser />
    : host ? <StudioUiProvider language={host.language} messages={host.messages}><EditorShell key={epoch} host={host} aiAllowed onSnapshot={rememberSnapshot} presentation={installedMode ? 'app' : 'embedded'} previewExpandButton={false} externalModalOpen={aiSettingsOpen || help || Boolean(creating) || Boolean(folderChoice)} onNewProject={() => setCreating({})} onImportProject={importArchive} newProjectCreatesCopy externalBusy={busy || Boolean(lost)} storageSummary={labels.summary} storageHelp={labels.help} projectSwitcher={navigation} /></StudioUiProvider>
    : <StudioLibrary aiEnabled aiSettings={studioAi().settings} onCreateWithAi={createProject} activity={activity} projects={cards} busy={busy} storageMode={mode} onCreate={options => setCreating(options || {})} onOpen={openKnown} onUseTemplate={startFromTemplate} onDuplicate={duplicateProject} onDelete={deleteProject} onImport={() => archive.current.click()} onFolder={mode === 'folder' ? openFolder : undefined} onReconnect={reconnect} onRemove={removeFromList} />;
  return <div className={`studio-root studio editor-root ${installedMode ? 'installed-app' : ''} ${host && installedMode ? 'is-editor' : ''}`}>
    {!(host && installedMode) && <header className="topbar"><div className="topbar-inner"><a className="brand" href="https://trafficops.io/" target="_blank" rel="noreferrer" aria-label="TrafficOps website"><img src="/favicon.svg" alt="" /><span className="brand-wordmark">Traffic<span>Ops</span></span></a><span className="brand-divider" /><span className="product-name">Landing Studio</span><div className="topbar-right"><span className="privacy"><ShieldCheck size={15} />Local by design</span>{installPrompt && <button className="btn btn-ghost btn-sm" onClick={() => perform(async () => { await installPrompt.prompt(); setInstallPrompt(null); })}><ArrowDownToLine size={15} />Install Studio</button>}<button className="btn btn-ghost btn-sm" aria-label="Open quick start guide" onClick={() => setHelp(true)}><HelpCircle size={16} />Quick start</button>{!host && <ThemeToggle />}<a className="docs-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Docs ↗</a></div></div></header>}
    <main className="workspace">
      {!host && mode !== 'unsupported' && <div className="studio-notices">{statusNotice}</div>}
      {host && !installedMode && <div className="studio-project-bar">{navigation}<span title={labels.help}>{current?.kind === 'template' ? 'Reusable template' : 'Landing page'} · {labels.summary}</span></div>}
      {content}
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    {creating && <CreateProjectDialog aiEnabled aiSettings={studioAi().settings} initial={creating} templates={cards.filter(entry => entry.kind === 'template' && !entry.unavailable)} busy={busy} onCreate={createProject} onLoadTemplate={loadTemplate} onClose={() => setCreating(null)} />}
    <input ref={archive} type="file" accept=".zip,application/zip" aria-label="Import project ZIP" hidden onChange={event => { importArchive(event.target.files[0]); event.target.value = ''; }} />
    {folderChoice && <FolderChoiceDialog choice={folderChoice} onChoose={chooseFolderAction} />}
    {aiSettingsOpen && <AiSettingsDialog ai={studioAi()} onClose={() => setAiSettingsOpen(false)} />}
    {help && <TourDialog onClose={() => setHelp(false)} />}
  </div>;
}
