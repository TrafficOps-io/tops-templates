import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoreConversationPort, sha256Hex } from '@trafficops/template-editor-core';
import { conversationStoreContract } from '@trafficops/template-editor-core/conversation-store-contract';
import { createDirectoryConversationStore } from '../src/storage/directory-conversation-store.js';
import { lastModified, readJson, readText, writeFile } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const DIR = '.trafficops/conversations', TOMBSTONES = '.trafficops/conversation-tombstones.json';
const thread = (id = 't1', extra = {}) => ({ schema: 1, id, revision: 0, title: 'Dialogue', messages: [], runs: [], ...extra });
const bytes = text => new TextEncoder().encode(text);
const ref = (sha, size) => ({ $trafficopsBlob: sha, encoding: 'bytes', size });
const conflict = error => error?.code === 'conflict';
const validation = error => error?.code === 'validation';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let projects = 0;

// Opens stores (closed after the test) over one root; peer() is another window on the same folder.
function harness(t, { now, ...options } = {}) {
  const root = new MemoryDirectoryHandle('root', {}, now ? { now } : {}), projectId = `p${++projects}`, stores = [];
  const open = (extra = {}) => { const store = createDirectoryConversationStore(root, { projectId, locks: null, ...(now ? { now } : {}), ...options, ...extra }); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); });
  return { root, projectId, open };
}

for (const contract of conversationStoreContract) test(`directory store contract: ${contract.name}`, async t => {
  const peers = new Map();
  const createStore = ({ graceMs } = {}) => { const h = harness(t, graceMs === undefined ? {} : { graceMs }), store = h.open(); peers.set(store, h); return store; };
  await contract.run(createStore, { openPeer: store => peers.get(store).open() });
});

test('a deleted thread recreated with expectedRevision 0 continues its revisions; the tombstone is cleared', async t => {
  const { root, open } = harness(t), store = open();
  await store.writeThread(thread(), { expectedRevision: 0 });
  await store.writeThread(thread(), { expectedRevision: 1 });
  await store.deleteThread('t1', { expectedRevision: 2 });
  assert.deepEqual(await readJson(root, TOMBSTONES), { t1: 2 });
  await assert.rejects(store.writeThread(thread(), { expectedRevision: 2 }), conflict, 'CAS compares the file revision only');
  assert.equal((await store.writeThread(thread(), { expectedRevision: 0 })).revision, 3);
  assert.deepEqual(await readJson(root, TOMBSTONES), {});
  const [listed] = await open().listThreads();
  assert.equal(listed.revision, 3);
  await store.deleteThread('t1', { expectedRevision: 3 });
  assert.equal((await store.writeThread(thread(), { expectedRevision: 0 })).revision, 4);
});

test('ids with tombstones, slashes, colons and spaces map to encoded file names', async t => {
  const { root, open } = harness(t), store = open(), ids = ['tombstones', 'conversation-tombstones', 'a/b', 'x:y', 'with space', '__proto__', '../up'];
  for (const id of ids) await store.writeThread(thread(id), { expectedRevision: 0 });
  const names = [...root.children.get('.trafficops').children.get('conversations').children.keys()].sort();
  assert.deepEqual(names, ids.map(id => `${encodeURIComponent(id)}.json`).sort());
  assert.deepEqual((await store.listThreads()).map(file => [file.id, file.revision]).sort(), ids.map(id => [id, 1]).sort());
  await store.deleteThread('a/b', { expectedRevision: 1 });
  await store.deleteThread('__proto__', { expectedRevision: 1 });
  assert.equal((await store.writeThread(thread('a/b'), { expectedRevision: 0 })).revision, 2);
  assert.equal((await store.writeThread(thread('__proto__'), { expectedRevision: 0 })).revision, 2);
  assert.equal((await store.writeThread(thread('tombstones'), { expectedRevision: 1 })).revision, 2);
  assert.equal(root.children.get('.trafficops').children.has('..'), false);
});

