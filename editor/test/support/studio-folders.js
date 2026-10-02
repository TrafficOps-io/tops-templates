// Folder-first browser test support: a user-activation-gated folder picker over real OPFS directories, project seeding
// through the production storage modules (bundled with esbuild and evaluated in the page), and access revocation.
//
// Folders the picker returns live under OPFS `picker/<name>`, so they are never listed as OPFS projects (`projects/`).
// The name comes from localStorage `test-folder-picker` ('!abort' cancels the picker), else `folder-1`, `folder-2`, …
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(repository, 'package.json'));
export const PICKER_KEY = 'test-folder-picker', ACCESS_KEY = 'test-folder-access';

// Init script (serialized into every document of the context). `test-folder-access` = { folder?, request } revokes
// access to picker/<folder> (every picked folder without `folder`): queryPermission reports 'prompt', requestPermission
// resolves `request` ('granted' restores access), and reads and writes reject with NotAllowedError, as in Chromium.
// Picking the folder again grants it. window.__rawFs bypasses the revocation for the test's own reads.
function folderPicker() {
  let state;
  // Sandboxed preview frames have no storage: leave them alone.
  try { state = JSON.parse(localStorage.getItem('test-folder-access') || 'null'); } catch { return; }
  if (typeof FileSystemDirectoryHandle === 'undefined') return;
  const persist = next => { state = next; if (next) localStorage.setItem('test-folder-access', JSON.stringify(next)); else localStorage.removeItem('test-folder-access'); };
  window.__setFolderAccess = persist;
  const directory = FileSystemDirectoryHandle.prototype, file = FileSystemFileHandle.prototype, handle = FileSystemHandle.prototype;
  const raw = { getDirectoryHandle: directory.getDirectoryHandle, getFileHandle: directory.getFileHandle, removeEntry: directory.removeEntry, entries: directory.entries, keys: directory.keys, values: directory.values, getFile: file.getFile, createWritable: file.createWritable, queryPermission: handle.queryPermission, requestPermission: handle.requestPermission };
  window.__rawFs = {
    dir: (parent, name, options) => raw.getDirectoryHandle.call(parent, name, options), file: (parent, name, options) => raw.getFileHandle.call(parent, name, options),
    remove: (parent, name, options) => raw.removeEntry.call(parent, name, options), entries: parent => raw.entries.call(parent),
    read: target => raw.getFile.call(target), writable: target => raw.createWritable.call(target),
  };
  const revokedFolder = path => Boolean(state && path?.[0] === 'picker' && path.length >= 2 && (!state.folder || path[1] === state.folder));
  async function revoked(target) {
    if (!state) return false;
    try { return revokedFolder(await (await navigator.storage.getDirectory()).resolve(target)); } catch { return false; }
  }
  const denied = () => new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError');
  const guard = (proto, name) => { const original = raw[name]; proto[name] = async function (...args) { if (await revoked(this)) throw denied(); return original.apply(this, args); }; };
  for (const name of ['getDirectoryHandle', 'getFileHandle', 'removeEntry']) guard(directory, name);
  for (const name of ['getFile', 'createWritable']) guard(file, name);
  const iterate = original => function (...args) { const self = this, inner = original.apply(this, args); return (async function* () { if (await revoked(self)) throw denied(); yield* inner; })(); };
  directory.entries = iterate(raw.entries); directory.keys = iterate(raw.keys); directory.values = iterate(raw.values); directory[Symbol.asyncIterator] = directory.entries;
  handle.queryPermission = async function (options) { return await revoked(this) ? 'prompt' : raw.queryPermission.call(this, options); };
  handle.requestPermission = async function (options) {
    if (!await revoked(this)) return raw.requestPermission.call(this, options);
    const answer = state.request || 'denied';
    if (answer === 'granted') persist(null);
    return answer;
  };
  window.showDirectoryPicker = async () => {
    if (!navigator.userActivation.isActive) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError');
    window.__pickerCalls = (window.__pickerCalls || 0) + 1;
    let name = localStorage.getItem('test-folder-picker');
    if (!name) { const count = Number(localStorage.getItem('test-folder-picker-count') || 0) + 1; localStorage.setItem('test-folder-picker-count', String(count)); name = `folder-${count}`; }
    if (name === '!abort') throw new DOMException('The user aborted a request.', 'AbortError');
    // Choosing a folder in the picker grants access to it.
    if (state && (!state.folder || state.folder === name)) persist(null);
    const picker = await raw.getDirectoryHandle.call(await navigator.storage.getDirectory(), 'picker', { create: true });
    return raw.getDirectoryHandle.call(picker, name, { create: true });
  };
}

