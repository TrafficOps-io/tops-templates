import { ConflictError } from './errors.js';
import { CONVERSATION_LIMITS, validateConversationDocument } from './project.js';
import { blobReferences, createSplitCache, documentOf, joinThread, seedSplitCache, sha256Hex, splitThread, threadHash, threadsOf, validateThreadFile } from './conversation-format.js';

/**
 * host.conversations over any ConversationStore. The runtime keeps one document; the store keeps one file per dialogue.
 * Two-level CAS: a local counter (document.revision) rejects stale same-window copies before I/O, and each thread
 * carries its store revision (thread.revision) so a stale thread fails the store's compare-and-swap.
 */
export function createStoreConversationPort(store, { projectId, hashBlob = sha256Hex } = {}) {
  validateConversationDocument({ schema: 1, projectId, revision: 0, threads: [], runs: [] }, projectId);
  // snapshot: valid persisted threads (id → { revision, hash, refs }); listed: every listed file's revision, damaged ones included.
  let counter = 0, snapshot = new Map(), listed = new Map(), cache = createSplitCache(), warning, queue = Promise.resolve(), collected = false, unwatch = null;
  const listeners = new Set();
  const serial = operation => { const task = queue.catch(() => {}).then(operation); queue = task; return task; };
  const notify = document => { for (const listener of [...listeners]) { try { listener(structuredClone(document)); } catch { /* A detached view. */ } } };
  const publishDocument = threads => ({ ...documentOf(projectId, threads, ++counter), ...(warning ? { storageWarning: warning } : {}) });
  const collect = () => store.collectGarbage ? store.collectGarbage().catch(() => {}) : undefined;

  async function read(files) {
    const blobs = new Map(), threads = [], next = new Map(), seeded = createSplitCache(), skipped = [];
    const getBlob = sha => { if (!blobs.has(sha)) blobs.set(sha, store.getBlob(sha)); return blobs.get(sha); };
    for (const file of files) {
      try {
        validateThreadFile(file);
        threads.push(await joinThread(file, getBlob));
        next.set(file.id, { revision: file.revision, hash: await threadHash(file), refs: blobReferences(file) });
        seedSplitCache(seeded, file);
      } catch (error) { skipped.push(`${typeof file?.id === 'string' ? file.id : 'unknown'}: ${error.message}`); }
    }
    // A damaged file stays out of the snapshot, so no save ever deletes it.
    listed = new Map(files.map(file => [file?.id, file?.revision])); snapshot = next; cache = seeded;
    warning = skipped.length ? `Some dialogues could not be opened and were left untouched (${skipped.join('; ').slice(0, 1000)}).` : undefined;
    return publishDocument(threads);
  }

  function load() {
    return serial(async () => {
      const document = await read(await store.listThreads());
      if (!collected) { collected = true; await collect(); }
      return structuredClone(document);
    });
  }

  function refresh() {
    return serial(async () => {
      const files = await store.listThreads();
      if (files.length === listed.size && files.every(file => listed.get(file?.id) === file?.revision)) return;
      notify(await read(files));
    }).catch(() => {});
  }

  function save(document, { expectedRevision = document.revision } = {}) {
    return serial(async () => {
      if (expectedRevision !== counter) throw new ConflictError('Conversation history changed in another window. Reload the dialogue before saving.');
      const threads = threadsOf(validateConversationDocument(document, projectId));
      if (threads.length > CONVERSATION_LIMITS.threads) throw new Error(`Project history supports at most ${CONVERSATION_LIMITS.threads} dialogues.`);
      const nextCache = createSplitCache(), next = new Map(), changes = [], persisted = new Set([...snapshot.values()].flatMap(entry => [...entry.refs]));
      // Split and validate every changed thread before any I/O, so an over-limit save writes nothing.
      for (const thread of threads) {
        const parts = await splitThread(thread, { cache, nextCache, hash: hashBlob });
        const hash = await threadHash(parts.thread), known = snapshot.get(thread.id), expected = thread.revision ?? 0;
        if (known && known.hash === hash && known.revision === expected) { next.set(thread.id, known); continue; }
        validateThreadFile(parts.thread);
        changes.push({ thread, parts, hash, known, expected });
      }
      const removed = [...snapshot].filter(([id]) => !threads.some(thread => thread.id === id));
      let dropped = removed.length > 0;
      try {
        for (const { thread, parts, hash, known, expected } of changes) {
          const write = async ({ thread: split, blobs }, everything) => {
            for (const [sha, bytes] of blobs) if (everything || !persisted.has(sha)) await store.putBlob(sha, bytes);
            return store.writeThread(split, { expectedRevision: expected });
          };
          // A blob believed persisted may have been collected after another window dropped it: re-split with every byte, retry once.
          const { revision } = await write(parts, false).catch(async error => { if (error?.code !== 'validation') throw error; return write(await splitThread(thread, { hash: hashBlob }), true); });
          const refs = blobReferences(parts.thread);
          if (known && [...known.refs].some(sha => !refs.has(sha))) dropped = true;
          next.set(thread.id, { revision, hash, refs }); listed.set(thread.id, revision); thread.revision = revision;
        }
        for (const [id, known] of removed) { await store.deleteThread(id, { expectedRevision: known.revision }); listed.delete(id); }
      } catch (error) { counter++; throw error; }
      cache = nextCache; snapshot = next;
      const saved = publishDocument(threads);
      notify(saved);
      if (dropped) await collect();
      return structuredClone(saved);
    });
  }

  return {
    projectId, load, save,
    subscribe(listener) {
      listeners.add(listener);
      if (!unwatch && store.watch) unwatch = store.watch(() => { void refresh(); });
      return () => { listeners.delete(listener); if (!listeners.size && unwatch) { unwatch(); unwatch = null; } };
    },
  };
}
