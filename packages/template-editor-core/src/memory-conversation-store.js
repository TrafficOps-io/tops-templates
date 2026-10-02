import { ConflictError, ValidationError } from './errors.js';
import { CONVERSATION_LIMITS } from './project.js';
import { blobReferences, sha256Hex, validateThreadFile } from './conversation-format.js';

/** Reference ConversationStore. Blob refresh and GC follow the directory store's grace rules. */
export function createMemoryConversationStore({ now = Date.now, graceMs = 10 * 60 * 1000 } = {}) {
  const threads = new Map(), blobs = new Map(), watchers = new Set();
  const emit = () => { for (const watcher of [...watchers]) { try { watcher(); } catch { /* A watcher cannot break a commit. */ } } };
  return {
    async listThreads() { return [...threads.values()].map(value => structuredClone(value)); },
    async writeThread(thread, { expectedRevision }) {
      const file = validateThreadFile(structuredClone(thread)), current = threads.get(file.id)?.revision ?? 0;
      if (current !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before saving.');
      for (const sha of blobReferences(file)) if (!blobs.has(sha)) throw new ValidationError('The dialogue references a missing attachment.');
      const revision = current + 1;
      threads.set(file.id, { ...file, revision }); emit();
      return { revision };
    },
    async deleteThread(id, { expectedRevision }) {
      const current = threads.get(id);
      if (!current) return;
      if (current.revision !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before deleting it.');
      threads.delete(id); emit();
    },
    async putBlob(sha, bytes) {
      if (bytes.byteLength > CONVERSATION_LIMITS.blob) throw new Error('A conversation attachment exceeds 24 MiB.');
      if (await sha256Hex(bytes) !== sha) throw new ValidationError('The conversation attachment does not match its hash.');
      const existing = blobs.get(sha);
      if (existing) { if (now() - existing.at > graceMs / 2) existing.at = now(); return; }
      blobs.set(sha, { bytes: new Uint8Array(bytes), at: now() });
    },
    async getBlob(sha) {
      const blob = blobs.get(sha);
      if (!blob) throw new Error('A conversation attachment is missing.');
      return new Uint8Array(blob.bytes);
    },
    watch(listener) { watchers.add(listener); return () => watchers.delete(listener); },
    async collectGarbage() {
      const referenced = new Set();
      for (const thread of threads.values()) blobReferences(thread, referenced);
      for (const [sha, blob] of blobs) if (!referenced.has(sha) && now() - blob.at > graceMs) blobs.delete(sha);
    },
  };
}