/** Installs the picker in every document of a page or context (call before navigating). */
export function installFolderPicker(target) { return target.addInitScript(folderPicker); }
/** The folder name the next picker call returns ('!abort' cancels). */
export const usePicker = (page, name) => page.evaluate(([key, value]) => localStorage.setItem(key, value), [PICKER_KEY, name]);

/** Revokes access to picker/<folder> (every picked folder without `folder`), persisting across reloads.
 *  requestPermission then resolves `request`. */
export const revokeAccess = (page, { folder, request = 'denied' } = {}) => page.evaluate(state => window.__setFolderAccess(state), { ...(folder ? { folder } : {}), request });
export const restoreAccess = page => page.evaluate(() => window.__setFolderAccess(null));

let bundled = null;
/** The production storage modules as one script defining window.__studioStorage. */
export function storageBundle() {
  bundled ||= require('esbuild').build({
    stdin: { contents: `
      import { createProjectInRoot, listKnownProjects, readProjectSnapshot } from './editor/src/storage/project-root.js';
      import { rememberRecent, listRecent, forgetRecent } from './editor/src/storage/recent.js';
      import { createOpfsRoot, classifyFolder } from './editor/src/storage/roots.js';
      import { readProjectMeta, readValues, claimPendingAi, resolvePendingAi, createProjectMeta } from './editor/src/storage/project-meta.js';
      import { createDirectoryConversationStore } from './editor/src/storage/directory-conversation-store.js';
      import { createStoreConversationPort, sha256Hex, BLOB_TAG } from '@trafficops/template-editor-core';
      import { conversationStoreContract } from '@trafficops/template-editor-core/conversation-store-contract';
      window.__studioStorage = { createProjectInRoot, listKnownProjects, readProjectSnapshot, rememberRecent, listRecent, forgetRecent, createOpfsRoot, classifyFolder, readProjectMeta, readValues, claimPendingAi, resolvePendingAi, createProjectMeta, createDirectoryConversationStore, createStoreConversationPort, sha256Hex, BLOB_TAG, conversationStoreContract };`,
    resolveDir: repository, sourcefile: 'studio-folders-entry.js', loader: 'js' },
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' },
  }).then(result => result.outputFiles[0].text);
  return bundled;
}
/** Defines window.__studioStorage in the page (once per document). */
export async function loadStorage(page) {
  if (!await page.evaluate(() => Boolean(window.__studioStorage))) await page.evaluate(await storageBundle());
}

// Bytes cross page.evaluate as base64.
const encodeFiles = files => Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? value : { $bytes: Buffer.from(value).toString('base64') }]));
/** A one-field page: `title` (label `label`) rendered as its h1. */
export const pageSource = (title = 'Seeded title', label = 'Page title') => `@template "Seeded project"\n@section content "Content"\n@param title String = "${title}" label="${label}"\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title></head><body><h1>{{title}}</h1></body></html>\n@endlayout\n`;

/** Writes a project with the production createProjectInRoot into picker/<folder> (default: a slug of the name) or, with
 *  `opfs`, into a new OPFS root, and registers a picked folder in the recent list (unless `register: false`).
 *  `files` values are strings or bytes; `conversations` is a joined history document (projectId filled in); `pendingAi`
 *  is a brief { id, prompt, mode, generateImages, attachments }. Returns the stored meta plus `folder`, the root's OPFS
 *  path. The App lists it after a reload or from Projects (see openProject). */
