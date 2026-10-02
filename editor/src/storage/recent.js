import { ValidationError } from '@trafficops/template-editor-core';

// D3: folders opened in Studio, by projectId. OPFS projects are listed from the OPFS directory instead.
const DATABASE = 'trafficops-studio-recent', STORE = 'projects';

function open() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'projectId' }); };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Studio storage is being upgraded in another window.'));
  });
}

// Runs operation(store, setResult) in one transaction; resolves with the result once the transaction commits.
async function transaction(mode, operation, { required = false } = {}) {
  const db = await open();
  if (!db) { if (required) throw new Error('Browser storage is unavailable. Studio cannot remember this folder.'); return undefined; }
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], mode);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Studio could not update its list of recent projects.'));
      try { operation(tx.objectStore(STORE), value => { result = value; }, error => { failure = error; tx.abort(); }); } catch (error) { failure = error; tx.abort(); }
    });
  } finally { db.close(); }
}

function validEntry(entry) {
  const { projectId, name, kind, handle, lastOpenedAt } = entry;
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 160) throw new ValidationError('A recent project needs a project ID.');
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new ValidationError('A recent project needs a name.');
  if (!['landing', 'template'].includes(kind)) throw new ValidationError('Invalid recent project kind.');
  if (handle?.kind !== 'directory') throw new ValidationError('A recent project needs its folder.');
  if (!Number.isSafeInteger(lastOpenedAt) || lastOpenedAt < 0) throw new ValidationError('Invalid recent project time.');
  return { projectId, name, kind, handle, lastOpenedAt };
}

/** [{ projectId, name, kind, handle, lastOpenedAt }], most recently opened first. [] without indexedDB. */
export async function listRecent() {
  const entries = await transaction('readonly', (store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result); }) ?? [];
  return entries.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

/** Upsert by projectId: the given name, kind, handle and lastOpenedAt (default now) replace the stored ones. */
export async function rememberRecent(entry) {
  if (typeof entry?.projectId !== 'string') throw new ValidationError('A recent project needs a project ID.');
  return transaction('readwrite', (store, done, fail) => {
    const request = store.get(entry.projectId);
    request.onsuccess = () => {
      const defined = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
      let next;
      try { next = validEntry({ ...request.result, lastOpenedAt: Date.now(), ...defined }); } catch (error) { fail(error); return; }
      try { store.put(next); } catch (error) {
        fail(error?.name === 'DataCloneError' ? new Error('Studio could not store this folder in its list of recent projects. Choose the folder again.', { cause: error }) : error);
        return;
      }
      done(next);
    };
  }, { required: true });
}

export async function forgetRecent(projectId) {
  await transaction('readwrite', store => { store.delete(projectId); });
}

/** The recent entry whose folder is `handle` (isSameEntry), or null. Stale handles never match. */
export async function findSameEntry(handle) {
  for (const entry of await listRecent()) {
    try { if (await entry.handle.isSameEntry(handle)) return entry; } catch { /* A stale handle is not the selected folder. */ }
  }
  return null;
}
