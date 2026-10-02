import { BLOB_TAG, canonicalJson, sha256Hex } from './conversation-format.js';

/** Runner-agnostic cases every ConversationStore must pass. createStore({ graceMs }) returns a fresh, empty store.
 *  Cases are run as run(createStore, { openPeer }). openPeer(store) must return another instance over the same backing
 *  (a different window). Stores that signal via BroadcastChannel must pass a real peer, because a channel never hears
 *  its own posts; the default (identity) only suits stores that notify their own instance (e.g. the memory store). */
function check(condition, message) { if (!condition) throw new Error(`Store contract: ${message}`); }
async function rejects(promise, predicate, message) {
  try { await promise; } catch (error) { check(predicate(error), `${message} (got ${error?.code || ''} ${error?.message})`); return; }
  check(false, `${message} (resolved)`);
}
const thread = (id = 't1', extra = {}) => ({ schema: 1, id, revision: 0, title: 'Dialogue', messages: [], runs: [], ...extra });
const bytes = text => new TextEncoder().encode(text);
const conflict = error => error?.code === 'conflict';

const rejected = error => error instanceof Error && !(error instanceof TypeError) && Boolean(error.message);
const notConflict = error => rejected(error) && !conflict(error);
async function waitFor(condition, ms = 2000) { const end = Date.now() + ms; while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10)); return condition(); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fileRef = (sha, size) => ({ [BLOB_TAG]: sha, encoding: 'bytes', size });