export async function seedProjectFolder(page, { name, kind = 'landing', files = { 'index.tpl': pageSource() }, folders = [], values, conversations, pendingAi, projectId, sourceTemplateId, folder, opfs = false, register = true } = {}) {
  projectId ||= conversations?.projectId || randomUUID();
  const history = conversations ? { schema: 1, revision: 0, runs: [], ...conversations, projectId } : undefined;
  folder ||= String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  await loadStorage(page);
  return page.evaluate(async ({ name, kind, files, folders, values, history, pendingAi, projectId, sourceTemplateId, folder, opfs, register }) => {
    const storage = window.__studioStorage, decoded = {};
    for (const [path, value] of Object.entries(files)) decoded[path] = typeof value === 'string' ? value : Uint8Array.from(atob(value.$bytes), char => char.charCodeAt(0));
    let root, path;
    if (opfs) { root = await storage.createOpfsRoot(crypto.randomUUID()); path = `projects/${root.name}`; }
    else { root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('picker', { create: true })).getDirectoryHandle(folder, { create: true }); path = `picker/${folder}`; }
    const meta = await storage.createProjectInRoot(root, { projectId, kind, name, files: decoded, folders, values, conversations: history, brief: pendingAi, ...(sourceTemplateId ? { sourceTemplateId } : {}) });
    if (register && !opfs) await storage.rememberRecent({ projectId, name, kind, handle: root });
    return { ...meta, folder: path };
  }, { name, kind, files: encodeFiles(files), folders, values, history, pendingAi, projectId, sourceTemplateId, folder, opfs, register });
}

export const editorFrame = page => page.locator('.browser-frame iframe.is-visible');
/** Waits for the editor's visible preview. */
export const editorReady = async (page, timeout = 20000) => {
  await page.locator('.editor-shell').waitFor({ timeout });
  const panes = page.locator('.studio-pane-switch');
  const narrow = await panes.isVisible();
  if (narrow) await panes.getByRole('button', { name: 'Preview', exact: true }).click();
  await editorFrame(page).waitFor({ timeout });
  if (narrow) await panes.getByRole('button', { name: 'Edit', exact: true }).click();
};

/** Opens a listed project from the library: from an open editor through Projects (which refreshes the list), else after
 *  a reload (the list is read at boot; the last project may reopen, then Projects is used). */
export async function openProject(page, name) {
  const card = page.getByRole('button', { name: `Open ${name}`, exact: true }), projects = page.getByRole('button', { name: 'Projects', exact: true });
  if (!await projects.count()) {
    await page.reload();
    await page.locator('.library, .editor-shell').first().waitFor({ timeout: 20000 });
  }
  if (await projects.count()) { await projects.first().click(); await page.locator('.library').waitFor(); }
  await card.click();
  await editorReady(page);
}

// OPFS access for the test itself: window.__rawFs (installed with the picker) bypasses a revocation.
function testFs() {
  const raw = window.__rawFs;
  return raw || { dir: (parent, name, options) => parent.getDirectoryHandle(name, options), file: (parent, name, options) => parent.getFileHandle(name, options), remove: (parent, name, options) => parent.removeEntry(name, options), entries: parent => parent.entries(), read: handle => handle.getFile(), writable: handle => handle.createWritable() };
}
/** Defines window.__testFs in the page (the picker's raw access, or the plain API). */
const withFs = page => page.evaluate(`window.__testFs = (${testFs.toString()})()`);
/** File text at an OPFS path, or null. */
export const readOpfs = async (page, path) => { await withFs(page); return page.evaluate(async path => {
  const fs = window.__testFs;
  let directory = await navigator.storage.getDirectory();
  const parts = path.split('/'), name = parts.pop();
  try { for (const part of parts) directory = await fs.dir(directory, part); return await (await fs.read(await fs.file(directory, name))).text(); } catch { return null; }
}, path); };
/** Sorted entry names of an OPFS directory, or null. */
export const listOpfs = async (page, path) => { await withFs(page); return page.evaluate(async path => {
  const fs = window.__testFs;
  let directory = await navigator.storage.getDirectory();
  try { for (const part of path.split('/')) directory = await fs.dir(directory, part); } catch { return null; }
  const names = []; for await (const [name] of fs.entries(directory)) names.push(name); return names.sort();
}, path); };
/** Writes a file (string) at an OPFS path, creating folders: an edit made outside Studio. */
export const writeOpfs = async (page, path, text) => { await withFs(page); return page.evaluate(async ({ path, text }) => {
  const fs = window.__testFs;
  let directory = await navigator.storage.getDirectory();
  const parts = path.split('/'), name = parts.pop();
  for (const part of parts) directory = await fs.dir(directory, part, { create: true });
  const writable = await fs.writable(await fs.file(directory, name, { create: true })); await writable.write(text); await writable.close();
}, { path, text }); };
/** Copies picker/<from> to picker/<to> (optionally removing the source), as a user would in Finder. */
export const copyFolder = async (page, from, to, { remove = false } = {}) => { await withFs(page); return page.evaluate(async ({ from, to, remove }) => {
  const fs = window.__testFs, picker = await fs.dir(await navigator.storage.getDirectory(), 'picker');
  async function copy(source, target) {
    for await (const [name, handle] of fs.entries(source)) {
      if (handle.kind === 'directory') { await copy(handle, await fs.dir(target, name, { create: true })); continue; }
      const writable = await fs.writable(await fs.file(target, name, { create: true })); await writable.write(await fs.read(handle)); await writable.close();
    }
  }
  let parent = picker;
  const parts = from.split('/'), last = parts.pop();
  for (const part of parts) parent = await fs.dir(parent, part);
  await copy(await fs.dir(parent, last), await fs.dir(picker, to, { create: true }));
  if (remove) await fs.remove(parent, last, { recursive: true });
}, { from, to, remove }); };
/** Removes picker/<path> (a folder deleted outside Studio). */
export const removeFolder = async (page, path) => { await withFs(page); return page.evaluate(async path => {
  const fs = window.__testFs, parts = path.split('/'), name = parts.pop();
  let parent = await fs.dir(await navigator.storage.getDirectory(), 'picker');
  for (const part of parts) parent = await fs.dir(parent, part);
  await fs.remove(parent, name, { recursive: true });
}, path); };
export const metaOf = async (page, folder) => JSON.parse(await readOpfs(page, `${folder}/.trafficops/project.json`));

