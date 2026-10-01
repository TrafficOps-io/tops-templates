import { ConflictError } from '@trafficops/template-editor-core';
import { validateStudioProject } from './studio-library.js';
import { validateAttachments } from '@trafficops/template-editor-shell/ai-attachments';
import { validateBlockEditScope, serializeBlockEditScope, assertBlockDraftScope } from '@trafficops/template-editor-shell/block-edit-scope';

const DATABASE = 'trafficops-studio-ai-recovery', STORE = 'drafts';
function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid AI recovery ${label}.`);
  return value;
}

// Recovery is a separate, bounded snapshot of completed operations. Connection
// credentials, provider messages, diagnostics and streamed fragments are omitted.
export function validateAiRecovery(record) {
  if (!record || typeof record !== 'object') throw new Error('Invalid AI recovery record.');
  const projectId = identifier(record.projectId, 'project ID'), token = identifier(record.token, 'token');
  if (!Number.isSafeInteger(record.baseRevision) || record.baseRevision < 1) throw new Error('Invalid AI recovery revision.');
  if (!['create', 'edit', 'content'].includes(record.kind)) throw new Error('Invalid AI recovery mode.');
  if (typeof record.valid !== 'boolean') throw new Error('Invalid AI recovery validation state.');
  const steps = record.steps === undefined ? 0 : record.steps, prompt = record.prompt === undefined ? '' : record.prompt, summary = record.summary === undefined ? '' : record.summary;
  if (!Number.isSafeInteger(steps) || steps < 0 || steps > 64) throw new Error('Invalid AI recovery step count.');
  if (typeof prompt !== 'string' || prompt.length > 6000 || typeof summary !== 'string' || summary.length > 5000) throw new Error('AI recovery text exceeds its limit.');
  if (record.generateImages !== undefined && typeof record.generateImages !== 'boolean') throw new Error('Invalid AI recovery image choice.');
  if (record.values === null) throw new Error('Invalid AI recovery field values.');
  const clarifications = record.clarifications === undefined ? [] : record.clarifications;
  if (!Array.isArray(clarifications) || clarifications.length > 8 || clarifications.some(value => typeof value !== 'string' || !value.trim() || value.length > 6000)) throw new Error('Invalid AI recovery clarifications.');
  const project = validateStudioProject({ id: projectId, name: 'AI recovery', kind: 'landing', files: record.files,
    settings: record.values === undefined ? {} : record.values });
  const attachments = validateAttachments(record.attachments === undefined ? [] : record.attachments);
  const editScope = record.editScope === undefined ? undefined : validateBlockEditScope(record.editScope);
  if (editScope) {
    if (record.kind !== 'edit') throw new Error('Selected-block recovery must retain edit mode.');
    assertBlockDraftScope(editScope, { files: project.files, rawValues: project.settings });
  }
  return { projectId, token, baseRevision: record.baseRevision, kind: record.kind, prompt, summary, steps, clarifications: [...clarifications],
    valid: record.valid, files: project.files, values: project.settings, attachments,
    ...(record.generateImages === undefined ? {} : { generateImages: record.generateImages }),
    ...(editScope ? { editScope: serializeBlockEditScope(editScope) } : {}) };
}

function storageError(error) {
  if (error?.code === 'conflict') return error;
  return new Error(error?.name === 'QuotaExceededError'
    ? 'Browser storage is full. The AI draft could not be saved for recovery. Keep Studio open and download a source ZIP before closing it.'
    : 'Studio could not save or load AI recovery. Keep Studio open and download a source ZIP before closing it.', { cause: error });
}
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(storageError());
  return new Promise((resolve, reject) => {
    let request, settled = false;
    try { request = globalThis.indexedDB.open(DATABASE, 1); } catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'projectId' }); };
    request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { settled = true; reject(storageError(request.error)); };
    request.onblocked = () => { settled = true; reject(storageError()); };
  });
}
async function transaction(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let tx, result, failure;
      try { tx = database.transaction(STORE, mode); } catch (error) { reject(storageError(error)); return; }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(failure || tx.error));
      tx.onerror = () => { failure ||= tx.error; };
      const request = (value, done) => {
        value.onsuccess = () => { try { done(value.result); } catch (error) { failure = error; tx.abort(); } };
        value.onerror = () => { failure = value.error; };
      };
      try { operation(tx.objectStore(STORE), request, value => { result = value; }); }
      catch (error) { failure = error; tx.abort(); }
    });
  } finally { database.close(); }
}
export function getAiRecovery(projectId) {
  identifier(projectId, 'project ID');
  return transaction('readonly', (store, request, result) => request(store.get(projectId), value => result(value ? validateAiRecovery(value) : null)));
}
export function saveAiRecovery(record, { expectedToken } = {}) {
  const snapshot = validateAiRecovery(record);
  if (expectedToken !== undefined && expectedToken !== null) identifier(expectedToken, 'token');
  return transaction('readwrite', (store, request, result) => request(store.get(snapshot.projectId), current => {
    if (expectedToken === null ? Boolean(current) : expectedToken !== undefined && current?.token !== expectedToken) throw new ConflictError('The AI recovery draft changed in another tab. Reopen the project before continuing.');
    request(store.put(snapshot), () => result(snapshot));
  }));
}
export function deleteAiRecovery(projectId, { expectedToken } = {}) {
  identifier(projectId, 'project ID');
  if (expectedToken !== undefined) identifier(expectedToken, 'token');
  return transaction('readwrite', (store, request, result) => request(store.get(projectId), current => {
    if (current && expectedToken !== undefined && current.token !== expectedToken) throw new ConflictError('A newer AI recovery draft exists. Reopen the project before discarding it.');
    request(store.delete(projectId), () => result(undefined));
  }));
}
