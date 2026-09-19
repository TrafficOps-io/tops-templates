import { ConflictError } from '@trafficops/template-editor-core';
import { LIMITS, projectFolders, validateProject } from './project.js';

// Keep browser projects separate from directory handles and the legacy recovery copy.
const DATABASE = 'trafficops-studio-library';
const PROJECTS = 'projects';
const PREFERENCES = 'preferences';
const encoder = new TextEncoder();

function plainObject(value) {
  return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function projectId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('A Studio project needs a valid ID.');
  return value;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid project ${label}.`);
  return value;
}

function cloneSettings(settings) {
  if (!plainObject(settings)) throw new Error('Project settings must be a JSON object.');
  const ancestors = new Set();
  let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 100000 || depth > 64) throw new Error('Project settings are too complex.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!Array.isArray(value) && !plainObject(value)) throw new Error('Project settings must contain only JSON values.');
    if (ancestors.has(value)) throw new Error('Project settings cannot contain circular references.');
    ancestors.add(value);
    const result = Array.isArray(value) ? Array.from(value, item => visit(item, depth + 1)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]));
    ancestors.delete(value);
    return result;
  }
  const result = visit(settings, 0);
  if (encoder.encode(JSON.stringify(result)).byteLength > LIMITS.text) throw new Error('Project settings exceed 2 MiB.');
  return result;
}

/** Validate and detach a complete project snapshot, including binary assets. */
export function validateStudioProject(record) {
  if (!plainObject(record)) throw new Error('A Studio project must be an object.');
  const id = projectId(record.id);
  if (!['template', 'landing'].includes(record.kind)) throw new Error('Choose a template or landing project.');
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.trim().length > 200 || /[\x00-\x1f\x7f]/.test(record.name)) throw new Error('Project names must contain 1–200 characters.');
  if (!plainObject(record.files)) throw new Error('Project files must be an object.');
  validateProject(record.files);
  if (record.folders !== undefined && (!Array.isArray(record.folders) || record.folders.some(folder => typeof folder !== 'string'))) throw new Error('Project folders must be an array of paths.');
  const folders = projectFolders(record.files, record.folders || []);
  if (folders.length + Object.keys(record.files).length > LIMITS.count) throw new Error(`A project may contain up to ${LIMITS.count} files and folders.`);
  const now = Date.now();
  const revision = record.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid project revision.');
  const result = {
    id, kind: record.kind, name: record.name.trim(), revision,
    files: Object.fromEntries(Object.entries(record.files).map(([path, value]) => [path, typeof value === 'string' ? value : new Uint8Array(value)])),
    folders, settings: cloneSettings(record.settings ?? {}),
    createdAt: timestamp(record.createdAt ?? now, 'creation time'),
    updatedAt: timestamp(record.updatedAt ?? now, 'update time'),
  };
  if (record.sourceTemplateId !== undefined) result.sourceTemplateId = projectId(record.sourceTemplateId);
  if (record.aiPrompt !== undefined) {
    if (typeof record.aiPrompt !== 'string' || record.aiPrompt.length > 6000) throw new Error('The AI prompt must contain at most 6000 characters.');
    result.aiPrompt = record.aiPrompt;
  }
  if (record.aiStarted !== undefined) {
    if (typeof record.aiStarted !== 'boolean') throw new Error('Invalid AI generation state.');
    result.aiStarted = record.aiStarted;
  }
  return result;
}

export function createStudioProject(snapshot, { id = globalThis.crypto.randomUUID(), now = Date.now() } = {}) {
  return validateStudioProject({ ...snapshot, id, revision: 0, createdAt: now, updatedAt: now });
}

/** A copy owns its files/settings; a landing never edits its source template. */
export function cloneStudioProject(source, { kind = source.kind, name = `${source.name} copy`, id = globalThis.crypto.randomUUID(), now = Date.now() } = {}) {
  const original = validateStudioProject(source);
  if (id === original.id) throw new Error('A project copy needs a new ID.');
  const { aiPrompt, aiStarted, sourceTemplateId, ...snapshot } = original;
  return createStudioProject({ ...snapshot, kind, name, ...(kind === 'landing' && original.kind === 'template' ? { sourceTemplateId: original.id } : sourceTemplateId && kind === 'landing' ? { sourceTemplateId } : {}) }, { id, now });
}

function storageError(error) {
  if (error?.code === 'conflict') return error;
  const message = error?.name === 'QuotaExceededError'
    ? 'Browser storage is full. Export your projects and free some space before saving again.'
    : `Studio could not access browser storage${error?.message ? `: ${error.message}` : '.'}`;
  return new Error(message, { cause: error });
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Browser storage is unavailable. Enable browser storage to save Studio projects.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    try { request = globalThis.indexedDB.open(DATABASE, 1); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS)) database.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(PREFERENCES)) database.createObjectStore(PREFERENCES);
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => { settled = true; reject(storageError(request.error)); };
    request.onblocked = () => { settled = true; reject(new Error('Studio storage is being upgraded in another tab. Close the other Studio tabs and try again.')); };
  });
}

// Request success is not durable: only transaction completion confirms a save.
async function transact(stores, mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let transaction, result, failure;
      try { transaction = database.transaction(stores, mode); }
      catch (error) { reject(storageError(error)); return; }
      const fail = error => {
        failure = error;
        try { transaction.abort(); } catch { reject(storageError(error)); }
      };
      const request = (value, onSuccess) => {
        value.onsuccess = () => {
          try { onSuccess(value.result); } catch (error) { fail(error); }
        };
        value.onerror = () => { failure = value.error; };
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(storageError(failure || transaction.error));
      transaction.onerror = () => { failure ||= transaction.error; };
      try { operation(transaction, request, value => { result = value; }); }
      catch (error) { fail(error); }
    });
  } finally { database.close(); }
}

export function listStudioProjects() {
  return transact([PROJECTS], 'readonly', (transaction, request, result) => {
    request(transaction.objectStore(PROJECTS).getAll(), projects => result(projects.map(validateStudioProject).sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))));
  });
}

export async function getStudioProject(id) {
  projectId(id);
  return transact([PROJECTS], 'readonly', (transaction, request, result) => {
    request(transaction.objectStore(PROJECTS).get(id), project => result(project ? validateStudioProject(project) : null));
  });
}

/** expectedRevision:null creates only; a number rejects stale writes across tabs. */
export async function saveStudioProject(record, { expectedRevision } = {}) {
  const snapshot = validateStudioProject(record);
  if (expectedRevision !== undefined && expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new Error('Invalid expected project revision.');
  return transact([PROJECTS], 'readwrite', (transaction, request, result) => {
    const store = transaction.objectStore(PROJECTS);
    request(store.get(snapshot.id), existing => {
      if (expectedRevision === null ? Boolean(existing) : expectedRevision !== undefined && existing?.revision !== expectedRevision) throw new ConflictError('This Studio project changed in another tab. Reopen it before saving your changes.');
      const previous = existing ? validateStudioProject(existing) : null;
      const saved = { ...snapshot, createdAt: previous?.createdAt ?? snapshot.createdAt, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? -1) + 1), revision: (previous?.revision ?? 0) + 1 };
      if (!Number.isSafeInteger(saved.revision) || !Number.isSafeInteger(saved.updatedAt)) throw new Error('Project revision limit reached. Create a copy to continue.');
      request(store.put(saved), () => result(saved));
    });
  });
}

export async function deleteStudioProject(id) {
  projectId(id);
  return transact([PROJECTS, PREFERENCES], 'readwrite', (transaction, request) => {
    transaction.objectStore(PROJECTS).delete(id);
    const preferences = transaction.objectStore(PREFERENCES);
    request(preferences.get('active-project'), active => { if (active === id) preferences.delete('active-project'); });
  });
}

export function getActiveStudioProjectId() {
  return transact([PROJECTS, PREFERENCES], 'readonly', (transaction, request, result) => {
    request(transaction.objectStore(PREFERENCES).get('active-project'), id => {
      if (!id) { result(null); return; }
      request(transaction.objectStore(PROJECTS).get(id), project => result(project ? id : null));
    });
  });
}

export async function setActiveStudioProjectId(id) {
  if (id !== null) projectId(id);
  return transact([PROJECTS, PREFERENCES], 'readwrite', (transaction, request) => {
    const preferences = transaction.objectStore(PREFERENCES);
    if (id === null) { preferences.delete('active-project'); return; }
    request(transaction.objectStore(PROJECTS).get(id), project => {
      if (!project) throw new Error('The selected Studio project no longer exists.');
      preferences.put(id, 'active-project');
    });
  });
}