/** Polls `check` until it is truthy. */
export async function until(check, message, timeout = 10000) {
  for (const started = Date.now(); !(await check());) { if (Date.now() - started > timeout) throw new Error(`Timed out: ${message}`); await new Promise(done => setTimeout(done, 100)); }
}

// Values crossing page.evaluate: bytes as { $bytes: base64 } (decoded to Buffers here).
function decodeBytes(value) {
  if (Array.isArray(value)) return value.map(decodeBytes);
  if (value && typeof value === 'object') return Object.keys(value).length === 1 && typeof value.$bytes === 'string' ? Buffer.from(value.$bytes, 'base64') : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeBytes(item)]));
  return value;
}
/** Everything the project folder at an OPFS path holds, read with the production modules (readProjectSnapshot):
 *  { meta (with pendingAi), files (strings or Buffers), folders, values, conversations (the joined history document,
 *  blob refs unresolved) }, or null when the folder holds no readable project. */
export async function readProjectFolder(page, folder) {
  await loadStorage(page);
  return decodeBytes(await page.evaluate(async path => {
    const encode = value => {
      if (value instanceof Uint8Array) { let text = ''; for (let index = 0; index < value.length; index += 0x8000) text += String.fromCharCode(...value.subarray(index, index + 0x8000)); return { $bytes: btoa(text) }; }
      if (Array.isArray(value)) return value.map(encode);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
      return value;
    };
    let directory = await navigator.storage.getDirectory();
    try { for (const part of path.split('/')) directory = await directory.getDirectoryHandle(part); } catch { return null; }
    // A read can race the App's writes (a file replaced while the tree is listed): retry before reporting.
    for (let attempt = 0; ; attempt++) {
      try { return encode(await window.__studioStorage.readProjectSnapshot(directory)); } catch (error) {
        if (attempt >= 20) return /not a Studio project/.test(error.message) ? null : { $error: `${error.name}: ${error.message}` };
        await new Promise(done => setTimeout(done, 50));
      }
    }
  }, folder).then(value => { if (value?.$error) throw new Error(`Cannot read the project folder ${folder}: ${value.$error}`); return value; }));
}
/** The joined history document of the project folder at an OPFS path (null without a project). */
export const conversationsOf = async (page, folder) => (await readProjectFolder(page, folder))?.conversations ?? null;

/** Stores OpenRouter settings (the AI settings database, which stays in IndexedDB) and notifies the App. */
export const configureAi = (page, { apiKey = 'mock-no-paid-requests', model = 'test/model', imageModel = '' } = {}) => page.evaluate(async settings => {
  const db = await new Promise((done, reject) => { const request = indexedDB.open('trafficops-template-studio-ai', 1); request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'id' }); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  try { await new Promise((done, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', ...settings }); tx.oncomplete = done; tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
  window.dispatchEvent(new Event('trafficops-ai-settings'));
}, { apiKey, model, imageModel });

/** Seeds a project folder (seedProjectFolder) and opens it in the editor (openProject). Returns the seeded meta. */
export async function seedAndOpen(page, options) {
  const seeded = await seedProjectFolder(page, options);
  await openProject(page, options.name);
  return seeded;
}
