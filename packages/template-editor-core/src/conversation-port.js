import { ConflictError } from './errors.js';
import { CONVERSATION_LIMITS, validateConversationDocument } from './project.js';
import { blobReferences, createSplitCache, documentOf, joinThread, seedSplitCache, sha256Hex, splitThread, threadHash, threadsOf, validateThreadFile } from './conversation-format.js';

const BASES = 16, GC_INTERVAL_MS = 5 * 60 * 1000;
const fileId = file => typeof file?.id === 'string' ? file.id : null;
const signatureOf = entries => entries.map(([id, revision]) => JSON.stringify([id, revision ?? null])).sort().join('\n');

/**
 * host.conversations over any ConversationStore. The runtime keeps one document; the store keeps one file per dialogue.
 * Every published document remembers the snapshot it was built from (its base). A save diffs the runtime's copy against
 * that base, writes only the dialogues the runtime changed (each with its own store CAS on thread.revision), and rebases
 * the result onto the current state, so writes by another window never invalidate a copy locally.
 */
export function createStoreConversationPort(store, { projectId, hashBlob = sha256Hex, onError = () => {}, now = Date.now } = {}) {
  validateConversationDocument({ schema: 1, projectId, revision: 0, threads: [], runs: [] }, projectId);
  // current: valid persisted dialogues in publication order (id → { revision, hash, refs, joined, split }).
  // listing: every listed file as [id | null, revision], damaged ones included; signature: its digest, null when unknown.
  let counter = 0, current = new Map(), listing = [], signature = null, failed = false, warning, publishedKey = null;
  let cache = createSplitCache(), queue = Promise.resolve(), refreshQueued = false, loaded = false, lastCollect = -Infinity, unwatch = null;
  const listeners = new Set(), bases = new Map();
  const report = error => { try { onError(error); } catch { /* Reporting cannot fail an operation. */ } };
  const serial = operation => { const task = queue.catch(() => {}).then(operation); queue = task; return task; };
  const keyOf = () => JSON.stringify([[...current].map(([id, entry]) => [id, entry.revision]).sort(), warning ?? null]);
  const notify = document => {
    if (!listeners.size) return;
    const copy = structuredClone(document);
    for (const listener of [...listeners]) { try { listener(copy); } catch (error) { report(error); } }
  };

  function publish() {
    const document = { ...documentOf(projectId, [...current.values()].map(entry => entry.joined), ++counter), ...(warning ? { storageWarning: warning } : {}) };
    bases.set(counter, new Map([...current].map(([id, { revision, hash }]) => [id, { revision, hash }])));
    for (const old of bases.keys()) { if (bases.size <= BASES) break; bases.delete(old); }
    publishedKey = keyOf();
    return document;
  }

  // GC starts once the queued operations ahead of it finish, but nothing waits for it: a slow or hung collection
  // never delays a save. Stores apply a grace period, so a concurrent write is safe.
  function scheduleCollect() {
    if (!store.collectGarbage || now() - lastCollect < GC_INTERVAL_MS) return;
    lastCollect = now();
    queue.catch(() => {}).then(() => store.collectGarbage()).catch(report);
  }

  /** Re-reads the listed files into `current`, reusing every dialogue whose revision is unchanged. */
  async function read(files) {
    const blobs = new Map(), next = new Map(), seeded = createSplitCache(), skipped = [], stale = [];
    const getBlob = sha => { if (!blobs.has(sha)) blobs.set(sha, store.getBlob(sha)); return blobs.get(sha); };
    for (const file of files) {
      const id = fileId(file), known = id === null ? undefined : current.get(id);
      if (id !== null && next.has(id)) { skipped.push(`${id}: duplicate dialogue ID`); continue; }
      if (known && file.revision === known.revision) { next.set(id, known); seedSplitCache(seeded, file); continue; }
      try {
        validateThreadFile(file);
        const joined = await joinThread(file, getBlob);
        next.set(id, { revision: file.revision, hash: await threadHash(file), refs: blobReferences(file), joined, split: file });
        seedSplitCache(seeded, file);
      } catch (error) {
        // A newer version that cannot be opened (possibly a transient read error) keeps the older one visible.
        if (known) { next.set(id, known); seedSplitCache(seeded, known.split); stale.push(id); }
        else skipped.push(`${id ?? 'unknown'}: ${error.message}`);
      }
    }
    // Keep the known order; dialogues new to this window follow in listing order. A damaged file stays out of
    // `current`, so no save ever deletes it.
    const ordered = new Map();
    for (const id of current.keys()) if (next.has(id)) ordered.set(id, next.get(id));
    for (const [id, entry] of next) if (!ordered.has(id)) ordered.set(id, entry);
    // Any failure is retried on the next watch event, even when the listing is unchanged: unchanged files are reused,
    // so only the failed ones are read again.
    current = ordered; cache = seeded; failed = skipped.length > 0 || stale.length > 0;
    listing = files.map(file => [fileId(file), file?.revision]); signature = signatureOf(listing);
    const notes = [
      ...(stale.length ? [`${stale.length === 1 ? 'Dialogue' : 'Dialogues'} ${stale.join(', ').slice(0, 1000)} could not be refreshed; an older version is shown.`] : []),
      ...(skipped.length ? [`Some dialogues could not be opened and were left untouched (${skipped.join('; ').slice(0, 1000)}).`] : []),
    ];
    warning = notes.length ? notes.join(' ') : undefined;
  }

  function load() {
    return serial(async () => {
      await read(await store.listThreads());
      const document = publish();
      if (!loaded) { loaded = true; scheduleCollect(); }
      return structuredClone(document);
    });
  }

  function refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    serial(async () => {
      refreshQueued = false;
      const files = await store.listThreads();
      if (!failed && signatureOf(files.map(file => [fileId(file), file?.revision])) === signature) return;
      await read(files);
      if (keyOf() !== publishedKey) notify(publish());
    }).catch(report);
  }

  function save(document, { expectedRevision = document.revision } = {}) {
    return serial(async () => {
      const base = bases.get(expectedRevision);
      if (!base) throw new ConflictError('Conversation history changed too often since this copy was taken. Reload the dialogue before saving.');
      const threads = threadsOf(validateConversationDocument(document, projectId));
      if (threads.length > CONVERSATION_LIMITS.threads) throw new Error(`Project history supports at most ${CONVERSATION_LIMITS.threads} dialogues.`);
      const nextCache = createSplitCache(), changes = [], incoming = new Set(threads.map(thread => thread.id));
      const persisted = new Set([...current.values()].flatMap(entry => [...entry.refs]));
      // Split and validate every changed thread before any I/O, so an over-limit save writes nothing.
      for (const thread of threads) {
        const parts = await splitThread(thread, { cache, nextCache, hash: hashBlob });
        const hash = await threadHash(parts.thread), was = base.get(thread.id), expected = thread.revision ?? 0;
        if (was && was.hash === hash && was.revision === expected) continue;
        validateThreadFile(parts.thread);
        changes.push({ thread, parts, hash, expected });
      }
      // Only dialogues in the copy's base can be deleted by absence; one created elsewhere since is never touched.
      const removed = [...base].filter(([id]) => !incoming.has(id));
      const committed = new Map(), deleted = [];
      let dropped = false;
      try {
        for (const { thread, parts, hash, expected } of changes) {
          const write = async ({ thread: split, blobs }, everything) => {
            for (const [sha, bytes] of blobs) if (everything || !persisted.has(sha)) await store.putBlob(sha, bytes);
            return store.writeThread(split, { expectedRevision: expected });
          };
          // A blob believed persisted may have been collected after another window dropped it: re-split with every byte, retry once.
          let split = parts.thread;
          const { revision } = await write(parts, false).catch(async error => {
            if (error?.code !== 'validation') throw error;
            const full = await splitThread(thread, { nextCache, hash: hashBlob });
            split = full.thread;
            return write(full, true);
          });
          const refs = blobReferences(split), old = current.get(thread.id);
          if (old && [...old.refs].some(sha => !refs.has(sha))) dropped = true;
          thread.revision = revision;
          committed.set(thread.id, { revision, hash, refs, joined: thread, split });
        }
        for (const [id, was] of removed) { await store.deleteThread(id, { expectedRevision: was.revision }); deleted.push(id); }
      } catch (error) {
        // Record what did commit, so the next read reuses it, and force that read: the store's real state is published then.
        for (const [id, entry] of committed) current.set(id, entry);
        for (const id of deleted) current.delete(id);
        signature = null;
        throw error;
      }
      // The runtime's changes rebased onto the current state: its untouched dialogues show their current version
      // (or disappear when deleted elsewhere), and dialogues created elsewhere follow.
      const rebased = new Map();
      for (const thread of threads) {
        const entry = committed.get(thread.id) || (base.has(thread.id) ? current.get(thread.id) : undefined);
        if (entry) rebased.set(thread.id, entry);
      }
      for (const [id, entry] of current) if (!incoming.has(id) && !base.has(id)) rebased.set(id, entry);
      // Dialogues this save did not split keep their cache entries, so the next save hashes nothing for them.
      for (const [id, entry] of rebased) if (!committed.has(id)) {
        const seeded = seedSplitCache(createSplitCache(), entry.split);
        for (const kind of ['runs', 'attachments']) for (const [key, value] of seeded[kind]) if (!nextCache[kind].has(key)) nextCache[kind].set(key, value);
      }
      current = rebased; cache = nextCache;
      if (signature !== null) {
        listing = [...listing.filter(([id]) => id === null || (!committed.has(id) && !deleted.includes(id))), ...[...committed].map(([id, { revision }]) => [id, revision])];
        signature = signatureOf(listing);
      }
      const saved = publish();
      notify(saved);
      if (deleted.length || dropped) scheduleCollect();
      return structuredClone(saved);
    });
  }

  return {
    projectId, load, save,
    subscribe(listener) {
      listeners.add(listener);
      if (!unwatch && store.watch) unwatch = store.watch(() => { refresh(); });
      return () => { listeners.delete(listener); if (!listeners.size && unwatch) { unwatch(); unwatch = null; } };
    },
  };
}
