import { isText, LIMITS, safePath, validateFolders, validateProject } from './project.js';

const DATABASE = 'trafficops-template-studio';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'directory-projects';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function supportsDirectoryProjects() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function chooseProjectDirectory() {
  if (!supportsDirectoryProjects()) throw new Error('Folder projects require Chrome, Edge, or another Chromium browser.');
  return window.showDirectoryPicker({ id: 'trafficops-template-project', mode: 'readwrite', startIn: 'documents' });
}

export async function ensureProjectPermission(handle, { request = true } = {}) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return request && (await handle.requestPermission(options)) === 'granted';
}

function hidden(name) {
  return name.startsWith('.');
}

export async function readDirectoryProject(root) {
  const files = Object.create(null);
  const folders = [];
  let total = 0;
  let entries = 0;

  async function visit(directory, prefix = '') {
    for await (const entry of directory.values()) {
      if (hidden(entry.name)) continue;
      const path = safePath(prefix ? `${prefix}/${entry.name}` : entry.name);
      entries++;
      if (entries > LIMITS.count) throw new Error(`A project may contain up to ${LIMITS.count} files and folders.`);
      if (entry.kind === 'directory') {
        folders.push(path);
        await visit(entry, path);
        continue;
      }
      if (entry.kind !== 'file') throw new Error(`Unsupported project entry: ${path}`);
      const file = await entry.getFile();
      if (file.size > LIMITS.file || (isText(path) && file.size > LIMITS.text)) throw new Error(`File is too large: ${path}`);
      total += file.size;
      if (total > LIMITS.total) throw new Error('The project exceeds 32 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        files[path] = isText(path) ? decoder.decode(bytes) : bytes;
      } catch {
        throw new Error(`Text file is not valid UTF-8: ${path}`);
      }
    }
  }

  await visit(root);
  if (Object.keys(files).length) validateProject(files);
  return { files, folders: validateFolders(files, folders) };
}

export async function readProjectSettings(root) {
  try {
    const directory = await root.getDirectoryHandle('.trafficops');
    const handle = await directory.getFileHandle('values.json');
    const value = JSON.parse(await (await handle.getFile()).text());
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Settings must be a JSON object.');
    return value;
  } catch (error) {
    if (error?.name === 'NotFoundError') return {};
    throw new Error(`Could not read .trafficops/values.json: ${error.message}`);
  }
}

