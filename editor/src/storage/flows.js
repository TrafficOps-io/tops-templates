import { contentsEqual } from '@trafficops/template-editor-core';
import { readProjectMeta } from './project-meta.js';
import { queryAccess } from './roots.js';

// Pure decisions behind App's folder flows: no React, no globals beyond injectable defaults.

/** localStorage key of the project to reopen on boot (only when its access is already granted). */
export const LAST_PROJECT_KEY = 'trafficops-studio-last-project';
const ACCESS_LOST = new Set(['NotAllowedError', 'NotFoundError', 'SecurityError']);

/** A freshly picked folder for a new project (classifyFolder result) → use it as is, offer a subfolder (it holds other
 *  files), offer to open the project it already holds, or report a damaged project.json. */
export function rootDecision(classification) {
  switch (classification?.status) {
    case 'empty': return { action: 'use' };
    case 'files': return { action: 'offer-subfolder' };
    case 'project': return classification.meta ? { action: 'offer-open', meta: classification.meta } : { action: 'damaged', error: classification.error || 'Its project.json cannot be read.' };
    default: throw new TypeError('Unknown folder classification.');
  }
}

/** "Open folder": a project opens, other files are adopted in place, an empty folder gets a blank project. */
export function openFolderDecision(classification) {
  switch (classification?.status) {
    case 'empty': return { action: 'blank' };
    case 'files': return { action: 'adopt' };
    case 'project': return classification.meta ? { action: 'open', meta: classification.meta } : { action: 'damaged', error: classification.error || 'Its project.json cannot be read.' };
    default: throw new TypeError('Unknown folder classification.');
  }
}

/** Reconnecting a known project accepts only a folder that holds the same projectId. */
export function reconnectDecision(projectId, classification) {
  if (classification?.status !== 'project') return { ok: false, message: 'This folder is not a Studio project. Choose the folder that holds this project.' };
  if (!classification.meta) return { ok: false, message: `The project file in this folder cannot be read: ${classification.error || 'project.json is damaged'}.` };
  if (classification.meta.projectId !== projectId) return { ok: false, message: 'This folder holds a different project. Choose the folder of this project.' };
  return { ok: true, meta: classification.meta };
}

/** D1: an imported archive keeps its projectId unless Studio already knows it; then the import becomes a copy under a
 *  new id. An archive without metadata gets a new id and is not a copy. */
export function importIdentity(metadata, knownIds, { newId = () => crypto.randomUUID() } = {}) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  const id = metadata?.projectId;
  if (typeof id === 'string' && id && !known.has(id)) return { projectId: id, copy: false };
  return { projectId: newId(), copy: typeof id === 'string' && Boolean(id) };
}

/** A folder opened with the projectId of `known` (the listed project with that id, or null). It is a copy made outside
 *  Studio when `known`'s folder is a different entry that is still accessible and still holds that projectId; then
 *  the user is offered "Make independent". A stale, moved or unreadable known folder is not a duplicate. */
export async function duplicateDecision(known, handle, { access = queryAccess, readMeta = readProjectMeta } = {}) {
  if (!known?.handle) return { action: 'open' };
  if (await Promise.resolve().then(() => known.handle.isSameEntry(handle)).catch(() => false)) return { action: 'open' };
  if (await access(known.handle) !== 'granted') return { action: 'open' };
  let meta;
  try { meta = await readMeta(known.handle); } catch { return { action: 'open' }; }
  return meta?.projectId === known.projectId ? { action: 'make-independent', original: known } : { action: 'open' };
}

/** D8: each permission prompt or picker needs its own click. A source that is not granted takes one click to grant,
 *  then another to choose the destination; an OPFS destination needs no prompt. */
export function duplicatePermissionPlan(sourceAccess, mode = 'folder') {
  const destination = mode === 'opfs' ? 'opfs' : 'pick-destination';
  return { steps: sourceAccess === 'granted' ? [destination] : ['grant-source', destination] };
}

/** 'permission' (NotAllowedError, SecurityError: access must be granted again), 'missing' (NotFoundError: moved or
 *  deleted) or null, from an error or one of its causes. */
export function accessProblem(error) {
  for (let cause = error, depth = 0; cause && depth < 8; cause = cause.cause, depth++) {
    if (cause.name === 'NotAllowedError' || cause.name === 'SecurityError') return 'permission';
    if (cause.name === 'NotFoundError') return 'missing';
  }
  return null;
}

/** True when an error (or one of its causes) means the folder is gone or no longer permitted. */
export function accessLost(error) {
  for (let cause = error, depth = 0; cause && depth < 8; cause = cause.cause, depth++) if (ACCESS_LOST.has(cause.name)) return true;
  return false;
}

/** False when the folder itself is gone or no longer permitted (listing it fails with an access error). A deleted root
 *  can surface as a different failure first (its project.json reads as missing), so failed saves probe the root. */
export async function rootReachable(root) {
  try {
    for await (const _name of root.keys()) break;
    return true;
  } catch (error) { if (accessLost(error)) return false; throw error; }
}

/** The project to reopen on boot: the last one, only when its access is already granted (no prompt without a click). */
export function reopenCandidate(known, lastProjectId) {
  if (!lastProjectId) return null;
  return known.find(entry => entry.projectId === lastProjectId && entry.access === 'granted') || null;
}

/** Unsaved editor edits may be written to a reconnected folder only when its files still equal the editor's baseline
 *  and, when given, its values still equal the values the editor last loaded or saved. */
export function pendingEditsApply(baseline, files, savedValues, values) {
  if (!baseline || !files) return false;
  const names = Object.keys(baseline);
  if (names.length !== Object.keys(files).length || !names.every(name => Object.hasOwn(files, name) && contentsEqual(baseline[name], files[name]))) return false;
  return savedValues === undefined || sameValues(savedValues, values);
}

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
/** Parameter values compared as JSON, ignoring key order; null and undefined are an empty object. */
export function sameValues(left, right) {
  return JSON.stringify(canonical(left ?? {})) === JSON.stringify(canonical(right ?? {}));
}

/** Editor storage labels (D9). */
export function storageLabels(source, folderName) {
  if (source === 'opfs') return { summary: 'Stored in this browser', help: 'Stored in this browser — export a backup ZIP regularly. Clearing site data removes this project.' };
  return { summary: `Saved to folder ${folderName}`, help: 'Files and dialogue history save to this folder on your computer.' };
}
