import assert from 'node:assert/strict';
import test from 'node:test';
import { OPFS_OPENED_KEY, forgetOpfsOpened, forgetRecent, listRecent, opfsOpenedTimes, rememberOpfsOpened, rememberRecent } from '../src/storage/recent.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';
import { installMemoryIndexedDB } from './support/memory-idb.js';

test('rememberRecent upserts by projectId and keeps the handle; listRecent sorts by lastOpenedAt, newest first', async t => {
  installMemoryIndexedDB(t);
  assert.deepEqual(await listRecent(), []);
  const one = new MemoryDirectoryHandle('one'), moved = new MemoryDirectoryHandle('one-moved'), two = new MemoryDirectoryHandle('two');
  assert.deepEqual(await rememberRecent({ projectId: 'p-1', name: 'One', kind: 'landing', handle: one, lastOpenedAt: 10 }), { projectId: 'p-1', name: 'One', kind: 'landing', handle: one, lastOpenedAt: 10 });
  await rememberRecent({ projectId: 'p-2', name: 'Two', kind: 'template', handle: two, lastOpenedAt: 20 });
  assert.deepEqual((await listRecent()).map(entry => entry.projectId), ['p-2', 'p-1']);
  await rememberRecent({ projectId: 'p-1', name: 'One renamed', kind: 'template', handle: moved, lastOpenedAt: 30 });
  const list = await listRecent();
  assert.deepEqual(list.map(entry => [entry.projectId, entry.name, entry.kind, entry.lastOpenedAt]), [['p-1', 'One renamed', 'template', 30], ['p-2', 'Two', 'template', 20]]);
  assert.equal(list[0].handle, moved);
  assert.equal(list[1].handle, two);
  // lastOpenedAt defaults to now; omitted fields keep their stored value.
  const before = Date.now();
  const touched = await rememberRecent({ projectId: 'p-2' });
  assert.equal(touched.name, 'Two'); assert.equal(touched.handle, two);
  assert.ok(touched.lastOpenedAt >= before);
  assert.equal((await listRecent())[0].projectId, 'p-2');
  await forgetRecent('p-2');
  await forgetRecent('missing');
  assert.deepEqual((await listRecent()).map(entry => entry.projectId), ['p-1']);
});

test('rememberRecent rejects entries that cannot be reopened', async t => {
  installMemoryIndexedDB(t);
  await assert.rejects(rememberRecent({ name: 'x', kind: 'landing', handle: new MemoryDirectoryHandle('x') }), /project ID/);
  await assert.rejects(rememberRecent({ projectId: 'p', name: 'x', kind: 'landing' }), /folder/);
  await assert.rejects(rememberRecent({ projectId: 'p', name: 'x', kind: 'other', handle: new MemoryDirectoryHandle('x') }), /kind/);
  // A handle the browser cannot store fails with a clear message, not a raw DataCloneError.
  const uncloneable = { kind: 'directory', name: 'x', isSameEntry() {} };
  await assert.rejects(rememberRecent({ projectId: 'p', name: 'x', kind: 'landing', handle: uncloneable }), error => /could not store this folder/.test(error.message) && error.cause?.name === 'DataCloneError');
  assert.deepEqual(await listRecent(), []);
});

test('without indexedDB the registry is empty and remembering fails loudly', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; });
  assert.deepEqual(await listRecent(), []);
  await assert.rejects(rememberRecent({ projectId: 'p', name: 'x', kind: 'landing', handle: new MemoryDirectoryHandle('x') }), /Browser storage is unavailable/);
});

function memoryStorage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, String(value)); }, removeItem: key => { items.delete(key); } };
}

test('OPFS opens are recorded in localStorage by projectId; forgetting removes one; bad or blocked storage reads as empty', () => {
  const storage = memoryStorage();
  assert.deepEqual(opfsOpenedTimes({ storage }), {});
  rememberOpfsOpened('p-1', { storage, now: () => 10 });
  rememberOpfsOpened('p-2', { storage, now: () => 20 });
  rememberOpfsOpened('p-1', { storage, now: () => 30 });
  assert.deepEqual(opfsOpenedTimes({ storage }), { 'p-1': 30, 'p-2': 20 });
  forgetOpfsOpened('p-2', { storage });
  assert.deepEqual(opfsOpenedTimes({ storage }), { 'p-1': 30 });
  storage.setItem(OPFS_OPENED_KEY, '{nope');
  assert.deepEqual(opfsOpenedTimes({ storage }), {});
  storage.setItem(OPFS_OPENED_KEY, JSON.stringify({ ok: 5, bad: 'x', negative: -1 }));
  assert.deepEqual(opfsOpenedTimes({ storage }), { ok: 5 });
  const blocked = { getItem() { throw new DOMException('blocked', 'SecurityError'); }, setItem() { throw new DOMException('blocked', 'SecurityError'); } };
  assert.deepEqual(opfsOpenedTimes({ storage: blocked }), {});
  assert.doesNotThrow(() => rememberOpfsOpened('p-1', { storage: blocked }));
  assert.deepEqual(opfsOpenedTimes({ storage: null }), {});
});

test('the OPFS open list keeps the most recent 200 projects', () => {
  const storage = memoryStorage();
  for (let index = 0; index < 205; index++) rememberOpfsOpened(`p-${index}`, { storage, now: () => index });
  const times = opfsOpenedTimes({ storage });
  assert.equal(Object.keys(times).length, 200);
  assert.equal(times['p-4'], undefined); assert.equal(times['p-5'], 5); assert.equal(times['p-204'], 204);
});