export const conversationStoreContract = [
  { name: 'writes, lists and versions a thread', async run(createStore) {
    const store = await createStore();
    check((await store.listThreads()).length === 0, 'a new store is empty');
    check((await store.writeThread(thread(), { expectedRevision: 0 })).revision === 1, 'create assigns revision 1');
    check((await store.writeThread({ ...thread(), title: 'Renamed', revision: 99 }, { expectedRevision: 1 })).revision === 2, 'the body revision is ignored');
    const [listed] = await store.listThreads();
    check(listed.id === 't1' && listed.revision === 2 && listed.title === 'Renamed', 'listThreads returns the latest thread with its revision');
  } },
  { name: 'round-trips a thread with messages, runs and blob references', async run(createStore) {
    const store = await createStore(), data = bytes('payload'), sha = await sha256Hex(data);
    await store.putBlob(sha, data);
    const written = thread('t1', { messages: [{ id: 'm', role: 'user', prompt: 'hi', file: fileRef(sha, data.byteLength) }], runs: [{ id: 'r', threadId: 't1', state: 'ready' }] });
    await store.writeThread(written, { expectedRevision: 0 });
    const [listed] = await store.listThreads();
    check(canonicalJson({ ...listed, revision: 0 }) === canonicalJson({ ...written, revision: 0 }), 'the listed thread equals the written one');
  } },
  { name: 'rejects stale writes and duplicate creates as conflicts', async run(createStore) {
    const store = await createStore();
    await store.writeThread(thread(), { expectedRevision: 0 });
    await rejects(store.writeThread(thread(), { expectedRevision: 0 }), conflict, 'a second create conflicts');
    await rejects(store.writeThread({ ...thread(), title: 'Stale' }, { expectedRevision: 5 }), conflict, 'a stale update conflicts');
    const [listed] = await store.listThreads();
    check(listed.revision === 1 && listed.title === 'Dialogue', 'failed writes leave the thread unchanged');
    check((await store.writeThread({ ...thread(), title: 'Next' }, { expectedRevision: 1 })).revision === 2, 'a write with the current revision still succeeds');
  } },
  { name: 'deletes idempotently and with CAS', async run(createStore) {
    const store = await createStore();
    await store.deleteThread('missing', { expectedRevision: 0 });
    await store.writeThread(thread(), { expectedRevision: 0 });
    await rejects(store.deleteThread('t1', { expectedRevision: 7 }), conflict, 'a stale delete conflicts');
    check((await store.listThreads()).length === 1, 'a stale delete keeps the thread');
    await store.deleteThread('t1', { expectedRevision: 1 });
    check((await store.listThreads()).length === 0, 'the thread is deleted');
  } },
  { name: 'stores blobs idempotently and verifies their hash', async run(createStore) {
    const store = await createStore(), data = bytes('blob'), sha = await sha256Hex(data);
    await store.putBlob(sha, data); await store.putBlob(sha, data);
    const got = await store.getBlob(sha);
    check(got instanceof Uint8Array, 'getBlob returns a Uint8Array');
    check(new TextDecoder().decode(got) === 'blob', 'getBlob returns the stored bytes');
    await rejects(store.putBlob('0'.repeat(64), data), notConflict, 'a hash mismatch is rejected');
    await rejects(store.getBlob('f'.repeat(64)), rejected, 'a missing blob is rejected');
  } },
  { name: 'returns copies, never the stored objects', async run(createStore) {
    const store = await createStore(), data = bytes('blob'), sha = await sha256Hex(data);
    await store.putBlob(sha, data); data[0] = 0;
    const first = await store.getBlob(sha); first[0] = 1;
    check(new TextDecoder().decode(await store.getBlob(sha)) === 'blob', 'mutating the input or a returned blob does not change the store');
    await store.writeThread(thread(), { expectedRevision: 0 });
    const [listed] = await store.listThreads(); listed.title = 'Mutated';
    check((await store.listThreads())[0].title === 'Dialogue', 'mutating a listed thread does not change the store');
  } },
  { name: 'rejects threads that reference missing blobs, foreign runs or exceed limits', async run(createStore) {
    const store = await createStore();
    const ref = fileRef('a'.repeat(64), 1);
    await rejects(store.writeThread(thread('t1', { messages: [{ id: 'm', attachment: ref }] }), { expectedRevision: 0 }), notConflict, 'a missing blob reference is rejected');
    await rejects(store.writeThread(thread('t2', { runs: [{ id: 'r', threadId: 'other' }] }), { expectedRevision: 0 }), notConflict, 'a foreign run is rejected');
    await rejects(store.writeThread(thread('t3', { title: 'x'.repeat(16 * 1024 * 1024) }), { expectedRevision: 0 }), error => rejected(error) && /16 MiB/.test(error.message), 'an oversize thread is rejected');
    check((await store.listThreads()).length === 0, 'rejected writes store nothing');
    const large = new Uint8Array(24 * 1024 * 1024 + 1);
    await rejects(store.putBlob(await sha256Hex(large), large), error => rejected(error) && /24 MiB/.test(error.message), 'an oversize blob is rejected');
  } },
  { name: 'garbage collection keeps referenced and recent blobs', async run(createStore) {
    const kept = bytes('kept'), loose = bytes('loose'), keptSha = await sha256Hex(kept), looseSha = await sha256Hex(loose);
    const fill = async store => {
      await store.putBlob(keptSha, kept); await store.putBlob(looseSha, loose);
      await store.writeThread(thread('t1', { messages: [{ id: 'm', file: fileRef(keptSha, kept.byteLength) }] }), { expectedRevision: 0 });
    };
    const patient = await createStore({ graceMs: 60 * 60 * 1000 });
    if (!patient.collectGarbage) return;
    await fill(patient); await patient.collectGarbage();
    await patient.getBlob(looseSha);
    const eager = await createStore({ graceMs: 0 });
    await fill(eager);
    const gone = bytes('gone'), dropped = bytes('dropped'), goneSha = await sha256Hex(gone), droppedSha = await sha256Hex(dropped);
    await eager.putBlob(goneSha, gone); await eager.putBlob(droppedSha, dropped);
    await eager.writeThread(thread('t2', { messages: [{ id: 'm', file: fileRef(goneSha, gone.byteLength) }] }), { expectedRevision: 0 });
    await eager.writeThread(thread('t3', { messages: [{ id: 'm', file: fileRef(droppedSha, dropped.byteLength) }] }), { expectedRevision: 0 });
    await eager.deleteThread('t2', { expectedRevision: 1 });
    await eager.writeThread(thread('t3'), { expectedRevision: 1 });
    await pause(20); await eager.collectGarbage();
    await eager.getBlob(keptSha);
    await rejects(eager.getBlob(looseSha), rejected, 'an old unreferenced blob is collected');
    await rejects(eager.getBlob(goneSha), rejected, 'a blob of a deleted thread is collected');
    await rejects(eager.getBlob(droppedSha), rejected, 'a blob dropped by an update is collected');
  } },
  { name: 'watchers hear committed changes only', async run(createStore, { openPeer = store => store } = {}) {
    const store = await createStore();
    if (!store.watch) return;
    let calls = 0; const stop = openPeer(store).watch(() => { calls++; });
    await store.writeThread(thread(), { expectedRevision: 0 });
    check(await waitFor(() => calls >= 1), 'a committed write notifies watchers');
    const afterWrite = calls;
    await store.deleteThread('t1', { expectedRevision: 1 });
    check(await waitFor(() => calls > afterWrite), 'a committed delete notifies watchers');
    await store.writeThread(thread(), { expectedRevision: 0 });
    await waitFor(() => false, 50); const settled = calls;
    await rejects(store.writeThread(thread(), { expectedRevision: 9 }), conflict, 'a stale write conflicts');
    await pause(50);
    check(calls === settled, 'a rejected write does not notify watchers');
    stop();
    await store.deleteThread('t1', { expectedRevision: 1 });
    await pause(50);
    check(calls === settled, 'a stopped watcher hears nothing');
  } },
];
