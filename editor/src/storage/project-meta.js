import { BLOB_TAG, ConflictError, ValidationError, fromBase64, sha256Hex, toBase64, validateBlobRef, validatePortableMetadata } from '@trafficops/template-editor-core';
import { FILE_ATTACHMENT_LIMITS, validateFileAiAttachments } from '@trafficops/template-editor-shell/file-ai-attachments';
import { createDirectoryConversationStore } from './directory-conversation-store.js';
import { withLock } from './locks.js';
import { fileAt, readJson, removePath, writeFile } from './write.js';

const META = '.trafficops/project.json', VALUES = '.trafficops/values.json';
const ATTACHMENT_ID = /^[a-zA-Z0-9-]{1,80}$/, MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const locked = (projectId, fn, locks) => withLock(`trafficops-project-meta:${projectId}`, fn, { locks });

function invalid(condition, message) { if (condition) throw new ValidationError(message); }
const label = (value, max, message) => { invalid(typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value), message); return value; };

// The brief without its attachments.
function briefFields(value) {
  invalid(!plain(value), 'Invalid pending AI brief.');
  invalid(typeof value.prompt !== 'string' || value.prompt.length > 6000, 'The AI prompt must contain at most 6000 characters.');
  invalid(value.generateImages !== undefined && typeof value.generateImages !== 'boolean', 'Invalid AI image choice.');
  invalid(!Array.isArray(value.attachments), 'Invalid pending AI attachments.');
  return { id: label(value.id, 160, 'Invalid pending AI brief ID.'), prompt: value.prompt, mode: label(value.mode, 40, 'Invalid pending AI mode.'), generateImages: value.generateImages === true };
}

