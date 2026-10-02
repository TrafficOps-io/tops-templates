import { rootDecision } from './storage/flows.js';
import { classifyFolder as classifyFolderDefault, createOpfsRoot as createOpfsRootDefault, createSubfolder as createSubfolderDefault, deleteOpfsRoot as deleteOpfsRootDefault, folderSlug, pickFolder as pickFolderDefault } from './storage/roots.js';

/**
 * Choosing the root of a new project, and the folder questions on the way (D8). No React: `show(choice | null)`
 * renders the pending question (FolderChoiceDialog), and `choose(id)` answers it from inside the click.
 *
 * - chooseRoot(kind, name, { allowOpen }) must be called synchronously at the start of a click flow: in folder mode its
 *   first statement opens the picker. It resolves { root, created? } for a new project, { open, classification } when
 *   the user chose to open the project the picked folder already holds (offered only with allowOpen), or null.
 *   `created` marks a root this flow made (an OPFS root or a subfolder): withRoot removes it again when the flow fails.
 * - ask({ title, message, actions: [{ id, label, primary?, pick?, root? }] }) resolves { id, picking, rooting }. An
 *   action with `pick` opens the picker in the answering click; one with `root: { kind, name }` starts chooseRoot there
 *   (without the "open existing" offer). Cancel answers { id: 'cancel' }.
 */
export function createFolderChoice({ show, mode, pickFolder = pickFolderDefault, classifyFolder = classifyFolderDefault, createSubfolder = createSubfolderDefault,
  createOpfsRoot = createOpfsRootDefault, deleteOpfsRoot = deleteOpfsRootDefault, newId = () => crypto.randomUUID() }) {
  let pending = null;
  function ask(choice) {
    return new Promise(resolve => { pending = { ...choice, resolve }; show(pending); });
  }
  function choose(id) {
    const choice = pending;
    if (!choice) return;
    pending = null; show(null);
    const action = choice.actions.find(item => item.id === id);
    choice.resolve({ id: action ? id : 'cancel', picking: action?.pick ? pickFolder() : null, rooting: action?.root ? chooseRoot(action.root.kind, action.root.name, { allowOpen: false }) : null });
  }
  function chooseRoot(kind, name, { allowOpen = true } = {}) {
    if (mode() === 'opfs') return createOpfsRoot(newId()).then(root => ({ root, created: { opfs: root.name } }));
    return settle(pickFolder(), kind, name, allowOpen);
  }
  async function settle(picking, kind, name, allowOpen) {
    const subject = kind === 'template' ? 'template' : 'project';
    for (;;) {
      const handle = await picking;
      if (!handle) return null;
      const classification = await classifyFolder(handle), decision = rootDecision(classification);
      if (decision.action === 'use') return { root: handle };
      const answer = await ask(question(decision, handle, subject, name, allowOpen));
      if (answer.id === 'another') { picking = answer.picking; continue; }
      if (answer.id === 'subfolder') { const root = await createSubfolder(handle, name); return { root, created: { parent: handle, name: root.name } }; }
      if (answer.id === 'open') return { open: handle, classification };
      return null;
    }
  }
  /** A new, empty project root, or null when cancelled (never an existing project). Same D8 rule as chooseRoot. */
  function createRoot(kind, name) {
    return chooseRoot(kind, name, { allowOpen: false }).then(result => result?.root ?? null);
  }
  /** Best effort: removes a root this flow created when it holds no project (OPFS) or nothing at all (subfolder). */
  async function abandon(chosen) {
    if (!chosen?.created) return false;
    try {
      const { status } = await classifyFolder(chosen.root);
      if (chosen.created.opfs) { if (status === 'project') return false; await deleteOpfsRoot(chosen.created.opfs); return true; }
      if (status !== 'empty') return false;
      await chosen.created.parent.removeEntry(chosen.created.name);
      return true;
    } catch { return false; }
  }
  /** Runs work(root) for a chosen root ({ root } from chooseRoot); a created root is abandoned when work throws. */
  async function withRoot(chosen, work) {
    if (!chosen?.root) return undefined;
    try { return await work(chosen.root); } catch (error) { await abandon(chosen); throw error; }
  }
  return { ask, choose, chooseRoot, createRoot, abandon, withRoot };
}

function question(decision, handle, subject, name, allowOpen) {
  const another = { id: 'another', label: 'Choose another…', pick: true };
  if (decision.action === 'offer-subfolder') return { title: `“${handle.name}” already has files`, message: `Studio keeps each ${subject} in its own folder. Create the subfolder “${folderSlug(name)}” inside “${handle.name}”, or choose another folder.`, actions: [another, { id: 'subfolder', label: `Create subfolder ${folderSlug(name)}`, primary: true }] };
  if (decision.action === 'offer-open') {
    const title = `“${handle.name}” already holds a project`;
    return allowOpen
      ? { title, message: `This folder holds the Studio project “${decision.meta.name}”. Open it, or choose another folder for the new ${subject}.`, actions: [another, { id: 'open', label: `Open ${decision.meta.name}`, primary: true }] }
      : { title, message: `This folder holds the Studio project “${decision.meta.name}”, which Studio never overwrites. Choose another folder for the new ${subject}.`, actions: [{ ...another, primary: true }] };
  }
  return { title: 'This folder holds a damaged project', message: `${decision.error} Choose another folder for the new ${subject}.`, actions: [{ ...another, primary: true }] };
}
