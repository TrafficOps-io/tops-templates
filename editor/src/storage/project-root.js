import { ConflictError, ValidationError, clonePortablePayload, createStoreConversationPort, validateConversationDocument, validatePortableMetadata } from '@trafficops/template-editor-core';
import { createDirectoryConversationStore } from './directory-conversation-store.js';
import { readProjectTree, syncProjectTree } from './files.js';
import { createProjectMeta, encodePendingAi, readProjectMeta, readValues, rekeyProjectMeta, writePendingAiBlobs, writeValues } from './project-meta.js';
import { listRecent, opfsOpenedTimes } from './recent.js';
import { classifyFolder, listOpfsRoots, queryAccess } from './roots.js';
import { lastModified } from './write.js';

const META = '.trafficops/project.json';
// Project content inside run snapshots: copied as is, never remapped.
const CONTENT_KEYS = new Set(['files', 'values', 'translations', 'settings', 'value', 'baselineValues', 'baselineRawValues']);
const newUuid = () => crypto.randomUUID();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// One-shot access to a folder's history through the store port. No background GC: these operations end here.
// `lockId` names the store's lock (and channel): the folder's current projectId while history is rewritten for a new one.
async function withHistory(root, projectId, operation, { lockId = projectId, locks } = {}) {
  const store = createDirectoryConversationStore(root, { projectId: lockId, locks });
  const { collectGarbage: _collect, ...oneShot } = store;
  try { return await operation(createStoreConversationPort(oneShot, { projectId })); } finally { store.close(); }
}

async function ownedMeta(root) {
  const meta = await readProjectMeta(root);
  if (!meta) throw new ValidationError('This folder is not a Studio project.');
  return meta;
}

function interrupt(document) {
  for (const run of document.runs) {
    if (['running', 'queued'].includes(run.state)) run.state = 'interrupted';
    delete run.owner;
  }
  return document;
}

/** A joined history document copied for a new project: every internal id is remapped (references follow), project
 *  content is copied untouched, active runs are interrupted and stored dialogue revisions are dropped. */
export function remapConversation(document, projectId, { newId = newUuid } = {}) {
  const source = validateConversationDocument(document), ids = new Map();
  function collect(value, key = '') {
    if (CONTENT_KEYS.has(key) || !value || typeof value !== 'object' || value instanceof Uint8Array) return;
    if (typeof value.id === 'string' && !ids.has(value.id)) ids.set(value.id, newId());
    for (const [name, item] of Object.entries(value)) collect(item, name);
  }
  collect(source.threads); collect(source.runs);
  function remap(value, key = '') {
    if (CONTENT_KEYS.has(key)) return clonePortablePayload(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (Array.isArray(value)) return value.map(item => remap(item, key));
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, remap(item, name)]));
    if (key === 'projectId' && value === source.projectId) return projectId;
    if (typeof value === 'string' && (key === 'id' || key === 'rebaseFrom' || /(?:Id|Ids)$/.test(key)) && ids.has(value)) return ids.get(value);
    return value;
  }
  const { storageWarning: _warning, ...rest } = remap(source);
  const copy = { ...rest, projectId, revision: 0, threads: rest.threads.map(({ revision: _revision, ...thread }) => thread) };
  return validateConversationDocument(interrupt(copy), projectId);
}

/** Imported history keeps its ids; its active runs are interrupted. */
export function interruptImportedRuns(document) {
  return interrupt(validateConversationDocument(document));
}

/** Writes a new project into `root`: files → values → history → brief blobs → project.json LAST, so an interrupted
 *  create never leaves a folder that claims to be a complete project. Everything is validated before the first write.
 *  The destination must be empty (system clutter aside) unless `allowExistingFiles`; a project is never overwritten.
 *  `conversations` is a joined document of this projectId; `brief` is a pending AI brief (see encodePendingAi).
 *  Returns the stored meta. */
export async function createProjectInRoot(root, { projectId = newUuid(), kind = 'landing', name, files = {}, folders = [], values, brief, sourceTemplateId, conversations, allowExistingFiles = false, now = Date.now } = {}) {
  const meta = validatePortableMetadata({ schema: 1, projectId, kind, name, metadataRevision: 0, createdAt: now(), ...(sourceTemplateId === undefined ? {} : { sourceTemplateId }) });
  const history = conversations ? validateConversationDocument(conversations, projectId) : null;
  const encoded = brief ? await encodePendingAi(brief) : null;
  const { status } = await classifyFolder(root);
  if (status === 'project') throw new ConflictError('The folder already holds a Studio project.');
  if (status === 'files' && !allowExistingFiles) throw new ConflictError('Choose an empty folder for the new project.');
  await syncProjectTree(root, { files: {}, folders: [] }, { files, folders });
  if (plain(values) && Object.keys(values).length) await writeValues(root, values);
  if (history?.threads.length) {
    // New history: dialogue revisions restart in this folder.
    const fresh = { ...history, threads: history.threads.map(({ revision: _revision, ...thread }) => thread) };
    await withHistory(root, projectId, async port => port.save(fresh, { expectedRevision: (await port.load()).revision }));
  }
  if (encoded) await writePendingAiBlobs(root, projectId, encoded.blobs);
  return createProjectMeta(root, meta, { pendingAi: encoded?.pendingAi });
}