test('a damaged thread file is listed as damaged, blocks GC, cannot be overwritten or deleted, and is never removed', async t => {
  let time = 1000;
  const { root, open } = harness(t, { now: () => time, graceMs: 0 }), store = open();
  const loose = bytes('loose'), looseSha = await sha256Hex(loose);
  await store.putBlob(looseSha, loose);
  await writeFile(root, `${DIR}/bad%20one.json`, '{oops');
  await writeFile(root, `${DIR}/wrong.json`, JSON.stringify(thread('other', { revision: 1 })));
  await writeFile(root, `${DIR}/schema.json`, JSON.stringify({ schema: 9, id: 'schema' }));
  await writeFile(root, `${DIR}/notes.txt`, 'not a thread');
  const listed = (await store.listThreads()).sort((a, b) => a.id.localeCompare(b.id));
  const damaged = id => ({ schema: 1, id, revision: -1, damaged: true, messages: [], runs: [] });
  assert.deepEqual(listed, [damaged('bad one'), damaged('schema'), damaged('wrong')]);
  time = 5000;
  await store.collectGarbage();
  assert.ok(await lastModified(root, `${DIR}/blobs/${looseSha}`), 'GC is skipped while a thread file is damaged');
  await assert.rejects(store.writeThread(thread('bad one'), { expectedRevision: 0 }), conflict);
  await assert.rejects(store.writeThread(thread('bad one'), { expectedRevision: -1 }), conflict);
  await assert.rejects(store.deleteThread('bad one', { expectedRevision: -1 }), conflict);
  await assert.rejects(store.deleteThread('bad one', { expectedRevision: 0 }), conflict);
  assert.equal(await readText(root, `${DIR}/bad%20one.json`), '{oops');
  for (const name of ['bad%20one.json', 'wrong.json', 'schema.json']) root.children.get('.trafficops').children.get('conversations').children.delete(name);
  await store.collectGarbage();
  assert.equal(await lastModified(root, `${DIR}/blobs/${looseSha}`), null, 'GC runs once the damaged files are gone');
  assert.equal(await readText(root, `${DIR}/notes.txt`), 'not a thread');
});

test('GC keeps blobs referenced by pendingAi in project.json and skips a pass when project.json is unreadable', async t => {
  let time = 1000;
  const { root, open } = harness(t, { now: () => time, graceMs: 100 }), store = open();
  const pending = bytes('pending'), loose = bytes('loose'), pendingSha = await sha256Hex(pending), looseSha = await sha256Hex(loose);
  await store.putBlob(pendingSha, pending); await store.putBlob(looseSha, loose);
  await writeFile(root, '.trafficops/project.json', JSON.stringify({ schema: 1, projectId: 'x', pendingAi: { id: 'brief', prompt: 'Go', mode: 'build', generateImages: false, attachments: [{ id: 'a', name: 'a.png', mime: 'image/png', useOnPage: true, blob: ref(pendingSha, pending.byteLength) }] } }));
  time = 1050; await store.collectGarbage();
  assert.ok(await lastModified(root, `${DIR}/blobs/${looseSha}`), 'a recent blob survives the grace period');
  time = 2000; await store.collectGarbage();
  assert.equal(await lastModified(root, `${DIR}/blobs/${looseSha}`), null);
  assert.ok(await lastModified(root, `${DIR}/blobs/${pendingSha}`), 'a pendingAi blob is referenced');
  await writeFile(root, '.trafficops/project.json', '{broken');
  time = 9000; await store.collectGarbage();
  assert.ok(await lastModified(root, `${DIR}/blobs/${pendingSha}`), 'an unreadable project.json skips the pass');
  await writeFile(root, '.trafficops/project.json', JSON.stringify({ schema: 1, projectId: 'x' }));
  await store.collectGarbage();
  assert.equal(await lastModified(root, `${DIR}/blobs/${pendingSha}`), null, 'once pendingAi is claimed its blob is collectable');
});

test('putBlob writes new blobs, refreshes old ones after refreshMs and getBlob reports a missing one', async t => {
  let time = 1000;
  const { root, open } = harness(t, { now: () => time, refreshMs: 100 }), store = open(), data = bytes('blob'), sha = await sha256Hex(data);
  await store.putBlob(sha, data);
  time = 1050; await store.putBlob(sha, data);
  assert.equal(await lastModified(root, `${DIR}/blobs/${sha}`), 1000);
  time = 1200; await store.putBlob(sha, data);
  assert.equal(await lastModified(root, `${DIR}/blobs/${sha}`), 1200);
  await assert.rejects(store.getBlob('a'.repeat(64)), error => error.message === 'A conversation attachment is missing.');
  await assert.rejects(store.getBlob('../project.json'), error => error.message === 'A conversation attachment is missing.');
  await assert.rejects(store.putBlob('../x', data), validation);
  await assert.rejects(store.writeThread(thread('t', { messages: [{ id: 'm', file: ref('b'.repeat(64), 1) }] }), { expectedRevision: 0 }), validation);
});

