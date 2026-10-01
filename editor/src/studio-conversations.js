import { ConflictError, decodePortablePayload, encodePortablePayload, validateConversationDocument, clonePortablePayload } from '@trafficops/template-editor-core';
import { readProjectMetadata, readProjectSidecar, writeProjectMetadata, writeProjectSidecar } from './directory-projects.js';

const DATABASE = 'trafficops-studio-conversations', STORE = 'documents', SYNC = 'disk-sync';
const listeners = new Map(), queues = new Map();
let channel;
const empty = projectId => ({ schema: 1, projectId, revision: 0, threads: [], runs: [] });

function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Browser storage is unavailable. Conversation history could not be saved.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'projectId' });
      if (!request.result.objectStoreNames.contains(SYNC)) request.result.createObjectStore(SYNC, { keyPath: 'projectId' });
    };
    request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { settled = true; reject(request.error); };
    request.onblocked = () => { settled = true; reject(new Error('Conversation storage is being upgraded in another window.')); };
  });
}

async function transaction(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, SYNC], mode);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Conversation history could not be saved.'));
      const request = (value, done) => {
        value.onsuccess = () => { try { done(value.result); } catch (error) { failure = error; tx.abort(); } };
        value.onerror = () => { failure = value.error; };
      };
      try { operation(tx.objectStore(STORE), tx.objectStore(SYNC), request, value => { result = value; }); }
      catch (error) { failure = error; tx.abort(); }
    });
  } finally { db.close(); }
}

export async function loadConversationDocument(projectId) {
  validateConversationDocument(empty(projectId));
  if (!globalThis.indexedDB) return empty(projectId);
  return transaction('readonly', (store, _sync, request, result) => request(store.get(projectId), value => result(value ? validateConversationDocument(value, projectId) : empty(projectId))));
}

/** A compare-and-swap commits only when the complete IDB transaction succeeds. */
export async function saveConversationDocument(document, { expectedRevision = document.revision, pendingDisk = false, preserveRevision = false } = {}) {
  const detached = validateConversationDocument(document);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid expected conversation revision.');
  if (preserveRevision && detached.revision < expectedRevision) throw new ConflictError('Imported conversation revision cannot silently replace a newer revision.');
  const saved = await transaction('readwrite', (store, sync, request, result) => request(store.get(detached.projectId), current => {
    if ((current?.revision ?? 0) !== expectedRevision) throw new ConflictError('Conversation history changed in another window. Reload the dialogue before saving.');
    const value = { ...detached, revision: preserveRevision ? detached.revision : expectedRevision + 1 };
    if (!Number.isSafeInteger(value.revision)) throw new Error('Conversation revision limit reached.');
    delete value.storageWarning;
    store.put(value);
    if (pendingDisk) sync.put({ projectId: value.projectId, revision: value.revision });
    result(value);
  }));
  publish(saved);
  return validateConversationDocument(saved);
}

export function deleteConversationDocument(projectId) {
  return transaction('readwrite', (store, sync) => { store.delete(projectId); sync.delete(projectId); });
}
function pendingDisk(projectId) {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return transaction('readonly', (_store, sync, request, result) => request(sync.get(projectId), result));
}

function broadcast() {
  if (!channel && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(DATABASE);
    channel.onmessage = event => {
      if (typeof event.data?.projectId !== 'string' || !listeners.has(event.data.projectId)) return;
      loadConversationDocument(event.data.projectId).then(value => notify(value)).catch(() => {});
    };
  }
  return channel;
}
function notify(document) { for (const listener of listeners.get(document.projectId) || []) { try { listener(structuredClone(document)); } catch { /* Detached view. */ } } }
function publish(document) { notify(document); broadcast()?.postMessage({ projectId: document.projectId, revision: document.revision }); }

export async function readDirectoryConversations(directory, projectId) {
  const text = await readProjectSidecar(directory, 'conversations.json');
  return text === null ? null : validateConversationDocument(decodePortablePayload(text), projectId);
}

/** Remap every internal identifier; retained bytes are detached and never execute. */
export function cloneConversationDocument(document, projectId, { newId = () => crypto.randomUUID() } = {}) {
  const source = validateConversationDocument(document);
  const ids = new Map();
  const contentKeys = new Set(['files', 'values', 'translations', 'settings', 'value', 'baselineValues', 'baselineRawValues']);
  function collect(value, key = '') {
    if (contentKeys.has(key)) return;
    if (!value || typeof value !== 'object' || value instanceof Uint8Array) return;
    if (typeof value.id === 'string' && !ids.has(value.id)) ids.set(value.id, newId());
    for (const [name, item] of Object.entries(value)) collect(item, name);
  }
  collect(source.threads); collect(source.runs);
  function remap(value, key = '') {
    if (contentKeys.has(key)) return clonePortablePayload(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (Array.isArray(value)) return value.map(item => remap(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remap(item, name)]));
    if (key === 'projectId' && value === source.projectId) return projectId;
    if (typeof value === 'string' && (key === 'id' || key === 'rebaseFrom' || /(?:Id|Ids)$/.test(key)) && ids.has(value)) return ids.get(value);
    return value;
  }
  const copy = remap(source);
  copy.projectId = projectId; copy.revision = 0;
  for (const run of copy.runs) {
    if (['running', 'queued'].includes(run.state)) run.state = 'interrupted';
    delete run.owner;
  }
  return validateConversationDocument(copy, projectId);
}

