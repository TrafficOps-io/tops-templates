import { ValidationError } from '@trafficops/template-editor-core';
import { readProjectMeta } from './project-meta.js';
import { fileAt } from './write.js';

const CLUTTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const ACCESS = { mode: 'readwrite' };
const missing = error => error?.name === 'NotFoundError';
const persisted = new WeakMap();
const env = () => ({ showDirectoryPicker: globalThis.showDirectoryPicker, storage: globalThis.navigator?.storage });
const storageOf = options => Object.hasOwn(options, 'storage') ? options.storage : env().storage;
const pickerOf = options => Object.hasOwn(options, 'showDirectoryPicker') ? options.showDirectoryPicker : env().showDirectoryPicker;
const fileHandleOf = options => Object.hasOwn(options, 'fileHandle') ? options.fileHandle : globalThis.FileSystemFileHandle;

/** 'folder' when the folder picker exists (Chromium), 'opfs' when the origin private file system opens, else
 *  'unsupported' (Firefox private mode rejects getDirectory) (spec A9). A browser whose file handles cannot write from the
 *  main thread (Safari 15.2–18: no createWritable) is unsupported too. */
export async function storageMode(options = {}) {
  if (typeof pickerOf(options) === 'function') return 'folder';
  const fileHandle = fileHandleOf(options);
  if (fileHandle && !('createWritable' in fileHandle.prototype)) return 'unsupported';
  const storage = storageOf(options);
  if (typeof storage?.getDirectory !== 'function') return 'unsupported';
  try { await storage.getDirectory(); return 'opfs'; } catch { return 'unsupported'; }
}

/** Opens the folder picker. Call it synchronously at the start of a click handler, before any await (spec A8).
 *  Resolves to the handle, or null when the user cancels. */
export function pickFolder(options = {}) {
  const picker = pickerOf(options);
  if (typeof picker !== 'function') return Promise.reject(new Error('Choosing a folder requires Chrome, Edge, or another Chromium browser.'));
  let chosen;
  try { chosen = picker({ id: 'trafficops-project', mode: 'readwrite', startIn: 'documents' }); } catch (error) { return Promise.reject(error); }
  return Promise.resolve(chosen).catch(error => { if (error?.name === 'AbortError') return null; throw error; });
}

/** { status: 'empty' } (system clutter ignored), { status: 'project', meta } when .trafficops/project.json exists
 *  ({ status: 'project', meta: null, error } when it is malformed), else { status: 'files' }. */
export async function classifyFolder(handle) {
  if (await fileAt(handle, '.trafficops/project.json')) {
    try { return { status: 'project', meta: await readProjectMeta(handle) }; } catch (error) { return { status: 'project', meta: null, error: error?.message || String(error) }; }
  }
  for await (const name of handle.keys()) if (!CLUTTER.has(name)) return { status: 'files' };
  return { status: 'empty' };
}

/** The folder name createSubfolder starts from (before -2, -3, … for taken names). */
export const folderSlug = name => String(name ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'project';

/** A new folder named after `name` (slug); taken names, compared case-insensitively, get -2, -3, … */
export async function createSubfolder(parent, name) {
  const taken = new Set();
  for await (const entry of parent.keys()) taken.add(entry.toLowerCase());
  const slug = folderSlug(name);
  let candidate = slug;
  for (let index = 2; taken.has(candidate); index++) candidate = `${slug}-${index}`;
  return parent.getDirectoryHandle(candidate, { create: true });
}

/** 'granted' | 'prompt' | 'denied'. Handles without the permission API (Safari, Firefox OPFS) are granted (spec A9). */
export async function queryAccess(handle) {
  if (typeof handle?.queryPermission !== 'function') return 'granted';
  try { return await handle.queryPermission(ACCESS); } catch { return 'denied'; }
}

/** Asks for readwrite access. Call it synchronously at the start of a click handler, before any await (spec A8). */
export function requestAccess(handle) {
  if (typeof handle?.requestPermission !== 'function') return Promise.resolve('granted');
  try { return Promise.resolve(handle.requestPermission(ACCESS)); } catch (error) { return Promise.reject(error); }
}

// Studio names a new OPFS root with a random UUID; anything that is not a plain name is refused.
const PLAIN_NAME = /^[A-Za-z0-9_-]{1,160}$/;
function opfsName(name) {
  if (typeof name !== 'string' || !PLAIN_NAME.test(name)) throw new ValidationError('Invalid browser storage folder.');
  return name;
}

/** `projects/` in the origin private file system: one folder per project, named by a random UUID. */
export async function opfsProjectsRoot(options = {}) {
  const storage = storageOf(options);
  if (typeof storage?.getDirectory !== 'function') throw new Error('Browser file storage is unavailable.');
  return (await storage.getDirectory()).getDirectoryHandle('projects', { create: true });
}

/** projects/<name>, created if missing. `name` is a plain folder name (Studio passes a random UUID). */
export async function createOpfsRoot(name, options = {}) {
  return (await opfsProjectsRoot(options)).getDirectoryHandle(opfsName(name), { create: true });
}

/** [{ name, handle }] for every folder under projects/. The folder name only matches the projectId the root was
 *  created for: a rekeyed project keeps its folder, so read project.json for the id and delete by name. */
export async function listOpfsRoots(options = {}) {
  const roots = [];
  for await (const [name, handle] of (await opfsProjectsRoot(options)).entries()) if (handle.kind === 'directory') roots.push({ name, handle });
  return roots;
}

/** Removes projects/<name> (a folder name from listOpfsRoots or a root's handle.name); missing is OK. */
export async function deleteOpfsRoot(name, options = {}) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new ValidationError('Invalid browser storage folder.');
  try { await (await opfsProjectsRoot(options)).removeEntry(name, { recursive: true }); } catch (error) { if (!missing(error)) throw error; }
}

/** navigator.storage.persist(), asked once per storage; false when unavailable or refused. */
export function persistStorage(options = {}) {
  const storage = storageOf(options);
  if (typeof storage?.persist !== 'function') return Promise.resolve(false);
  if (!persisted.has(storage)) persisted.set(storage, Promise.resolve().then(() => storage.persist()).then(result => result === true, () => false));
  return persisted.get(storage);
}
