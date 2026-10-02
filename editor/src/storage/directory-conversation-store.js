import { BLOB_TAG, CONVERSATION_LIMITS, ConflictError, ValidationError, blobReferences, conversationThreadFileName as nameOf, sha256Hex, validateThreadFile } from '@trafficops/template-editor-core';
import { withLock } from './locks.js';
import { fileAt, listDirectory, readFile, readJson, removePath, writeFile } from './write.js';

const DIR = '.trafficops/conversations', BLOBS = `${DIR}/blobs`, TOMBSTONES = '.trafficops/conversation-tombstones.json', META = '.trafficops/project.json';
const SHA256 = /^[a-f0-9]{64}$/, MISSING = 'A conversation attachment is missing.';
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// File names come from core's conversationThreadFileName (shared with editable ZIPs): lowercase-safe ids stay
// readable, anything else is hashed, so names never collide on case-insensitive file systems.
const json = value => JSON.stringify(value, null, 2) + '\n';
const damagedEntry = id => ({ schema: 1, id, revision: -1, damaged: true, messages: [], runs: [] });

async function statOf(root, path) {
  const handle = await fileAt(root, path);
  try { return handle ? await handle.getFile() : null; } catch (error) { if (error?.name === 'NotFoundError') return null; throw error; }
}

// A thread file: null when absent or empty (an interrupted first write), { damaged: true } when it cannot be parsed or
// validated or is stored under another id's name, else { file }. Other read errors propagate.
async function readThreadFile(root, name) {
  const bytes = await readFile(root, `${DIR}/${name}`);
  if (!bytes?.byteLength) return null;
  try {
    const file = validateThreadFile(JSON.parse(decode(bytes)));
    if (nameOf(file.id) !== name) throw new Error('The dialogue file name does not match its ID.');
    return { file };
  } catch { return { damaged: true }; }
}

// sha → the sizes the thread's references claim.
function blobSizes(value, found = new Map()) {
  if (Array.isArray(value)) for (const item of value) blobSizes(item, found);
  else if (plain(value)) {
    if (Object.hasOwn(value, BLOB_TAG)) { if (!found.has(value[BLOB_TAG])) found.set(value[BLOB_TAG], new Set()); found.get(value[BLOB_TAG]).add(value.size); }
    else for (const child of Object.values(value)) blobSizes(child, found);
  }
  return found;
}

/** ConversationStore over `.trafficops/conversations/` in a project folder, plus close(). One file per dialogue, blobs
 *  by sha. Writes, deletes and GC run under one lock per project; tombstones keep revisions monotonic across delete
 *  and recreate. Damaged files are listed as damaged, never overwritten or deleted, and block GC. */
