import { ConflictError, validatePortableMetadata, encodePortablePayload, decodePortablePayload, validateConversationDocument } from '@trafficops/template-editor-core';
import { validateStudioProject } from './studio-library.js';
import { ensureProjectPermission, readDirectoryProject, readProjectMetadata, readProjectSettings, readProjectSidecar, writeProjectSidecar, writeProjectMetadata, writeProjectSettings, syncDirectoryProject, projectSnapshotEqual } from './directory-projects.js';
import { cloneConversationDocument, interruptImportedRuns } from './studio-conversations.js';

export function projectMetadata(record) {
  return validatePortableMetadata({ schema: 1, projectId: record.projectId || record.id, kind: record.kind || 'landing', name: record.name,
    contentRevision: record.contentRevision ?? (Number.isSafeInteger(record.revision) ? record.revision : 0), metadataRevision: record.metadataRevision ?? 0,
    ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt }),
    ...(record.sourceTemplateId ? { sourceTemplateId: record.sourceTemplateId } : {}),
    ...(record.appliedAiRuns ? { appliedAiRuns: record.appliedAiRuns } : {}) });
}

/** Snapshot-only; the helper never creates a starter or writes to the selected folder. */
export async function readPortableDirectory(handle) {
  const [snapshot, settings, metadata, history, journal] = await Promise.all([
    readDirectoryProject(handle), readProjectSettings(handle), readProjectMetadata(handle),
    readProjectSidecar(handle, 'conversations.json'), readProjectSidecar(handle, 'transfer.json'),
  ]);
  const conversations = history === null ? undefined : validateConversationDocument(decodePortablePayload(history), metadata?.projectId);
  if (conversations && !metadata) throw new Error('Folder history has no project identity.');
  let transfer;
  if (journal !== null) {
    transfer = JSON.parse(journal);
    if (!transfer || transfer.schema !== 1 || typeof transfer.projectId !== 'string' || !['writing', 'complete'].includes(transfer.state)) throw new Error('Invalid folder transfer journal.');
  }
  return { ...snapshot, settings, ...(metadata ? { metadata } : {}), ...(conversations ? { conversations } : {}), ...(transfer ? { transfer } : {}) };
}

function equalSnapshot(left, right) {
  return projectSnapshotEqual(left, right) && JSON.stringify(left.settings || {}) === JSON.stringify(right.settings || {});
}

export async function contentSnapshotHash(snapshot) {
  const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const files = [];
  for (const path of Object.keys(snapshot.files).sort()) files.push([path, await hash(typeof snapshot.files[path] === 'string' ? new TextEncoder().encode(snapshot.files[path]) : snapshot.files[path])]);
  return hash(new TextEncoder().encode(JSON.stringify({ files, folders: [...snapshot.folders].sort(), settings: snapshot.settings || {} })));
}

/**
 * Copy one logical project into a folder. The caller switches its binding only after
 * this verified result, and keeps the original snapshot as recovery on any failure.
 * expectedSnapshot authorizes replacing exactly the previously reviewed disk state.
 * @param {{record:any, handle:FileSystemDirectoryHandle, conversations?:import('@trafficops/template-editor-core').ConversationDocument, expectedSnapshot?:any}} options
 */
