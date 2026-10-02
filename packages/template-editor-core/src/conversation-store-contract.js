import { BLOB_TAG, sha256Hex } from './conversation-format.js';

/** Runner-agnostic cases every ConversationStore must pass. createStore({ graceMs }) returns a fresh, empty store. */
function check(condition, message) { if (!condition) throw new Error(`Store contract: ${message}`); }
async function rejects(promise, predicate, message) {
  try { await promise; } catch (error) { check(predicate(error), `${message} (got ${error?.code || ''} ${error?.message})`); return; }
  check(false, `${message} (resolved)`);
}
const thread = (id = 't1', extra = {}) => ({ schema: 1, id, revision: 0, title: 'Dialogue', messages: [], runs: [], ...extra });
const bytes = text => new TextEncoder().encode(text);
const conflict = error => error?.code === 'conflict';

export const conversationStoreContract = [
  { name: 'writes, lists and versions a thread', async run(createStore) {
    const store = await createStore();
    check((await store.listThreads()).length === 0, 'a new store is empty');
    check((await store.writeThread(thread(), { expectedRevision: 0 })).revision === 1, 'create assigns revision 1');
    check((await store.writeThread({ ...thread(), title: 'Renamed', revision: 99 }, { expectedRevision: 1 })).revision === 2, 'the body revision is ignored');
    const [listed] = await store.listThreads();
    check(listed.id === 't1' && listed.revision === 2 && listed.title === 'Renamed', 'listThreads returns the latest thread with its revision');
  } },
  { name: 'rejects stale writes and duplicate creates as conflicts', async run(createStore) {
    const store = await createStore();
    await store.writeThread(thread(), { expectedRevision: 0 });
    await rejects(store.writeThread(thread(), { expectedRevision: 0 }), conflict, 'a second create conflicts');
    await rejects(store.writeThread(thread(), { expectedRevision: 5 }), conflict, 'a stale update conflicts');
  } },
  { name: 'deletes idempotently and with CAS', async run(createStore) {
    const store = await createStore();
    await store.deleteThread('missing', { expectedRevision: 0 });
    await store.writeThread(thread(), { expectedRevision: 0 });
    await rejects(store.deleteThread('t1', { expectedRevision: 7 }), conflict, 'a stale delete conflicts');
    await store.deleteThread('t1', { expectedRevision: 1 });
    check((await store.listThreads()).length === 0, 'the thread is deleted');
  } },
  { name: 'stores blobs idempotently and verifies their hash', async run(createStore) {
    const store = await createStore(), data = bytes('blob'), sha = await sha256Hex(data);
    await store.putBlob(sha, data); await store.putBlob(sha, data);
    check(new TextDecoder().decode(await store.getBlob(sha)) === 'blob', 'getBlob returns the stored bytes');
    await rejects(store.putBlob('0'.repeat(64), data), error => !conflict(error), 'a hash mismatch is rejected');
    await rejects(store.getBlob('f'.repeat(64)), () => true, 'a missing blob is rejected');
  } },
  { name: 'rejects threads that reference missing blobs, foreign runs or exceed limits', async run(createStore) {
    const store = await createStore();
    const ref = { [BLOB_TAG]: 'a'.repeat(64), encoding: 'bytes', size: 1 };
    await rejects(store.writeThread(thread('t1', { messages: [{ id: 'm', attachment: ref }] }), { expectedRevision: 0 }), error => !conflict(error), 'a missing blob reference is rejected');
    await rejects(store.writeThread(thread('t2', { runs: [{ id: 'r', threadId: 'other' }] }), { expectedRevision: 0 }), error => !conflict(error), 'a foreign run is rejected');
    await rejects(store.writeThread(thread('t3', { title: 'x'.repeat(16 * 1024 * 1024) }), { expectedRevision: 0 }), error => /16 MiB/.test(error.message), 'an oversize thread is rejected');
    const large = new Uint8Array(24 * 1024 * 1024 + 1);
    await rejects(store.putBlob(await sha256Hex(large), large), error => /24 MiB/.test(error.message), 'an oversize blob is rejected');
  } },
  { name: 'garbage collection keeps referenced and recent blobs', async run(createStore) {
    const kept = bytes('kept'), loose = bytes('loose'), keptSha = await sha256Hex(kept), looseSha = await sha256Hex(loose);
    const fill = async store => {
      await store.putBlob(keptSha, kept); await store.putBlob(looseSha, loose);
      await store.writeThread(thread('t1', { messages: [{ id: 'm', file: { [BLOB_TAG]: keptSha, encoding: 'bytes', size: kept.byteLength } }] }), { expectedRevision: 0 });
    };
    const patient = await createStore({ graceMs: 60 * 60 * 1000 });
    if (!patient.collectGarbage) return;
    await fill(patient); await patient.collectGarbage();
    await patient.getBlob(looseSha);
    const eager = await createStore({ graceMs: 0 });
    await fill(eager); await new Promise(resolve => setTimeout(resolve, 20)); await eager.collectGarbage();
    await eager.getBlob(keptSha);
    await rejects(eager.getBlob(looseSha), () => true, 'an old unreferenced blob is collected');
  } },
  { name: 'watchers hear committed changes', async run(createStore) {
    const store = await createStore();
    if (!store.watch) return;
    let calls = 0; const stop = store.watch(() => { calls++; });
    await store.writeThread(thread(), { expectedRevision: 0 }); await store.deleteThread('t1', { expectedRevision: 1 });
    await new Promise(resolve => setTimeout(resolve, 0)); stop();
    check(calls >= 2, 'writes and deletes notify watchers');
  } },
];