/** Gives an existing folder of files a Studio identity. Its tree must be readable as a project. */
export async function adoptFolder(root, { name = root.name, kind = 'landing', now = Date.now } = {}) {
  await readProjectTree(root);
  return createProjectMeta(root, { schema: 1, projectId: newUuid(), kind, name, metadataRevision: 0, createdAt: now() });
}

/** Recent folders and OPFS projects: [{ projectId, name, kind, source: 'folder' | 'opfs', handle, lastOpenedAt, access }],
 *  newest first; OPFS entries add `folderName` (for deleteOpfsRoot: a rekeyed project keeps its folder). A projectId
 *  known from both is listed once, as its recent folder. An OPFS project's lastOpenedAt is the later of its recorded
 *  open (rememberOpfsOpened; `localStorage` option for tests) and its project.json modification time; OPFS folders
 *  without readable metadata (an interrupted create) are skipped. */
export async function listKnownProjects(options = {}) {
  const known = new Map(), opened = opfsOpenedTimes(Object.hasOwn(options, 'localStorage') ? { storage: options.localStorage } : {});
  for (const { projectId, name, kind, handle, lastOpenedAt } of await listRecent()) known.set(projectId, { projectId, name, kind, source: 'folder', handle, lastOpenedAt, access: await queryAccess(handle) });
  let roots = [];
  try { roots = await listOpfsRoots(options); } catch { /* No browser file storage: recent folders only. */ }
  for (const { name: folderName, handle } of roots) {
    let meta;
    try { meta = await readProjectMeta(handle); } catch { continue; }
    if (!meta || known.has(meta.projectId)) continue;
    known.set(meta.projectId, { projectId: meta.projectId, name: meta.name, kind: meta.kind, source: 'opfs', handle, folderName, lastOpenedAt: Math.max(opened[meta.projectId] ?? 0, await lastModified(handle, META) ?? 0), access: await queryAccess(handle) });
  }
  return [...known.values()].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

/** Everything a project folder holds: { meta, files, folders, values, conversations } (the joined history document). */
export async function readProjectSnapshot(root) {
  const meta = await ownedMeta(root);
  const { files, folders } = await readProjectTree(root);
  const values = await readValues(root);
  const conversations = await withHistory(root, meta.projectId, port => port.load());
  return { meta, files, folders, values, conversations };
}

/** A folder copied outside Studio shares its source's projectId. This gives it its own: the history is rewritten under
 *  new ids (new dialogue files first, then the old ones are deleted), then project.json is rekeyed. Every history write
 *  takes the OLD id's conversation lock, so it serializes with any window still writing under that id, and the rekey
 *  takes the old id's meta lock; the locks are taken one after another, never nested. A damaged dialogue file is left
 *  in place. */
export async function makeIndependent(root, { locks } = {}) {
  const meta = await ownedMeta(root), projectId = newUuid(), current = { lockId: meta.projectId, locks };
  const remapped = remapConversation(await withHistory(root, meta.projectId, port => port.load(), current), projectId);
  // A new-id port over the folder sees the old dialogues as its base: one save writes the remapped ones, then deletes
  // the old ones (each a CAS on its revision).
  await withHistory(root, projectId, async port => port.save(remapped, { expectedRevision: (await port.load()).revision }), current);
  return rekeyProjectMeta(root, meta.projectId, projectId, { locks });
}

/** Copies a project into an empty destination under a new identity, with remapped history and without the brief.
 *  A destination holding anything but system clutter is rejected before anything is written. */
export async function copyProject(sourceRoot, destinationRoot, { name } = {}) {
  const { meta, files, folders, values, conversations } = await readProjectSnapshot(sourceRoot), projectId = newUuid();
  return createProjectInRoot(destinationRoot, { projectId, kind: meta.kind, name: name ?? meta.name, files, folders, values, sourceTemplateId: meta.sourceTemplateId, conversations: remapConversation(conversations, projectId) });
}
