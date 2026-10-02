import { EditorError, ValidationError } from './errors.js';
import { blobReferences, documentOf, joinThread, sha256Hex, splitThread, threadsOf, validateThreadFile } from './conversation-format.js';
import { validateConversationDocument } from './project.js';

/** Editable-ZIP history: a joined document ↔ `{ threads, blobs }`, the folder layout's split dialogue files plus
 *  their blobs by sha (identical content across dialogues is stored once). */
export async function conversationFilesFromDocument(document) {
  const threads = [], blobs = new Map();
  for (const thread of threadsOf(document)) {
    const split = await splitThread(thread);
    threads.push(validateThreadFile(split.thread));
    for (const [sha, bytes] of split.blobs) blobs.set(sha, bytes);
  }
  return { threads, blobs };
}

/** Verifies every referenced blob against its hash and joins the dialogues. Revisions belong to the store the files
 *  came from, so the result carries none: its threads are new to whatever store they are written to next. */
export async function conversationDocumentFromFiles({ threads = [], blobs = new Map() } = {}, projectId) {
  const byHash = blobs instanceof Map ? blobs : new Map(Object.entries(blobs)), verified = new Map(), ids = new Set();
  const getBlob = async sha => {
    if (!verified.has(sha)) verified.set(sha, (async () => {
      const bytes = byHash.get(sha);
      if (!(bytes instanceof Uint8Array)) throw new ValidationError('A conversation attachment is missing from the project history.');
      if (await sha256Hex(bytes) !== sha) throw new ValidationError('A conversation attachment does not match its hash.');
      return bytes;
    })());
    return verified.get(sha);
  };
  try {
    const joined = [];
    for (const file of threads) {
      const thread = validateThreadFile(file);
      if (ids.has(thread.id)) throw new ValidationError('Duplicate dialogue ID in project history.');
      ids.add(thread.id);
      for (const sha of blobReferences(thread)) await getBlob(sha);
      const { revision: _revision, ...rest } = await joinThread(thread, getBlob);
      joined.push(rest);
    }
    return validateConversationDocument(documentOf(projectId, joined, 0), projectId);
  } catch (error) { throw error instanceof EditorError ? error : new ValidationError(error.message, { cause: error }); }
}