export async function saveProjectToDirectory({ record, handle, conversations, expectedSnapshot }) {
  const project = validateStudioProject(record), metadata = projectMetadata(project);
  if (typeof handle.queryPermission === 'function' && !(await ensureProjectPermission(handle, { request: false }))) throw new Error('Studio needs read and write access to the selected folder.');
  const before = await readPortableDirectory(handle);
  if (before.metadata && before.metadata.projectId !== project.id) throw new ConflictError('The selected folder belongs to a different project.');
  const next = { files: project.files, folders: project.folders, settings: project.settings };
  const hash = await contentSnapshotHash(next);
  const sourceHash = await contentSnapshotHash(expectedSnapshot || before);
  if (expectedSnapshot && !equalSnapshot(before, expectedSnapshot)) {
    const same = (left, right) => projectSnapshotEqual({ files: { value: left }, folders: [] }, { files: { value: right }, folders: [] });
    const ownRetry = before.transfer?.state === 'writing' && before.transfer.projectId === project.id && before.transfer.contentHash === hash && before.transfer.sourceHash === sourceHash;
    const knownBytes = Object.keys(before.files).every(path => Object.hasOwn(next.files, path) && same(before.files[path], next.files[path]) || Object.hasOwn(expectedSnapshot.files, path) && same(before.files[path], expectedSnapshot.files[path]));
    const knownSettings = JSON.stringify(before.settings) === JSON.stringify(expectedSnapshot.settings || {}) || JSON.stringify(before.settings) === JSON.stringify(next.settings);
    if (!ownRetry || !knownBytes || !knownSettings || before.folders.some(path => !next.folders.includes(path) && !expectedSnapshot.folders.includes(path))) throw new ConflictError('The selected folder changed before transfer. Read it again before saving.');
  }
  if (!expectedSnapshot && !equalSnapshot(before, next) && (Object.keys(before.files).length || before.folders.length || Object.keys(before.settings).length)) {
    // A failed copy may be safely retried: every existing byte must match the target.
    const ownRetry = before.transfer?.state === 'writing' && before.transfer.projectId === project.id && before.transfer.contentHash === hash;
    const targetContainsDisk = Object.keys(before.files).every(path => Object.hasOwn(next.files, path) && projectSnapshotEqual({ files: { [path]: before.files[path] }, folders: [] }, { files: { [path]: next.files[path] }, folders: [] })) && before.folders.every(path => next.folders.includes(path));
    if (!ownRetry || !targetContainsDisk) throw new ConflictError('The selected folder is not empty. Review its files before replacing them.');
  }
  const document = conversations ? validateConversationDocument(conversations, project.id) : undefined;
  if (before.conversations && document && before.conversations.revision > document.revision) throw new ConflictError('The folder contains newer dialogue history.');
  await writeProjectSidecar(handle, 'transfer.json', JSON.stringify({ schema: 1, projectId: project.id, contentHash: hash, sourceHash, state: 'writing' }));
  await syncDirectoryProject(handle, before, next);
  await writeProjectSettings(handle, project.settings);
  if (document) await writeProjectSidecar(handle, 'conversations.json', encodePortablePayload(document));
  const writtenMetadata = await writeProjectMetadata(handle, { ...metadata, contentHash: hash, ...(document ? { metadataRevision: document.revision } : {}) });
  const verified = await readPortableDirectory(handle);
  if (!equalSnapshot(verified, next) || verified.metadata?.projectId !== project.id || document && encodePortablePayload(verified.conversations) !== encodePortablePayload(document)) throw new Error('The project folder write could not be verified. Your original project is retained.');
  await writeProjectSidecar(handle, 'transfer.json', JSON.stringify({ schema: 1, projectId: project.id, contentHash: hash, state: 'complete' }));
  return { metadata: writtenMetadata, ...(document ? { conversations: document } : {}), snapshot: next };
}

/** Imported copies get independent IDs; resume retains identity and interrupts remote owners. */
export function portableProjectRecord(imported, { copy = false, id = copy ? crypto.randomUUID() : imported.metadata?.projectId || crypto.randomUUID(), kind, name } = {}) {
  const metadata = imported.metadata;
  const record = validateStudioProject({ id, kind: kind || metadata?.kind || 'template', name: name || metadata?.name || 'Imported project', revision: 0,
    files: imported.files, folders: imported.folders, settings: imported.settings,
    ...(metadata?.sourceTemplateId ? { sourceTemplateId: metadata.sourceTemplateId } : {}),
    ...(!copy && metadata ? { contentRevision: metadata.contentRevision, metadataRevision: metadata.metadataRevision, createdAt: metadata.createdAt, appliedAiRuns: metadata.appliedAiRuns } : {}) });
  const conversations = imported.conversations ? copy ? cloneConversationDocument(imported.conversations, id) : interruptImportedRuns(imported.conversations) : undefined;
  return { record, ...(conversations ? { conversations } : {}) };
}
