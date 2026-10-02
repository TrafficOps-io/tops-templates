import { BLOB_TAG, ConflictError, ValidationError, fromBase64, sha256Hex, toBase64, validateBlobRef, validatePortableMetadata } from '@trafficops/template-editor-core';
import { createDirectoryConversationStore } from './directory-conversation-store.js';
import { withLock } from './locks.js';
import { fileAt, readJson, removePath, writeFile } from './write.js';

const META = '.trafficops/project.json', VALUES = '.trafficops/values.json';
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i, MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const locked = (projectId, fn, locks) => withLock(`trafficops-project-meta:${projectId}`, fn, { locks });

function invalid(condition, message) { if (condition) throw new ValidationError(message); }
const label = (value, max, message) => { invalid(typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value), message); return value; };

// Everything of a brief except its attachments; `attachment` validates one stored or incoming attachment.
function briefFields(value) {
  invalid(!plain(value), 'Invalid pending AI brief.');
  invalid(typeof value.prompt !== 'string' || value.prompt.length > 6000, 'The AI prompt must contain at most 6000 characters.');
  invalid(value.generateImages !== undefined && typeof value.generateImages !== 'boolean', 'Invalid AI image choice.');
  invalid(!Array.isArray(value.attachments) || value.attachments.length > 16, 'Invalid pending AI attachments.');
  return { id: label(value.id, 160, 'Invalid pending AI brief ID.'), prompt: value.prompt, mode: label(value.mode, 40, 'Invalid pending AI mode.'), generateImages: value.generateImages === true };
}
function attachmentFields(value) {
  invalid(!plain(value), 'Invalid pending AI attachment.');
  invalid(typeof value.mime !== 'string' || !MIME.test(value.mime), 'Invalid pending AI attachment type.');
  return { id: label(value.id, 160, 'Invalid pending AI attachment ID.'), name: label(value.name, 160, 'Invalid pending AI attachment name.'), mime: value.mime, useOnPage: /^image\//.test(value.mime) && value.useOnPage === true };
}

function validatePendingAi(value) {
  const brief = briefFields(value);
  return { ...brief, attachments: value.attachments.map(item => {
    const attachment = attachmentFields(item);
    try { validateBlobRef(item.blob); } catch { throw new ValidationError('Invalid pending AI attachment reference.'); }
    invalid(!['bytes', 'utf8'].includes(item.blob.encoding), 'Invalid pending AI attachment reference.');
    return { ...attachment, blob: { [BLOB_TAG]: item.blob[BLOB_TAG], encoding: item.blob.encoding, size: item.blob.size } };
  }) };
}

function validateMeta(value) {
  const meta = validatePortableMetadata(value);
  return value.pendingAi === undefined ? meta : { ...meta, pendingAi: validatePendingAi(value.pendingAi) };
}

const noPending = (value, message) => invalid(plain(value) && Object.hasOwn(value, 'pendingAi'), message);

/** `.trafficops/project.json`: portable metadata plus an optional `pendingAi` brief whose attachments are blob refs. */
export async function readProjectMeta(root) {
  const value = await readJson(root, META);
  return value === null ? null : validateMeta(value);
}

// Read under the meta lock: the file must exist and belong to projectId.
async function ownMeta(root, projectId) {
  const current = await readProjectMeta(root);
  if (!current) throw new ConflictError('The project metadata is missing from the folder.');
  if (current.projectId !== projectId) throw new ConflictError('The folder belongs to a different project.');
  return current;
}

export async function createProjectMeta(root, meta, { locks } = {}) {
  noPending(meta, 'A new project cannot carry a pending AI brief; use storePendingAi.');
  const value = validatePortableMetadata(meta);
  return locked(value.projectId, async () => {
    if (await fileAt(root, META)) throw new ConflictError('The folder already holds a Studio project.');
    await writeFile(root, META, json(value));
    return value;
  }, locks);
}

/** Read-modify-write of identity metadata (D11). `pendingAi` is untouchable here; `metadataRevision` is store-owned
 *  and grows by one when `name` or `kind` change. */
export async function updateProjectMeta(root, projectId, patch, { locks } = {}) {
  invalid(!plain(patch), 'Invalid project metadata patch.');
  noPending(patch, 'Only storePendingAi and claimPendingAi change the pending AI brief.');
  invalid(patch.projectId !== undefined && patch.projectId !== projectId, 'The project ID cannot be changed.');
  return locked(projectId, async () => {
    const { pendingAi, ...current } = await ownMeta(root, projectId);
    const { metadataRevision: _ignored, ...changes } = patch;
    const merged = validatePortableMetadata({ ...current, ...changes, projectId });
    const identityChanged = merged.name !== current.name || merged.kind !== current.kind;
    const next = { ...merged, metadataRevision: (current.metadataRevision ?? 0) + (identityChanged ? 1 : 0) };
    const stored = pendingAi ? { ...next, pendingAi } : next;
    await writeFile(root, META, json(stored));
    return stored;
  }, locks);
}

/** Stores a brief `{ id, prompt, mode, generateImages, attachments: [{ id, name, mime, dataUrl | text, useOnPage }] }`.
 *  Attachment bytes go to `.trafficops/conversations/blobs/` first, then the refs into project.json. */
export async function storePendingAi(root, projectId, brief, { locks } = {}) {
  const fields = briefFields(brief), attachments = [], blobs = [];
  for (const item of brief.attachments) {
    const attachment = attachmentFields(item);
    let bytes, encoding;
    if (typeof item.text === 'string' && item.dataUrl === undefined) { bytes = encoder.encode(item.text); encoding = 'utf8'; }
    else {
      const match = typeof item.dataUrl === 'string' ? item.dataUrl.match(DATA_URL) : null;
      invalid(!match || match[1].toLowerCase() !== attachment.mime.toLowerCase(), 'A pending AI attachment must be a base64 data URL of its type.');
      try { bytes = fromBase64(match[2]); } catch { throw new ValidationError('A pending AI attachment is not valid base64.'); }
      encoding = 'bytes';
    }
    const sha = await sha256Hex(bytes);
    blobs.push([sha, bytes]);
    attachments.push({ ...attachment, blob: { [BLOB_TAG]: sha, encoding, size: bytes.byteLength } });
  }
  // Ownership is checked before any blob is written; blobs are written outside the meta lock (locks never nest).
  await locked(projectId, () => ownMeta(root, projectId), locks);
  const store = createDirectoryConversationStore(root, { projectId, locks });
  try { for (const [sha, bytes] of blobs) await store.putBlob(sha, bytes); } finally { store.close(); }
  const pendingAi = { ...fields, attachments };
  return locked(projectId, async () => {
    const stored = { ...await ownMeta(root, projectId), pendingAi };
    await writeFile(root, META, json(stored));
    return stored;
  }, locks);
}

/** The brief of `meta.pendingAi` with attachments resolved back to `{ id, name, mime, dataUrl | text, useOnPage }`. */
export async function resolvePendingAi(root, meta) {
  if (!meta?.pendingAi) return null;
  const { attachments, ...brief } = meta.pendingAi, store = createDirectoryConversationStore(root, { projectId: meta.projectId });
  try {
    const resolved = [];
    for (const { blob, ...attachment } of attachments) {
      const bytes = await store.getBlob(blob[BLOB_TAG]);
      resolved.push(blob.encoding === 'utf8' ? { id: attachment.id, name: attachment.name, mime: attachment.mime, text: decoder.decode(bytes), useOnPage: attachment.useOnPage } : { id: attachment.id, name: attachment.name, mime: attachment.mime, dataUrl: `data:${attachment.mime};base64,${toBase64(bytes)}`, useOnPage: attachment.useOnPage });
    }
    return { ...brief, attachments: resolved };
  } finally { store.close(); }
}

/** Removes `pendingAi` if its id matches; true for exactly one caller. Its blobs become collectable by the store's GC. */
export async function claimPendingAi(root, projectId, id, { locks } = {}) {
  return locked(projectId, async () => {
    const { pendingAi, ...rest } = await ownMeta(root, projectId);
    if (!pendingAi || pendingAi.id !== id) return false;
    await writeFile(root, META, json(rest));
    return true;
  }, locks);
}

/** `.trafficops/values.json`: parameter values. Absent → {}. */
export async function readValues(root) {
  const value = await readJson(root, VALUES);
  if (value === null) return {};
  if (!plain(value)) throw new ValidationError('.trafficops/values.json must be a JSON object.');
  return value;
}

export async function writeValues(root, values) {
  const settings = plain(values) ? values : {};
  if (Object.keys(settings).length) return writeFile(root, VALUES, json(settings));
  await removePath(root, VALUES);
  // Drop the sidecar folder only when nothing else lives there.
  try { await removePath(root, '.trafficops'); } catch (error) { if (error?.name !== 'InvalidModificationError') throw error; }
}