// The runtime's rules (validateFileAiAttachments: ids, types, contents, count and size limits, name defaults), plus
// useOnPage, which only an image keeps.
function runtimeAttachments(list) {
  let checked;
  try { checked = validateFileAiAttachments(list); } catch (error) { throw new ValidationError(error.message, { cause: error }); }
  return checked.map((item, index) => ({ ...item, useOnPage: /^image\//.test(item.mime) && list[index].useOnPage === true }));
}

// A stored brief: the shape encodePendingAi returns. Attachment contents are checked again on resolve.
function validatePendingAi(value) {
  const brief = briefFields(value), ids = new Set();
  invalid(value.attachments.length > FILE_ATTACHMENT_LIMITS.count, 'Invalid pending AI attachments.');
  return { ...brief, attachments: value.attachments.map(item => {
    invalid(!plain(item) || typeof item.id !== 'string' || !ATTACHMENT_ID.test(item.id) || ids.has(item.id), 'Invalid pending AI attachment.');
    ids.add(item.id);
    invalid(typeof item.name !== 'string' || item.name.length > 160 || typeof item.mime !== 'string' || !MIME.test(item.mime), 'Invalid pending AI attachment.');
    try { validateBlobRef(item.blob); } catch { throw new ValidationError('Invalid pending AI attachment reference.'); }
    invalid(!['bytes', 'utf8'].includes(item.blob.encoding), 'Invalid pending AI attachment reference.');
    return { id: item.id, name: item.name, mime: item.mime, useOnPage: /^image\//.test(item.mime) && item.useOnPage === true, blob: { [BLOB_TAG]: item.blob[BLOB_TAG], encoding: item.blob.encoding, size: item.blob.size } };
  }) };
}

const noPending = (value, message) => invalid(plain(value) && Object.hasOwn(value, 'pendingAi'), message);

/** `.trafficops/project.json`: portable metadata plus an optional `pendingAi` brief whose attachments are blob refs.
 *  A malformed `pendingAi` never makes the project unreadable: it is omitted and described by `pendingAiError`. */
export async function readProjectMeta(root) {
  const value = await readJson(root, META);
  if (value === null) return null;
  const meta = validatePortableMetadata(value);
  if (value.pendingAi === undefined) return meta;
  try { return { ...meta, pendingAi: validatePendingAi(value.pendingAi) }; } catch (error) { return { ...meta, pendingAiError: `The pending AI brief is invalid and was ignored: ${error.message}` }; }
}

// Read under the meta lock: the file must exist and belong to projectId.
async function ownMeta(root, projectId) {
  const current = await readProjectMeta(root);
  if (!current) throw new ConflictError('The project metadata is missing from the folder.');
  if (current.projectId !== projectId) throw new ConflictError('The folder belongs to a different project.');
  return current;
}

// A prepared brief (refs) whose blobs exist in this folder.
async function preparedPendingAi(root, value) {
  const pendingAi = validatePendingAi(value);
  for (const { blob } of pendingAi.attachments) invalid(!await fileAt(root, `.trafficops/conversations/blobs/${blob[BLOB_TAG]}`), 'A pending AI attachment is missing from the folder.');
  return pendingAi;
}

/** Writes project.json once, optionally with a brief from encodePendingAi (its blobs already written), so a new project's metadata can be the
 *  last thing written. */
export async function createProjectMeta(root, meta, { pendingAi, locks } = {}) {
  noPending(meta, 'Pass a prepared pending AI brief as the pendingAi option.');
  const value = validatePortableMetadata(meta);
  const stored = pendingAi === undefined ? value : { ...value, pendingAi: await preparedPendingAi(root, pendingAi) };
  return locked(value.projectId, async () => {
    if (await fileAt(root, META)) throw new ConflictError('The folder already holds a Studio project.');
    await writeFile(root, META, json(stored));
    return stored;
  }, locks);
}

/** Read-modify-write of identity metadata (spec A11). `pendingAi` is untouchable here; `metadataRevision` is store-owned
 *  and grows by one when `name` or `kind` change. A malformed brief on disk is dropped; the result reports it as
 *  `pendingAiError` (never written). */
export async function updateProjectMeta(root, projectId, patch, { locks } = {}) {
  invalid(!plain(patch), 'Invalid project metadata patch.');
  noPending(patch, 'Only project creation and claimPendingAi change the pending AI brief.');
  invalid(patch.projectId !== undefined && patch.projectId !== projectId, 'The project ID cannot be changed.');
  return locked(projectId, async () => {
    const { pendingAi, pendingAiError, ...current } = await ownMeta(root, projectId);
    const { metadataRevision: _ignored, pendingAiError: _report, ...changes } = patch;
    const merged = validatePortableMetadata({ ...current, ...changes, projectId });
    const identityChanged = merged.name !== current.name || merged.kind !== current.kind;
    const next = { ...merged, metadataRevision: (current.metadataRevision ?? 0) + (identityChanged ? 1 : 0) };
    const stored = pendingAi ? { ...next, pendingAi } : next;
    await writeFile(root, META, json(stored));
    return pendingAiError ? { ...stored, pendingAiError } : stored;
  }, locks);
}

/** Gives the folder a new projectId (make independent), keeping every other field and the brief. Only the current owner
 *  can rekey; a malformed brief on disk is dropped. */
export async function rekeyProjectMeta(root, projectId, nextProjectId, { locks } = {}) {
  return locked(projectId, async () => {
    const { pendingAiError: _dropped, ...current } = await ownMeta(root, projectId);
    const stored = { ...current, ...validatePortableMetadata({ ...current, projectId: nextProjectId }) };
    await writeFile(root, META, json(stored));
    return stored;
  }, locks);
}

/** Validates a brief `{ id, prompt, mode, generateImages, attachments: [{ id, name, mime, dataUrl | text, useOnPage }] }`
 *  with the runtime's attachment rules, without any I/O. Returns `{ pendingAi, blobs }`: the stored shape (attachments
 *  as blob refs) and the `[sha, bytes]` pairs to write with writePendingAiBlobs. */
export async function encodePendingAi(brief) {
  const fields = briefFields(brief), attachments = [], blobs = [];
  for (const { text, dataUrl, ...attachment } of runtimeAttachments(brief.attachments)) {
    const encoding = text === undefined ? 'bytes' : 'utf8', bytes = text === undefined ? fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1)) : encoder.encode(text);
    const sha = await sha256Hex(bytes);
    blobs.push([sha, bytes]);
    attachments.push({ ...attachment, blob: { [BLOB_TAG]: sha, encoding, size: bytes.byteLength } });
  }
  return { pendingAi: { ...fields, attachments }, blobs };
}

/** Writes encoded brief blobs to `.trafficops/conversations/blobs/`. */
export async function writePendingAiBlobs(root, projectId, blobs, { locks } = {}) {
  const store = createDirectoryConversationStore(root, { projectId, locks });
  try { for (const [sha, bytes] of blobs) await store.putBlob(sha, bytes); } finally { store.close(); }
}

/** The brief of `meta.pendingAi` with attachments resolved back to `{ id, name, mime, dataUrl | text, useOnPage }` and
 *  checked again with the runtime's rules. */
export async function resolvePendingAi(root, meta) {
  if (!meta?.pendingAi) return null;
  const { attachments, ...brief } = meta.pendingAi, store = createDirectoryConversationStore(root, { projectId: meta.projectId });
  try {
    const resolved = [];
    for (const { blob, id, name, mime, useOnPage } of attachments) {
      const bytes = await store.getBlob(blob[BLOB_TAG]);
      let content;
      try { content = blob.encoding === 'utf8' ? { text: decoder.decode(bytes) } : { dataUrl: `data:${mime};base64,${toBase64(bytes)}` }; } catch { throw new ValidationError('A pending AI text attachment is not valid UTF-8.'); }
      resolved.push({ id, name, mime, ...content, useOnPage });
    }
    return { ...brief, attachments: runtimeAttachments(resolved) };
  } finally { store.close(); }
}

/** Removes `pendingAi` if its id matches; true for exactly one caller. Its blobs become collectable by the store's GC.
 *  A malformed brief cannot be claimed. */
export async function claimPendingAi(root, projectId, id, { locks } = {}) {
  return locked(projectId, async () => {
    const { pendingAi, pendingAiError, ...rest } = await ownMeta(root, projectId);
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