export function createDirectoryConversationStore(root, { projectId, graceMs = 10 * 60 * 1000, refreshMs = 5 * 60 * 1000, now = Date.now, channelName, locks, onError } = {}) {
  const lockName = `trafficops-conversations:${projectId}`, listeners = new Set();
  const report = error => { try { onError?.(error); } catch { /* Reporting cannot fail an operation. */ } };
  // Tolerant: a corrupt tombstones file is reported and read as empty, so it never blocks writes.
  const readTombstones = async () => {
    const bytes = await readFile(root, TOMBSTONES);
    if (!bytes?.byteLength) return new Map();
    try {
      const value = JSON.parse(decode(bytes));
      if (!plain(value)) throw new Error('not a revision map');
      return new Map(Object.entries(value).filter(([, revision]) => Number.isSafeInteger(revision) && revision > 0));
    } catch (error) { report(new ValidationError(`${TOMBSTONES} is not valid: ${error.message}`, { cause: error })); return new Map(); }
  };
  const writeTombstones = tombstones => writeFile(root, TOMBSTONES, json(Object.fromEntries(tombstones)));
  const locked = fn => withLock(lockName, fn, { locks });
  let channel = null, closed = false;
  const channelOf = () => {
    if (closed) return null;
    if (!channel && typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(channelName ?? lockName);
      channel.unref?.();
      channel.onmessage = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* A watcher cannot break the channel. */ } } };
    }
    return channel;
  };
  const post = message => { try { channelOf()?.postMessage(message); } catch { /* The change is committed; peers refresh on their next read. */ } };
  const threadNames = async () => (await listDirectory(root, DIR)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.json')).map(entry => entry.name);
  const current = async id => (await readThreadFile(root, nameOf(id))) ?? { file: null };

  return {
    async listThreads() {
      const threads = [];
      for (const name of await threadNames()) {
        const entry = await readThreadFile(root, name);
        if (entry) threads.push(entry.damaged ? damagedEntry(name.slice(0, -'.json'.length)) : entry.file);
      }
      return threads;
    },
    async writeThread(thread, { expectedRevision } = {}) {
      const file = validateThreadFile(structuredClone(thread));
      return locked(async () => {
        const existing = await current(file.id);
        if (existing.damaged) throw new ConflictError('The dialogue file is damaged and cannot be overwritten. Repair or remove it first.');
        if ((existing.file?.revision ?? 0) !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before saving.');
        // A truncated blob counts as missing, so the adapter re-uploads it.
        for (const [sha, sizes] of blobSizes(file)) {
          const blob = await statOf(root, `${BLOBS}/${sha}`);
          if (!blob || [...sizes].some(size => size !== blob.size)) throw new ValidationError('The dialogue references a missing attachment.');
        }
        const tombstones = await readTombstones();
        const revision = Math.max(existing.file?.revision ?? 0, tombstones.get(file.id) ?? 0) + 1;
        await writeFile(root, `${DIR}/${nameOf(file.id)}`, json({ ...file, revision }));
        // The write is committed; a stale tombstone only ever raises a later revision.
        if (tombstones.delete(file.id)) { try { await writeTombstones(tombstones); } catch (error) { report(error); } }
        post({ threadId: file.id, revision });
        return { revision };
      });
    },
    async deleteThread(id, { expectedRevision } = {}) {
      return locked(async () => {
        const existing = await current(id);
        if (existing.damaged) throw new ConflictError('The dialogue file is damaged and cannot be deleted here.');
        if (!existing.file) return;
        const { revision } = existing.file;
        if (revision !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before deleting it.');
        // The tombstone is written first, so a failed removal can never let the revision restart.
        const tombstones = await readTombstones();
        tombstones.set(id, Math.max(revision, tombstones.get(id) ?? 0));
        await writeTombstones(tombstones);
        await removePath(root, `${DIR}/${nameOf(id)}`);
        post({ threadId: id, revision });
      });
    },
    async putBlob(sha, bytes) {
      if (bytes.byteLength > CONVERSATION_LIMITS.blob) throw new Error('A conversation attachment exceeds 24 MiB.');
      if (await sha256Hex(bytes) !== sha) throw new ValidationError('The conversation attachment does not match its hash.');
      const path = `${BLOBS}/${sha}`, existing = await statOf(root, path);
      if (!existing) {
        try { await writeFile(root, path, bytes); } catch (error) {
          // Best effort: drop an empty or partial file, unless another window has completed the same blob meanwhile.
          try { if ((await statOf(root, path))?.size !== bytes.byteLength) await removePath(root, path); } catch { /* The write error is what matters. */ }
          throw error;
        }
        return;
      }
      // A truncated blob is repaired; rewriting an old one under the lock moves it out of the GC grace window before a
      // thread references it again.
      if (existing.size !== bytes.byteLength || now() - existing.lastModified > refreshMs) await locked(() => writeFile(root, path, bytes));
    },
    async getBlob(sha) {
      const bytes = typeof sha === 'string' && SHA256.test(sha) ? await readFile(root, `${BLOBS}/${sha}`) : null;
      if (!bytes) throw new Error(MISSING);
      return bytes;
    },
    watch(listener) {
      listeners.add(listener); channelOf();
      return () => { listeners.delete(listener); };
    },
    async collectGarbage({ signal } = {}) {
      return locked(async () => {
        const referenced = new Set();
        for (const name of await threadNames()) {
          const entry = await readThreadFile(root, name);
          if (entry?.damaged) return;
          if (entry) blobReferences(entry.file, referenced);
        }
        // Attachments of a pending AI brief (project.json) are referenced until the brief is claimed.
        try { const meta = await readJson(root, META); if (meta?.pendingAi) blobReferences(meta.pendingAi, referenced); } catch { return; }
        for (const { name, kind } of await listDirectory(root, BLOBS)) {
          if (signal?.aborted) return;
          if (kind !== 'file' || !SHA256.test(name) || referenced.has(name)) continue;
          const blob = await statOf(root, `${BLOBS}/${name}`);
          if (blob && now() - blob.lastModified > graceMs) await removePath(root, `${BLOBS}/${name}`);
        }
      });
    },
    close() { closed = true; listeners.clear(); channel?.close(); channel = null; },
  };
}
