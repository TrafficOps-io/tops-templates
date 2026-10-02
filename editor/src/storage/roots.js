import { ValidationError, sha256Hex } from '@trafficops/template-editor-core';
import { readProjectMeta } from './project-meta.js';
import { fileAt } from './write.js';

const CLUTTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const ACCESS = { mode: 'readwrite' };
const missing = error => error?.name === 'NotFoundError';
const persisted = new WeakMap();
const env = () => ({ showDirectoryPicker: globalThis.showDirectoryPicker, storage: globalThis.navigator?.storage });
const storageOf = options => Object.hasOwn(options, 'storage') ? options.storage : env().storage;
const pickerOf = options => Object.hasOwn(options, 'showDirectoryPicker') ? options.showDirectoryPicker : env().showDirectoryPicker;

/** 'folder' when the folder picker exists (Chromium), 'opfs' when the origin private file system opens, else
 *  'unsupported' (Firefox private mode rejects getDirectory) (D9). */
export async function storageMode(options = {}) {
  if (typeof pickerOf(options) === 'function') return 'folder';
  const storage = storageOf(options);
  if (typeof storage?.getDirectory !== 'function') return 'unsupported';
  try { await storage.getDirectory(); return 'opfs'; } catch { return 'unsupported'; }
}

/** Opens the folder picker. Call it synchronously at the start of a click handler, before any await (D8).
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

const slugOf = name => String(name ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'project';

/** A new folder named after `name` (slug); taken names, compared case-insensitively, get -2, -3, … */
export async function createSubfolder(parent, name) {
  const taken = new Set();
  for await (const entry of parent.keys()) taken.add(entry.toLowerCase());
  const slug = slugOf(name);
  let candidate = slug;
  for (let index = 2; taken.has(candidate); index++) candidate = `${slug}-${index}`;
  return parent.getDirectoryHandle(candidate, { create: true });
}

/** 'granted' | 'prompt' | 'denied'. Handles without the permission API (Safari, Firefox OPFS) are granted (D9). */
export async function queryAccess(handle) {
  if (typeof handle?.queryPermission !== 'function') return 'granted';
  try { return await handle.queryPermission(ACCESS); } catch { return 'denied'; }
}

/** Asks for readwrite access. Call it synchronously at the start of a click handler, before any await (D8). */
export function requestAccess(handle) {
  if (typeof handle?.requestPermission !== 'function') return Promise.resolve('granted');
  try { return Promise.resolve(handle.requestPermission(ACCESS)); } catch (error) { return Promise.reject(error); }
}

// Plain ids name their folder; any other id (an imported archive keeps its own) is hashed into a safe name.
const READABLE = /^[A-Za-z0-9_-]{1,160}$/;
async function opfsName(projectId) {
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 160) throw new ValidationError('Invalid project ID.');
  return READABLE.test(projectId) ? projectId : `~${await sha256Hex(new TextEncoder().encode(projectId))}`;
}

/** `projects/` in the origin private file system: one folder per project, named by projectId. */
export async function opfsProjectsRoot(options = {}) {
  const storage = storageOf(options);
  if (typeof storage?.getDirectory !== 'function') throw new Error('Browser file storage is unavailable.');
  return (await storage.getDirectory()).getDirectoryHandle('projects', { create: true });
}

export async function createOpfsRoot(projectId, options = {}) {
  const name = await opfsName(projectId);
  return (await opfsProjectsRoot(options)).getDirectoryHandle(name, { create: true });
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
