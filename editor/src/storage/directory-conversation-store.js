import { CONVERSATION_LIMITS, ConflictError, ValidationError, blobReferences, sha256Hex, validateThreadFile } from '@trafficops/template-editor-core';
import { withLock } from './locks.js';
import { fileAt, lastModified, listDirectory, readFile, readJson, removePath, writeFile } from './write.js';

const DIR = '.trafficops/conversations', BLOBS = `${DIR}/blobs`, TOMBSTONES = '.trafficops/conversation-tombstones.json', META = '.trafficops/project.json';
const SHA256 = /^[a-f0-9]{64}$/, MISSING = 'A conversation attachment is missing.';
const threadPath = id => `${DIR}/${encodeURIComponent(id)}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const damagedEntry = id => ({ schema: 1, id, revision: -1, damaged: true, messages: [], runs: [] });
const idOf = name => { try { return decodeURIComponent(name.slice(0, -'.json'.length)); } catch { return name.slice(0, -'.json'.length); } };

// A thread file: { file } when valid, { damaged: true } when unreadable, invalid or stored under another id's name.
async function readThreadFile(root, name) {
  try {
    const file = await readJson(root, `${DIR}/${name}`);
    if (file === null) return null;
    validateThreadFile(file);
    if (threadPath(file.id) !== `${DIR}/${name}`) throw new Error('The dialogue file name does not match its ID.');
    return { file };
  } catch { return { damaged: true }; }
}

async function readTombstones(root) {
  try {
    const value = await readJson(root, TOMBSTONES);
    return new Map(value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([, revision]) => Number.isSafeInteger(revision) && revision > 0) : []);
  } catch { return new Map(); }
}
const writeTombstones = (root, tombstones) => writeFile(root, TOMBSTONES, json(Object.fromEntries(tombstones)));

/** ConversationStore over `.trafficops/conversations/` in a project folder, plus close(). One file per dialogue, blobs
 *  by sha. Writes, deletes and GC run under one lock per project; tombstones keep revisions monotonic across delete
 *  and recreate. Damaged files are listed as damaged, never overwritten or deleted, and block GC. */
export function createDirectoryConversationStore(root, { projectId, graceMs = 10 * 60 * 1000, refreshMs = 5 * 60 * 1000, now = Date.now, channelName, locks } = {}) {
  const lockName = `trafficops-conversations:${projectId}`, listeners = new Set();
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
  const current = async id => (await readThreadFile(root, `${encodeURIComponent(id)}.json`)) ?? { file: null };

  return {
    async listThreads() {
      const threads = [];
      for (const name of await threadNames()) {
        const entry = await readThreadFile(root, name);
        if (entry) threads.push(entry.damaged ? damagedEntry(idOf(name)) : entry.file);
      }
      return threads;
    },
    async writeThread(thread, { expectedRevision } = {}) {
      const file = validateThreadFile(structuredClone(thread));
      return locked(async () => {
        const existing = await current(file.id);
        if (existing.damaged) throw new ConflictError('The dialogue file is damaged and cannot be overwritten. Repair or remove it first.');
        if ((existing.file?.revision ?? 0) !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before saving.');
        for (const sha of blobReferences(file)) if (!await fileAt(root, `${BLOBS}/${sha}`)) throw new ValidationError('The dialogue references a missing attachment.');
        const tombstones = await readTombstones(root);
        const revision = Math.max(existing.file?.revision ?? 0, tombstones.get(file.id) ?? 0) + 1;
        await writeFile(root, threadPath(file.id), json({ ...file, revision }));
        if (tombstones.delete(file.id)) await writeTombstones(root, tombstones);
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
        const tombstones = await readTombstones(root);
        tombstones.set(id, Math.max(revision, tombstones.get(id) ?? 0));
        await writeTombstones(root, tombstones);
        await removePath(root, threadPath(id));
        post({ threadId: id, revision });
      });
    },
    async putBlob(sha, bytes) {
      if (bytes.byteLength > CONVERSATION_LIMITS.blob) throw new Error('A conversation attachment exceeds 24 MiB.');
      if (await sha256Hex(bytes) !== sha) throw new ValidationError('The conversation attachment does not match its hash.');
      const path = `${BLOBS}/${sha}`, modified = await lastModified(root, path);
      if (modified === null) return writeFile(root, path, bytes);
      // Rewriting under the lock moves an old blob out of the GC grace window before a thread references it again.
      if (now() - modified > refreshMs) await locked(() => writeFile(root, path, bytes));
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
          const modified = await lastModified(root, `${BLOBS}/${name}`);
          if (modified !== null && now() - modified > graceMs) await removePath(root, `${BLOBS}/${name}`);
        }
      });
    },
    close() { closed = true; listeners.clear(); channel?.close(); channel = null; },
  };
}
