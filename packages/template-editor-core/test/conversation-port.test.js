import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoreConversationPort } from '../src/conversation-port.js';
import { createMemoryConversationStore } from '../src/memory-conversation-store.js';
import { sha256Hex } from '../src/conversation-format.js';

const big = 'y'.repeat(6000);
const png = `data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
function addThread(document, id, extra = {}) {
  document.threads.push({ id, title: id, archived: false, messages: [{ id: `${id}-m`, role: 'user', prompt: 'Go', status: 'saved', attachments: [{ id: `${id}-a`, name: 'x.png', mime: 'image/png', dataUrl: png }] }], ...extra });
  document.runs.push({ id: `${id}-r`, threadId: id, messageId: `${id}-m`, state: 'ready', updatedAt: 1, owner: { sessionId: 's', expiresAt: 1 }, base: { files: { 'index.html': big, 'logo.png': new Uint8Array([7]) } } });
  return document;
}
const port = (store, options = {}) => createStoreConversationPort(store, { projectId: 'p', ...options });

test('save then load in a fresh adapter round-trips the document, with revisions carried on threads', async () => {
  const store = createMemoryConversationStore(), a = port(store);
  const loaded = await a.load();
  assert.deepEqual([loaded.revision, loaded.threads, loaded.runs], [1, [], []]);
  const saved = await a.save(addThread(loaded, 't1'), { expectedRevision: 1 });
  assert.equal(saved.revision, 2); assert.equal(saved.threads[0].revision, 1);
  const reread = await port(store).load();
  assert.deepEqual(reread.threads, saved.threads); assert.deepEqual(reread.runs, saved.runs);
  assert.equal(JSON.stringify((await store.listThreads())[0]).includes(big), false);
});

test('a stale document is rejected locally before any I/O', async () => {
  const store = createMemoryConversationStore(), a = port(store);
  const document = await a.load();
  await assert.rejects(a.save(addThread(document, 't1'), { expectedRevision: 0 }), error => error.code === 'conflict');
  assert.equal((await store.listThreads()).length, 0);
});

test('a thread changed by another adapter fails the per-thread CAS; an untouched stale thread is not written', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  const seeded = await a.save(addThread(addThread(await a.load(), 't1'), 't2'), { expectedRevision: 1 });
  const fromB = await b.load();
  await a.save({ ...seeded, threads: seeded.threads.map(thread => thread.id === 't1' ? { ...thread, title: 'A edit' } : thread) }, { expectedRevision: seeded.revision });
  await assert.rejects(b.save({ ...fromB, threads: fromB.threads.map(thread => thread.id === 't1' ? { ...thread, title: 'B edit' } : thread) }, { expectedRevision: fromB.revision }), error => error.code === 'conflict');
  const retry = await b.load();
  const ok = await b.save({ ...retry, threads: retry.threads.map(thread => thread.id === 't2' ? { ...thread, title: 'B t2' } : thread) }, { expectedRevision: retry.revision });
  assert.deepEqual(ok.threads.map(thread => thread.title), ['A edit', 'B t2']);
});

test('a watch refresh between copy and save rejects the stale save without deleting the new thread', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  const seen = []; a.subscribe(document => seen.push(document.revision));
  const copy = await a.load();
  await b.save(addThread(await b.load(), 'from-b'), { expectedRevision: 1 });
  await settle();
  assert.equal(seen.length, 1); assert.ok(seen[0] > copy.revision, 'the counter increases on a watch refresh');
  await assert.rejects(a.save({ ...copy, threads: [], runs: [] }, { expectedRevision: copy.revision }), error => error.code === 'conflict');
  assert.deepEqual((await store.listThreads()).map(thread => thread.id), ['from-b']);
});

test('a heartbeat-only change reaches the store without hashing any blob; a message status change also persists', async () => {
  const store = createMemoryConversationStore(); let blobHashes = 0;
  const a = port(store, { hashBlob: bytes => { blobHashes++; return sha256Hex(bytes); } });
  const saved = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const before = blobHashes;
  const beat = structuredClone(saved); beat.runs[0].owner.expiresAt = 999; beat.threads[0].messages[0].status = 'interrupted';
  await a.save(beat, { expectedRevision: saved.revision });
  assert.equal(blobHashes, before);
  const reread = await port(store).load();
  assert.equal(reread.runs[0].owner.expiresAt, 999); assert.equal(reread.threads[0].messages[0].status, 'interrupted');
});

test('removing a thread deletes it and collects its blobs', async () => {
  const store = createMemoryConversationStore({ graceMs: 0 }), a = port(store);
  const saved = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const [file] = await store.listThreads(), sha = file.runs[0].base.files['index.html'].$trafficopsBlob;
  await new Promise(resolve => setTimeout(resolve, 5));
  await a.save({ ...saved, threads: [], runs: [] }, { expectedRevision: saved.revision });
  assert.equal((await store.listThreads()).length, 0);
  await assert.rejects(store.getBlob(sha));
});

test('a watch refresh that arrives during save I/O runs after the save completes', async () => {
  const inner = createMemoryConversationStore(), gate = deferred(), order = [];
  const store = { ...inner, async writeThread(thread, options) { order.push('write'); await gate.promise; return inner.writeThread(thread, options); },
    async listThreads() { order.push('list'); return inner.listThreads(); } };
  let notify; store.watch = listener => { notify = listener; return () => {}; };
  const a = port(store); a.subscribe(() => {});
  const document = await a.load(); order.length = 0;
  const pending = a.save(addThread(document, 't1'), { expectedRevision: document.revision });
  await settle(); notify(); await settle();
  assert.deepEqual(order, ['write']);
  gate.resolve(); await pending; await settle();
  assert.deepEqual(order, ['write', 'list']);
});

test('a failed save bumps the local counter so the runtime reloads', async () => {
  const inner = createMemoryConversationStore(); let fail = true;
  const store = { ...inner, async writeThread(thread, options) { if (fail) throw new Error('disk full'); return inner.writeThread(thread, options); } };
  const a = port(store), document = await a.load();
  await assert.rejects(a.save(addThread(structuredClone(document), 't1'), { expectedRevision: 1 }), /disk full/);
  fail = false;
  await assert.rejects(a.save(addThread(structuredClone(document), 't1'), { expectedRevision: 1 }), error => error.code === 'conflict');
  const reloaded = await a.load();
  assert.equal((await a.save(addThread(reloaded, 't1'), { expectedRevision: reloaded.revision })).threads.length, 1);
});

test('the adapter’s own writes never make a watch refresh read blobs', async () => {
  const inner = createMemoryConversationStore(); let reads = 0;
  const store = { ...inner, async getBlob(sha) { reads++; return inner.getBlob(sha); } };
  const a = port(store); a.subscribe(() => {});
  const document = await a.load();
  const saved = await a.save(addThread(document, 't1'), { expectedRevision: document.revision });
  const beat = structuredClone(saved); beat.runs[0].owner.expiresAt = 2;
  await a.save(beat, { expectedRevision: saved.revision }); await settle();
  assert.equal(reads, 0);
});

test('the first save after a load hashes no blob of an untouched snapshot', async () => {
  const store = createMemoryConversationStore(), seeder = port(store);
  await seeder.save(addThread(await seeder.load(), 't1'), { expectedRevision: 1 });
  let hashes = 0; const a = port(store, { hashBlob: bytes => { hashes++; return sha256Hex(bytes); } });
  const loaded = await a.load(); loaded.runs[0].owner.expiresAt = 3;
  await a.save(loaded, { expectedRevision: loaded.revision });
  assert.equal(hashes, 0);
});

test('a save with one over-limit thread writes nothing', async () => {
  const store = createMemoryConversationStore(), a = port(store), document = addThread(await a.load(), 't1');
  // Nine 1.9 MiB messages: each passes the 2 MiB text limit of clonePortablePayload, together they exceed 16 MiB.
  document.threads.push({ id: 't2', title: 't2', archived: false, messages: Array.from({ length: 9 }, (_, index) => ({ id: `big-${index}`, role: 'user', prompt: 'x'.repeat(1.9 * 1024 * 1024) })) });
  await assert.rejects(a.save(document, { expectedRevision: document.revision }), /16 MiB/);
  assert.equal((await store.listThreads()).length, 0);
});

test('a damaged thread file is skipped with a warning and never deleted', async () => {
  const inner = createMemoryConversationStore(), deleted = [];
  const store = { ...inner, async listThreads() { return [...await inner.listThreads(), { schema: 1, id: 'bad', revision: 3, messages: 'nope', runs: [] }]; },
    async deleteThread(id, options) { deleted.push(id); return inner.deleteThread(id, options); } };
  const a = port(store), loaded = await a.load();
  assert.deepEqual(loaded.threads, []); assert.match(loaded.storageWarning, /could not be opened/);
  const saved = await a.save(addThread(loaded, 't1'), { expectedRevision: loaded.revision });
  assert.deepEqual(saved.threads.map(thread => thread.id), ['t1']); assert.deepEqual(deleted, []);
});

test('a partial multi-thread commit converges when a state-setting change is re-applied after reload', async () => {
  const inner = createMemoryConversationStore(); let failOnce = false;
  const store = { ...inner, async writeThread(thread, options) {
    if (thread.id === 't2' && failOnce) { failOnce = false; throw Object.assign(new Error('Concurrent write'), { code: 'conflict' }); }
    return inner.writeThread(thread, options);
  } };
  const a = port(store), seeded = await a.save(addThread(addThread(await a.load(), 't1'), 't2'), { expectedRevision: 1 });
  failOnce = true;
  const interrupt = document => { for (const run of document.runs) run.state = 'interrupted'; return document; };
  await assert.rejects(a.save(interrupt(structuredClone(seeded)), { expectedRevision: seeded.revision }), error => error.code === 'conflict');
  const reloaded = await a.load();
  assert.deepEqual(reloaded.runs.map(run => run.state), ['interrupted', 'ready']);
  const saved = await a.save(interrupt(reloaded), { expectedRevision: reloaded.revision });
  assert.deepEqual(saved.runs.map(run => run.state), ['interrupted', 'interrupted']);
});

test('a blob collected after another window dropped it is re-uploaded on the next write', async () => {
  const store = createMemoryConversationStore({ graceMs: 0 }), a = port(store), b = port(store);
  const fromA = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const sha = (await store.listThreads())[0].runs[0].base.files['index.html'].$trafficopsBlob, fromB = await b.load();
  await new Promise(resolve => setTimeout(resolve, 5));
  await b.save({ ...fromB, threads: [], runs: [] }, { expectedRevision: fromB.revision });
  await assert.rejects(store.getBlob(sha));
  const saved = await a.save(addThread(structuredClone(fromA), 't2'), { expectedRevision: fromA.revision });
  assert.ok(saved.threads.some(thread => thread.id === 't2'));
  assert.equal((await store.getBlob(sha)).byteLength, 6000);
});
