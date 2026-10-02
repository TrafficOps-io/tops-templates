import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoreConversationPort } from '../src/conversation-port.js';
import { createMemoryConversationStore } from '../src/memory-conversation-store.js';
import { blobReferences, sha256Hex } from '../src/conversation-format.js';

const big = 'y'.repeat(6000);
const png = `data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
function addThread(document, id, extra = {}) {
  document.threads.push({ id, title: id, archived: false, messages: [{ id: `${id}-m`, role: 'user', prompt: 'Go', status: 'saved', attachments: [{ id: `${id}-a`, name: 'x.png', mime: 'image/png', dataUrl: png }] }], ...extra });
  document.runs.push({ id: `${id}-r`, threadId: id, messageId: `${id}-m`, state: 'ready', updatedAt: 1, owner: { sessionId: 's', expiresAt: 1 }, base: { files: { 'index.html': big, 'logo.png': new Uint8Array([7]) } } });
  return document;
}
function addUniqueThread(document, id) {
  addThread(document, id);
  document.threads.at(-1).messages[0].attachments[0].dataUrl = `data:image/png;base64,${Buffer.from(`png ${id}`).toString('base64')}`;
  Object.assign(document.runs.at(-1).base.files, { 'index.html': id + big, 'logo.png': new Uint8Array(Buffer.from(id)) });
  return document;
}
const port = (store, options = {}) => createStoreConversationPort(store, { projectId: 'p', ...options });
// Another window's raw thread write (no blobs), as a store watcher sees it.
const writeRaw = (store, id, revision) => store.writeThread({ schema: 1, id, revision, title: id, messages: [], runs: [] }, { expectedRevision: revision });
const conflict = error => error.code === 'conflict';
const within = (promise, ms = 1000) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('blocked')), ms); })]).finally(() => clearTimeout(timer)); };

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

test('a save from a revision that was never published is rejected before any I/O', async () => {
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

test('a stale copy that only adds a thread saves on top of a thread created elsewhere, which survives', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  const seen = []; a.subscribe(document => seen.push(document.revision));
  const copy = await a.load();
  await b.save(addThread(await b.load(), 'from-b'), { expectedRevision: 1 });
  await settle();
  assert.equal(seen.length, 1); assert.ok(seen[0] > copy.revision, 'the counter increases on a watch refresh');
  const saved = await a.save(addThread(copy, 't-a'), { expectedRevision: copy.revision });
  assert.deepEqual(saved.threads.map(thread => thread.id), ['t-a', 'from-b']);
  assert.deepEqual(saved.runs.map(run => run.threadId), ['t-a', 'from-b']);
  assert.deepEqual((await store.listThreads()).map(thread => thread.id).sort(), ['from-b', 't-a']);
});

test('a stale copy does not resurrect a dialogue deleted elsewhere', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  a.subscribe(() => {});
  const copy = await a.save(addThread(addThread(await a.load(), 't1'), 't2'), { expectedRevision: 1 });
  const fromB = await b.load();
  await b.save({ ...fromB, threads: fromB.threads.filter(thread => thread.id !== 't1'), runs: fromB.runs.filter(run => run.threadId !== 't1') }, { expectedRevision: fromB.revision });
  await settle();
  const change = structuredClone(copy); change.threads[1].title = 'A edit';
  const saved = await a.save(change, { expectedRevision: copy.revision });
  assert.deepEqual(saved.threads.map(thread => [thread.id, thread.title]), [['t2', 'A edit']]);
  assert.deepEqual(saved.runs.map(run => run.threadId), ['t2']);
  assert.deepEqual((await store.listThreads()).map(thread => thread.id), ['t2']);
});

test('another window writing frequently does not starve a save from an older copy', async () => {
  const store = createMemoryConversationStore(), a = port(store);
  a.subscribe(() => {});
  const copy = await a.save(addThread(await a.load(), 't-a'), { expectedRevision: 1 });
  for (let revision = 0; revision < 20; revision++) await writeRaw(store, 'from-b', revision);
  await settle();
  const change = structuredClone(copy); change.threads[0].title = 'A edit';
  const saved = await a.save(change, { expectedRevision: copy.revision });
  assert.deepEqual(saved.threads.map(thread => [thread.id, thread.title, thread.revision]), [['t-a', 'A edit', 2], ['from-b', 'from-b', 20]]);
});

test('a stale copy that changes a thread another window also changed fails the store CAS', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  a.subscribe(() => {});
  const copy = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const fromB = await b.load(); fromB.threads[0].title = 'B edit';
  await b.save(fromB, { expectedRevision: fromB.revision }); await settle();
  const change = structuredClone(copy); change.threads[0].title = 'A edit';
  await assert.rejects(a.save(change, { expectedRevision: copy.revision }), conflict);
  assert.equal((await store.listThreads())[0].title, 'B edit');
});

test('a copy older than the last 16 publications is rejected as too stale', async () => {
  const store = createMemoryConversationStore(), a = port(store), published = [];
  a.subscribe(document => published.push(document));
  const oldest = await a.load();
  for (let revision = 0; revision < 17; revision++) { await writeRaw(store, 'from-b', revision); await settle(); }
  assert.equal(published.length, 17); assert.equal(published.at(-1).revision, oldest.revision + 17);
  await assert.rejects(a.save(addThread(structuredClone(oldest), 't-a'), { expectedRevision: oldest.revision }), conflict);
  await assert.rejects(a.save(addThread(structuredClone(published[0]), 't-a'), { expectedRevision: published[0].revision }), conflict);
  // The 16th most recent publication is still accepted and rebased onto the latest state.
  const saved = await a.save(addThread(structuredClone(published[1]), 't-a'), { expectedRevision: published[1].revision });
  assert.deepEqual(saved.threads.map(thread => [thread.id, thread.revision]), [['from-b', 17], ['t-a', 1]]);
});

test('a burst of watch notifications during a save coalesces into at most two listings', async () => {
  const inner = createMemoryConversationStore(), gate = deferred(); let lists = 0, gated = false;
  const store = { ...inner, async writeThread(thread, options) { if (gated) await gate.promise; return inner.writeThread(thread, options); },
    async listThreads() { lists++; return inner.listThreads(); } };
  let notify; store.watch = listener => { notify = listener; return () => {}; };
  const a = port(store); a.subscribe(() => {});
  const document = await a.load(); gated = true;
  const pending = a.save(addThread(document, 't1'), { expectedRevision: document.revision });
  await settle(); lists = 0;
  for (let index = 0; index < 50; index++) notify();
  gate.resolve(); await pending; await settle();
  assert.ok(lists <= 2, `${lists} listings`);
});

test('a refresh joins only the dialogue that changed elsewhere', async () => {
  const inner = createMemoryConversationStore(), fetched = [];
  const store = { ...inner, async getBlob(sha) { fetched.push(sha); return inner.getBlob(sha); } };
  const seeder = port(inner);
  await seeder.save(['t1', 't2', 't3'].reduce(addUniqueThread, await seeder.load()), { expectedRevision: 1 });
  const a = port(store); let latest; a.subscribe(document => { latest = document; });
  await a.load(); fetched.length = 0;
  const b = port(inner), fromB = await b.load(), run = fromB.runs.find(item => item.threadId === 't2');
  run.updatedAt = 2; run.base.files['extra.txt'] = 'z'.repeat(5000);
  await b.save(fromB, { expectedRevision: fromB.revision }); await settle();
  const files = await inner.listThreads(), refs = id => blobReferences(files.find(file => file.id === id));
  assert.ok(fetched.length > 0);
  assert.deepEqual(fetched.filter(sha => !refs('t2').has(sha)), []);
  assert.equal(latest.runs.find(item => item.threadId === 't2').base.files['extra.txt'].length, 5000);
  assert.equal(latest.runs.find(item => item.threadId === 't1').base.files['index.html'], `t1${big}`);
});

test('a transient blob read failure keeps the previous version visible until a later refresh recovers', async () => {
  const inner = createMemoryConversationStore(); let failNext = false;
  const store = { ...inner, async getBlob(sha) { if (failNext) { failNext = false; throw new Error('EIO'); } return inner.getBlob(sha); } };
  const seeder = port(inner); await seeder.save(addThread(await seeder.load(), 't1'), { expectedRevision: 1 });
  const a = port(store), seen = []; a.subscribe(document => seen.push(document));
  await a.load();
  const b = port(inner), fromB = await b.load(); fromB.threads[0].title = 'B edit';
  failNext = true;
  await b.save(fromB, { expectedRevision: fromB.revision }); await settle();
  assert.equal(failNext, false, 'the refresh hit the failure');
  assert.ok(seen.every(document => document.threads.some(thread => thread.id === 't1')), 'the dialogue is never hidden');
  assert.deepEqual(seen.at(-1)?.threads.map(thread => [thread.id, thread.revision]), [['t1', 1]]);
  assert.match(seen.at(-1).storageWarning, /Dialogue t1 could not be refreshed; an older version is shown/);
  await writeRaw(inner, 'other', 0); await settle();
  assert.deepEqual(seen.at(-1).threads.map(thread => [thread.id, thread.title, thread.revision]), [['t1', 'B edit', 2], ['other', 'other', 1]]);
  assert.equal(seen.at(-1).storageWarning, undefined);
});

test('a dialogue never seen whose read fails once appears on the next watch event, though the listing is unchanged', async () => {
  const inner = createMemoryConversationStore(); let failNext = false, poke;
  const store = { ...inner, async getBlob(sha) { if (failNext) { failNext = false; throw new Error('EIO'); } return inner.getBlob(sha); },
    watch(listener) { poke = listener; return inner.watch(listener); } };
  const a = port(store), seen = []; a.subscribe(document => seen.push(document));
  await a.load();
  const b = port(inner); failNext = true;
  await b.save(addThread(await b.load(), 'from-b'), { expectedRevision: 1 }); await settle();
  assert.equal(failNext, false, 'the refresh hit the failure');
  assert.deepEqual(seen.at(-1).threads, []); assert.match(seen.at(-1).storageWarning, /from-b: EIO/);
  poke(); await settle();
  assert.deepEqual(seen.at(-1).threads.map(thread => [thread.id, thread.revision]), [['from-b', 1]]);
  assert.equal(seen.at(-1).storageWarning, undefined);
});

test('a persisted overflow past 100 dialogues still lets existing dialogues change; only adding one is rejected', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  const seed = addThread(await a.load(), 'live');
  for (let index = 1; index < 99; index++) seed.threads.push({ id: `t${index}`, title: `t${index}`, archived: false, messages: [] });
  await a.save(seed, { expectedRevision: seed.revision });
  // Two stale windows each add one dialogue: each save alone stays within 100, together they persist 101.
  const fromA = await a.load(), fromB = await b.load();
  fromB.threads.push({ id: 'from-b', title: 'from-b', archived: false, messages: [] });
  await b.save(fromB, { expectedRevision: fromB.revision });
  fromA.threads.push({ id: 'from-a', title: 'from-a', archived: false, messages: [] });
  await a.save(fromA, { expectedRevision: fromA.revision });
  assert.equal((await store.listThreads()).length, 101);
  const loaded = await a.load();
  assert.equal(loaded.threads.length, 101); assert.match(loaded.storageWarning, /more than 100 dialogues; delete some to start new ones/);
  const beat = structuredClone(loaded); beat.runs[0].owner.expiresAt = 42;
  const saved = await a.save(beat, { expectedRevision: loaded.revision });
  assert.equal(saved.runs[0].owner.expiresAt, 42); assert.match(saved.storageWarning, /more than 100 dialogues/);
  const more = structuredClone(saved); more.threads.push({ id: 'one-more', title: 'one-more', archived: false, messages: [] });
  await assert.rejects(a.save(more, { expectedRevision: saved.revision }), /at most 100 dialogues/);
  assert.equal((await store.listThreads()).length, 101);
  const fewer = await a.save({ ...saved, threads: saved.threads.filter(thread => thread.id !== 't1') }, { expectedRevision: saved.revision });
  assert.equal(fewer.threads.length, 100); assert.equal(fewer.storageWarning, undefined);
});

test('a partial commit followed by an I/O error is published by the next refresh', async () => {
  const inner = createMemoryConversationStore(); let fail = false;
  const store = { ...inner, async writeThread(thread, options) { if (fail && thread.id === 't2') throw new Error('disk full'); return inner.writeThread(thread, options); } };
  const a = port(store), seen = []; a.subscribe(document => seen.push(document));
  const seeded = await a.save(addThread(addThread(await a.load(), 't1'), 't2'), { expectedRevision: 1 });
  await settle(); seen.length = 0; fail = true;
  const change = structuredClone(seeded); for (const thread of change.threads) thread.title = 'edited';
  await assert.rejects(a.save(change, { expectedRevision: seeded.revision }), /disk full/);
  await settle();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].threads.map(thread => [thread.id, thread.title, thread.revision]), [['t1', 'edited', 2], ['t2', 't2', 1]]);
});

test('damaged files without an ID cause no extra notifications or conflicts on the adapter’s own saves', async () => {
  const inner = createMemoryConversationStore();
  const store = { ...inner, async listThreads() { return [...await inner.listThreads(), { schema: 1, revision: 1, messages: 'x', runs: [] }, { schema: 1, revision: 2, messages: 'y', runs: [] }]; } };
  const a = port(store), seen = []; a.subscribe(document => seen.push(document.revision));
  let document = await a.load();
  assert.match(document.storageWarning, /could not be opened/);
  document = await a.save(addThread(document, 't1'), { expectedRevision: document.revision }); await settle();
  for (let beat = 2; beat < 5; beat++) {
    const next = structuredClone(document); next.runs[0].owner.expiresAt = beat;
    document = await a.save(next, { expectedRevision: document.revision }); await settle();
  }
  assert.equal(seen.length, 4, 'one notification per save');
  assert.match(document.storageWarning, /could not be opened/);
});

test('garbage collection runs at most once per five minutes', async () => {
  const inner = createMemoryConversationStore(); let collections = 0, clock = 0;
  const store = { ...inner, async collectGarbage() { collections++; return inner.collectGarbage(); } };
  const a = port(store, { now: () => clock });
  let document = await a.load(); await settle();
  assert.equal(collections, 1, 'the first load collects');
  document = await a.save(['t1', 't2', 't3'].reduce(addUniqueThread, document), { expectedRevision: document.revision });
  const drop = current => ({ ...current, threads: current.threads.slice(1), runs: current.runs.slice(1) });
  clock = 6 * 60 * 1000;
  document = await a.save(drop(document), { expectedRevision: document.revision });
  clock += 60 * 1000;
  document = await a.save(drop(document), { expectedRevision: document.revision });
  await settle();
  assert.equal(collections, 2);
  assert.deepEqual(document.threads.map(thread => thread.id), ['t3']);
});

test('a collectGarbage that never settles blocks neither load nor save', async () => {
  const inner = createMemoryConversationStore(); let clock = 0, collections = 0;
  const store = { ...inner, collectGarbage() { collections++; return new Promise(() => {}); } };
  const a = port(store, { now: () => clock });
  let document = await within(a.load());
  document = await within(a.save(addThread(document, 't1'), { expectedRevision: document.revision }));
  clock = 6 * 60 * 1000;
  document = await within(a.save({ ...document, threads: [], runs: [] }, { expectedRevision: document.revision }));
  document = await within(a.save(addThread(document, 't2'), { expectedRevision: document.revision }));
  assert.equal(collections, 2); assert.deepEqual(document.threads.map(thread => thread.id), ['t2']);
});

test('a failing refresh is reported to onError', async () => {
  const inner = createMemoryConversationStore(), errors = []; let fail = false;
  const store = { ...inner, async listThreads() { if (fail) throw new Error('EACCES'); return inner.listThreads(); } };
  const a = port(store, { onError: error => errors.push(error.message) }); a.subscribe(() => {});
  await a.load(); fail = true;
  await writeRaw(inner, 'from-b', 0); await settle();
  assert.deepEqual(errors, ['EACCES']);
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

test('removing a thread deletes it and collects its blobs in the background', async () => {
  let clock = 0; const store = createMemoryConversationStore({ graceMs: 0 }), a = port(store, { now: () => clock });
  const saved = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const [file] = await store.listThreads(), sha = file.runs[0].base.files['index.html'].$trafficopsBlob;
  await new Promise(resolve => setTimeout(resolve, 5));
  clock = 6 * 60 * 1000;
  await a.save({ ...saved, threads: [], runs: [] }, { expectedRevision: saved.revision });
  assert.equal((await store.listThreads()).length, 0);
  await settle();
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

test('a failed save leaves the copy valid: re-saving the same document succeeds', async () => {
  const inner = createMemoryConversationStore(); let fail = true;
  const store = { ...inner, async writeThread(thread, options) { if (fail) throw new Error('disk full'); return inner.writeThread(thread, options); } };
  const a = port(store), document = await a.load();
  await assert.rejects(a.save(addThread(structuredClone(document), 't1'), { expectedRevision: 1 }), /disk full/);
  fail = false;
  const saved = await a.save(addThread(structuredClone(document), 't1'), { expectedRevision: 1 });
  assert.deepEqual(saved.threads.map(thread => [thread.id, thread.revision]), [['t1', 1]]);
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
  await store.collectGarbage();
  await assert.rejects(store.getBlob(sha));
  const saved = await a.save(addThread(structuredClone(fromA), 't2'), { expectedRevision: fromA.revision });
  assert.ok(saved.threads.some(thread => thread.id === 't2'));
  assert.equal((await store.getBlob(sha)).byteLength, 6000);
});