test('the adapter round-trips through the directory store, warns about a damaged file and never deletes it', async t => {
  const { root, projectId, open } = harness(t), a = createStoreConversationPort(open(), { projectId }), b = createStoreConversationPort(open(), { projectId });
  const png = `data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`, big = 'y'.repeat(6000);
  const heard = []; const stop = b.subscribe(document => heard.push(document));
  const loaded = await b.load(), document = await a.load();
  document.threads.push({ id: 't1', title: 'One', archived: false, messages: [{ id: 'm', role: 'user', prompt: 'Go', status: 'saved', attachments: [{ id: 'a', name: 'x.png', mime: 'image/png', dataUrl: png }] }] });
  document.runs.push({ id: 'r', threadId: 't1', messageId: 'm', state: 'ready', updatedAt: 1, owner: { sessionId: 's', expiresAt: 1 }, base: { files: { 'index.html': big, 'logo.png': new Uint8Array([7]) } } });
  const saved = await a.save(document, { expectedRevision: document.revision });
  assert.equal(saved.threads[0].revision, 1);
  assert.equal((await readText(root, `${DIR}/t1.json`)).includes(big), false, 'large values live in blobs');
  const fresh = await createStoreConversationPort(open(), { projectId }).load();
  assert.deepEqual(fresh.threads, saved.threads); assert.deepEqual(fresh.runs, saved.runs);
  for (let i = 0; i < 100 && !heard.length; i++) await pause(10);
  assert.deepEqual(heard.at(-1)?.threads.map(item => item.id), ['t1'], 'a peer window hears the save');
  assert.equal(loaded.threads.length, 0);
  stop();
  await writeFile(root, `${DIR}/broken.json`, '{oops');
  const reloaded = await a.load();
  assert.match(reloaded.storageWarning, /could not be opened/);
  assert.deepEqual(reloaded.threads.map(item => item.id), ['t1']);
  const emptied = await a.save({ ...reloaded, threads: [], runs: [] }, { expectedRevision: reloaded.revision });
  assert.equal(emptied.threads.length, 0);
  assert.equal(await readText(root, `${DIR}/broken.json`), '{oops');
  assert.equal(await readText(root, `${DIR}/t1.json`), null);
});

test('fallback locks serialize two concurrent writers from different windows', async t => {
  const { open } = harness(t), first = open(), second = open();
  const results = await Promise.allSettled([first.writeThread(thread(), { expectedRevision: 0 }), second.writeThread(thread(), { expectedRevision: 0 })]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.ok(conflict(results.find(result => result.status === 'rejected').reason));
  const updates = await Promise.allSettled([first.writeThread(thread(), { expectedRevision: 1 }), second.writeThread(thread(), { expectedRevision: 1 }), first.deleteThread('t1', { expectedRevision: 1 })]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
});

test('thread writes, deletes and GC take the project lock; watch posts { threadId, revision } and close() stops it', async t => {
  const names = [], locks = { request: (name, fn) => { names.push(name); return fn(); } };
  const { projectId, open } = harness(t), store = open({ locks }), peer = open();
  const raw = new BroadcastChannel(`trafficops-conversations:${projectId}`), messages = [];
  raw.unref?.(); raw.onmessage = event => messages.push(event.data);
  t.after(() => raw.close());
  let calls = 0; peer.watch(() => { calls++; });
  await store.writeThread(thread(), { expectedRevision: 0 });
  await store.deleteThread('t1', { expectedRevision: 1 });
  await store.collectGarbage();
  assert.deepEqual(names, Array(3).fill(`trafficops-conversations:${projectId}`));
  for (let i = 0; i < 100 && (messages.length < 2 || calls < 2); i++) await pause(10);
  assert.deepEqual(messages, [{ threadId: 't1', revision: 1 }, { threadId: 't1', revision: 1 }]);
  assert.equal(calls, 2);
  peer.close();
  await store.writeThread(thread(), { expectedRevision: 0 });
  await pause(50);
  assert.equal(calls, 2, 'a closed store hears nothing');
  const custom = open({ channelName: 'custom-channel' }), listener = new BroadcastChannel('custom-channel'), heard = [];
  listener.unref?.(); listener.onmessage = event => heard.push(event.data);
  t.after(() => listener.close());
  await custom.writeThread(thread('c'), { expectedRevision: 0 });
  for (let i = 0; i < 100 && !heard.length; i++) await pause(10);
  assert.deepEqual(heard, [{ threadId: 'c', revision: 1 }]);
});