export function interruptImportedRuns(document) {
  const copy = validateConversationDocument(document);
  for (const run of copy.runs) {
    if (['running', 'queued'].includes(run.state)) run.state = 'interrupted';
    delete run.owner;
  }
  return copy;
}

/** Folder history is mirrored after local durability, retaining a retry journal on disk failure. */
/** @param {{projectId:string, directory?:FileSystemDirectoryHandle, kind?:string, name?:string}} options */
export function createConversationPort({ projectId, directory = undefined, kind = 'landing', name = directory?.name || 'Project' }) {
  validateConversationDocument(empty(projectId));
  let diskRevision = null;
  async function mirror(document) {
    const metadata = await readProjectMetadata(directory);
    if (metadata && metadata.projectId !== projectId) throw new ConflictError('The folder belongs to a different project. History remains saved on this device.');
    const disk = await readDirectoryConversations(directory, projectId);
    if (disk && diskRevision !== null && disk.revision !== diskRevision && disk.revision !== document.revision) throw new ConflictError('Conversation history changed outside Studio. History remains saved on this device.');
    if (disk && disk.revision > document.revision) throw new ConflictError('The folder contains newer conversation history. Reload it before saving.');
    const latest = await loadConversationDocument(projectId);
    if (latest.revision !== document.revision) return latest;
    const encoded = encodePortablePayload(document);
    await writeProjectSidecar(directory, 'conversations.json', encoded);
    const verified = await readDirectoryConversations(directory, projectId);
    if (encodePortablePayload(verified) !== encoded) throw new Error('Conversation folder write could not be verified.');
    await writeProjectMetadata(directory, { ...(metadata || { schema: 1, projectId, kind, name }), metadataRevision: document.revision }, { historyOnly: true });
    diskRevision = document.revision;
    await transaction('readwrite', (_store, sync, request) => request(sync.get(projectId), pending => { if (pending?.revision === document.revision) sync.delete(projectId); }));
    return document;
  }
  function enqueue(operation) {
    const prior = queues.get(projectId) || Promise.resolve();
    const run = () => operation();
    const task = prior.catch(() => {}).then(() => globalThis.navigator?.locks?.request ? navigator.locks.request(`trafficops-conversations:${projectId}`, run) : run());
    queues.set(projectId, task);
    task.finally(() => { if (queues.get(projectId) === task) queues.delete(projectId); }).catch(() => {});
    return task;
  }
  return {
    projectId,
    load() { return enqueue(async () => {
      let local = await loadConversationDocument(projectId);
      if (!directory) return local;
      try {
        const disk = await readDirectoryConversations(directory, projectId);
        diskRevision = disk?.revision ?? 0;
        const pending = await pendingDisk(projectId);
        if (pending && disk && disk.revision > local.revision) throw new ConflictError('Folder history changed while local history was awaiting a save. Your local recovery is retained.');
        if (disk && disk.revision > local.revision) local = await saveConversationDocument(disk, { expectedRevision: local.revision, preserveRevision: true });
        else if (disk && disk.revision === local.revision && encodePortablePayload(disk) !== encodePortablePayload(local)) throw new ConflictError('Folder history differs from this device. Review the project before continuing.');
        else if (local.revision > diskRevision) local = await mirror(local);
        return local;
      } catch (error) { return { ...local, storageWarning: error.message }; }
    }); },
    save(document, { expectedRevision = document.revision } = {}) { return enqueue(async () => {
      const saved = await saveConversationDocument(validateConversationDocument(document, projectId), { expectedRevision, pendingDisk: Boolean(directory) });
      if (!directory) return saved;
      try { return await mirror(saved); }
      catch (error) { const retained = { ...saved, storageWarning: error.message }; notify(retained); return retained; }
    }); },
    subscribe(listener) {
      let set = listeners.get(projectId);
      if (!set) listeners.set(projectId, set = new Set());
      set.add(listener); broadcast();
      return () => { set.delete(listener); if (!set.size) listeners.delete(projectId); };
    },
  };
}
