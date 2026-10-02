import assert from 'node:assert/strict';
import test from 'node:test';
import { findSameEntry, forgetRecent, listRecent, rememberRecent } from '../src/storage/recent.js';
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

test('findSameEntry matches by isSameEntry and skips stale handles', async t => {
  installMemoryIndexedDB(t);
  const one = new MemoryDirectoryHandle('one'), two = new MemoryDirectoryHandle('two'), stale = new MemoryDirectoryHandle('stale');
  stale.isSameEntry = async () => { throw new DOMException('gone', 'NotFoundError'); };
  await rememberRecent({ projectId: 'stale', name: 'Stale', kind: 'landing', handle: stale, lastOpenedAt: 30 });
  await rememberRecent({ projectId: 'p-1', name: 'One', kind: 'landing', handle: one, lastOpenedAt: 10 });
  await rememberRecent({ projectId: 'p-2', name: 'Two', kind: 'landing', handle: two, lastOpenedAt: 20 });
  assert.equal((await findSameEntry(two)).projectId, 'p-2');
  assert.equal((await findSameEntry(one)).projectId, 'p-1');
  assert.equal(await findSameEntry(new MemoryDirectoryHandle('one')), null);
});

test('without indexedDB the registry is empty and remembering fails loudly', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; });
  assert.deepEqual(await listRecent(), []);
  assert.equal(await findSameEntry(new MemoryDirectoryHandle('x')), null);
  await assert.rejects(rememberRecent({ projectId: 'p', name: 'x', kind: 'landing', handle: new MemoryDirectoryHandle('x') }), /Browser storage is unavailable/);
});
