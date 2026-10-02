import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDirectoryHandle, MemoryFileHandle } from './support/fs-access.js';
import { installMemoryIndexedDB } from './support/memory-idb.js';

const collect = async iterator => { const out = []; for await (const item of iterator) out.push(item); return out; };

test('isSameEntry compares identity', async () => {
  const root = new MemoryDirectoryHandle('root', { 'a.txt': 'a' });
  const file = await root.getFileHandle('a.txt');
  assert.equal(await file.isSameEntry(await root.getFileHandle('a.txt')), true);
  assert.equal(await file.isSameEntry(new MemoryFileHandle('a.txt')), false);
  assert.equal(await root.isSameEntry(root), true);
  assert.equal(await root.isSameEntry(new MemoryDirectoryHandle('root')), false);
});

test('permission states and requestPermission result', async () => {
  const root = new MemoryDirectoryHandle('root');
  assert.equal(await root.queryPermission({ mode: 'readwrite' }), 'granted');
  root.permission = 'prompt';
  assert.equal(await root.queryPermission(), 'prompt');
  assert.equal(await root.requestPermission(), 'prompt');
  root.permission = 'denied';
  assert.equal(await root.requestPermission(), 'denied');
  const file = new MemoryFileHandle('f');
  assert.equal(await file.queryPermission(), 'granted');
  file.permission = 'denied';
  assert.equal(await file.requestPermission(), 'denied');
});

test('removeEntry is recursive only on request', async () => {
  const root = new MemoryDirectoryHandle('root');
  const sub = await root.getDirectoryHandle('sub', { create: true });
  await sub.getFileHandle('x', { create: true });
  await assert.rejects(root.removeEntry('sub'), { name: 'InvalidModificationError' });
  await root.removeEntry('sub', { recursive: true });
  assert.equal(root.children.has('sub'), false);
  await assert.rejects(root.removeEntry('sub'), { name: 'NotFoundError' });
});

test('keys() and entries() iterate children', async () => {
  const root = new MemoryDirectoryHandle('root', { 'a.txt': 'a', 'b.txt': 'b' });
  assert.deepEqual(await collect(root.keys()), ['a.txt', 'b.txt']);
  const entries = await collect(root.entries());
  assert.deepEqual(entries.map(([name]) => name), ['a.txt', 'b.txt']);
  assert.equal(entries[0][1], await root.getFileHandle('a.txt'));
});

test('lastModified comes from the injected clock and is inherited', async () => {
  let time = 1000;
  const root = new MemoryDirectoryHandle('root', {}, { now: () => time });
  const sub = await root.getDirectoryHandle('sub', { create: true });
  const file = await sub.getFileHandle('f', { create: true });
  const writable = await file.createWritable();
  await writable.write('hi');
  time = 2000;
  await writable.close();
  assert.equal((await file.getFile()).lastModified, 2000);
  const seeded = new MemoryDirectoryHandle('r2', { 'seed.txt': 'x' }, { now: () => 5 });
  assert.equal((await (await seeded.getFileHandle('seed.txt')).getFile()).lastModified, 5);
});

test('createWritable commits on close and abort keeps old content', async () => {
  const root = new MemoryDirectoryHandle('root', { 'a.txt': 'old' });
  const file = await root.getFileHandle('a.txt');
  const writable = await file.createWritable();
  await writable.write('new');
  assert.equal(await (await file.getFile()).text(), 'old');
  await writable.close();
  assert.equal(await (await file.getFile()).text(), 'new');
  const aborted = await file.createWritable();
  await aborted.write('lost');
  await aborted.abort();
  assert.equal(await (await file.getFile()).text(), 'new');
  const truncating = await file.createWritable();
  await truncating.close();
  assert.equal(await (await file.getFile()).text(), '');
});

const request = target => new Promise((resolve, reject) => { target.onsuccess = () => resolve(target.result); target.onerror = () => reject(target.error); });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('abort')); });

test('memory indexedDB: upgrade, keyPath, put/get/getAll/delete, completion', async t => {
  installMemoryIndexedDB(t);
  let upgrades = 0;
  const opening = indexedDB.open('db', 1);
  opening.onupgradeneeded = () => { upgrades++; opening.result.createObjectStore('projects', { keyPath: 'id' }); };
  const db = await request(opening);
  assert.equal(upgrades, 1);
  assert.equal(db.objectStoreNames.contains('projects'), true);
  const write = db.transaction(['projects'], 'readwrite');
  const store = write.objectStore('projects');
  store.put({ id: 'a', n: 1 });
  store.put({ id: 'b', n: 2 });
  await done(write);
  const read = db.transaction(['projects'], 'readonly');
  const got = request(read.objectStore('projects').get('a'));
  const all = request(read.objectStore('projects').getAll());
  assert.deepEqual(await got, { id: 'a', n: 1 });
  assert.equal((await all).length, 2);
  await done(read);
  const remove = db.transaction(['projects'], 'readwrite');
  remove.objectStore('projects').delete('a');
  await done(remove);
  const check = db.transaction(['projects'], 'readonly');
  assert.deepEqual((await request(check.objectStore('projects').getAll())).map(v => v.id), ['b']);
  await done(check);
  const again = indexedDB.open('db', 1);
  again.onupgradeneeded = () => { upgrades++; };
  await request(again);
  assert.equal(upgrades, 1);
});

test('memory indexedDB restores the global', async t => {
  const inner = { after: [] };
  installMemoryIndexedDB({ after: fn => inner.after.push(fn) });
  assert.equal(typeof globalThis.indexedDB.open, 'function');
  inner.after.forEach(fn => fn());
  assert.equal(globalThis.indexedDB, undefined);
});

test('memory indexedDB keeps MemoryHandle values by reference, like browsers keep FileSystemHandle', async t => {
  installMemoryIndexedDB(t);
  const handle = new MemoryDirectoryHandle('project', { 'index.tpl': 'x' }), file = new MemoryFileHandle('a.txt');
  const opening = indexedDB.open('handles', 1);
  opening.onupgradeneeded = () => { opening.result.createObjectStore('projects', { keyPath: 'id' }); };
  const db = await request(opening);
  const write = db.transaction(['projects'], 'readwrite');
  const entry = { id: 'a', handle, nested: { files: [file] }, bytes: new Uint8Array([1, 2]) };
  write.objectStore('projects').put(entry);
  await done(write);
  entry.bytes[0] = 9; entry.nested.files.push('mutated');
  const read = db.transaction(['projects'], 'readonly');
  const got = await request(read.objectStore('projects').get('a'));
  await done(read);
  assert.equal(got.handle, handle);
  assert.equal(got.nested.files[0], file);
  assert.equal(got.nested.files.length, 1);
  assert.deepEqual(got.bytes, new Uint8Array([1, 2]));
  assert.equal(await got.handle.isSameEntry(handle), true);
  assert.equal((await collect(got.handle.keys())).join(), 'index.tpl');
});