export async function writeProjectSettings(root, value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (!Object.keys(settings).length) {
    try {
      const directory = await root.getDirectoryHandle('.trafficops');
      try { await directory.removeEntry('values.json'); } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
      try { await root.removeEntry('.trafficops'); } catch (error) { if (error?.name !== 'InvalidModificationError') throw error; }
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    return;
  }
  const directory = await root.getDirectoryHandle('.trafficops', { create: true });
  const handle = await directory.getFileHandle('values.json', { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(settings, null, 2) + '\n');
  await writable.close();
}

function bytes(value) {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

export function contentsEqual(left, right) {
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  const leftBytes = bytes(left), rightBytes = bytes(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index++) if (leftBytes[index] !== rightBytes[index]) return false;
  return true;
}

export function projectSnapshotEqual(left, right) {
  const leftNames = Object.keys(left.files), rightNames = Object.keys(right.files);
  if (leftNames.length !== rightNames.length || left.folders.length !== right.folders.length) return false;
  if (leftNames.some(name => !Object.hasOwn(right.files, name) || !contentsEqual(left.files[name], right.files[name]))) return false;
  const leftFolders = [...left.folders].sort(), rightFolders = [...right.folders].sort();
  return leftFolders.every((name, index) => name === rightFolders[index]);
}

function snapshot(project) {
  return { files: { ...project.files }, folders: [...project.folders] };
}

async function directoryAt(root, parts, { create = false } = {}) {
  let directory = root;
  for (const name of parts) directory = await directory.getDirectoryHandle(name, { create });
  return directory;
}

async function fileAt(root, path, { create = false } = {}) {
  const parts = path.split('/'), name = parts.pop();
  const directory = await directoryAt(root, parts, { create });
  return directory.getFileHandle(name, { create });
}

async function readDiskValue(root, path) {
  try {
    const handle = await fileAt(root, path);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

function conflict(path) {
  return new Error(`The file changed outside Studio: ${path}. Reload the folder before saving.`);
}

export async function syncDirectoryProject(root, previousProject, nextProject) {
  const previous = snapshot(previousProject);
  const next = snapshot(nextProject);
  if (Object.keys(next.files).length) validateProject(next.files);
  next.folders = validateFolders(next.files, next.folders);

  const changed = Object.keys(next.files).filter(path => !Object.hasOwn(previous.files, path) || !contentsEqual(previous.files[path], next.files[path]));
  const removed = Object.keys(previous.files).filter(path => !Object.hasOwn(next.files, path));

  // Detect external changes before the first write so a conflicted save cannot be half-applied.
  for (const path of changed) {
    const disk = await readDiskValue(root, path);
    if (Object.hasOwn(previous.files, path)) {
      if (disk === null || !contentsEqual(disk, previous.files[path])) throw conflict(path);
    } else if (disk !== null) {
      throw conflict(path);
    }
  }
  for (const path of removed) {
    const disk = await readDiskValue(root, path);
    if (disk !== null && !contentsEqual(disk, previous.files[path])) throw conflict(path);
  }

  for (const path of next.folders) await directoryAt(root, path.split('/'), { create: true });
  for (const path of changed) {
    const handle = await fileAt(root, path, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes(next.files[path]));
    await writable.close();
  }
  for (const path of removed) {
    const parts = path.split('/'), name = parts.pop();
    try {
      const directory = await directoryAt(root, parts);
      await directory.removeEntry(name);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  const nextFolders = new Set(next.folders);
  const removedFolders = previous.folders.filter(path => !nextFolders.has(path)).sort((a, b) => b.split('/').length - a.split('/').length);
  for (const path of removedFolders) {
    const parts = path.split('/'), name = parts.pop();
    try {
      const directory = await directoryAt(root, parts);
      await directory.removeEntry(name);
    } catch (error) {
      // Unknown externally-created files are deliberately retained; only empty folders are removed.
      if (!['NotFoundError', 'InvalidModificationError'].includes(error?.name)) throw error;
    }
  }

  return next;
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listDirectoryProjects() {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const projects = await requestResult(database.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).getAll());
    return projects.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  } finally {
    database.close();
  }
}

export async function rememberDirectoryProject(handle, knownProjects = []) {
  let existing = null;
  for (const project of knownProjects) {
    try {
      if (await project.handle.isSameEntry(handle)) { existing = project; break; }
    } catch { /* A stale handle is not the selected folder. */ }
  }
  const project = {
    id: existing?.id || crypto.randomUUID(),
    name: handle.name,
    displayPath: existing?.displayPath || '',
    handle,
    lastOpenedAt: Date.now(),
  };
  const database = await openDatabase();
  if (database) {
    try {
      await requestResult(database.transaction(PROJECT_STORE, 'readwrite').objectStore(PROJECT_STORE).put(project));
    } finally {
      database.close();
    }
  }
  return project;
}

export async function forgetDirectoryProject(id) {
  const database = await openDatabase();
  if (!database) return;
  try {
    await requestResult(database.transaction(PROJECT_STORE, 'readwrite').objectStore(PROJECT_STORE).delete(id));
  } finally {
    database.close();
  }
}

export async function updateProjectLocation(project, value) {
  const displayPath = String(value || '').trim().slice(0, 1024);
  const next = { ...project, displayPath };
  const database = await openDatabase();
  if (!database) throw new Error('Browser storage is unavailable.');
  try { await requestResult(database.transaction(PROJECT_STORE, 'readwrite').objectStore(PROJECT_STORE).put(next)); }
  finally { database.close(); }
  return next;
}
