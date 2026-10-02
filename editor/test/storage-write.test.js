import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '@trafficops/template-editor-core';
import { withLock } from '../src/storage/locks.js';
import { directoryAt, fileAt, lastModified, listDirectory, readFile, readJson, readText, removePath, writeFile } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = bytes => new TextDecoder().decode(bytes);

function fakeLocks() {
  const chains = new Map(), calls = [];
  return { calls, request(name, fn) { calls.push(name); const run = (chains.get(name) || Promise.resolve()).then(() => fn({ name }), () => fn({ name })); chains.set(name, run.catch(() => {})); return run; } };
}

for (const [label, make] of [['fallback', () => ({ locks: null })], ['injected locks.request', () => ({ locks: fakeLocks() })]]) {
  test(`withLock runs same-name callers in FIFO order (${label})`, async () => {
    const options = make(), order = [];
    const run = (id, ms) => withLock('a', async () => { order.push(`start ${id}`); await new Promise(r => setTimeout(r, ms)); order.push(`end ${id}`); return id; }, options);
    const results = await Promise.all([run(1, 15), run(2, 1), run(3, 0)]);
    assert.deepEqual(results, [1, 2, 3]);
    assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  });

  test(`withLock releases on throw and propagates (${label})`, async () => {
    const options = make();
    await assert.rejects(withLock('a', async () => { throw new Error('boom'); }, options), /boom/);
    assert.equal(await withLock('a', async () => 'ok', options), 'ok');
  });
}

test('fallback lock lets different names run concurrently', async () => {
  const order = [];
  const slow = withLock('a', async () => { await new Promise(r => setTimeout(r, 15)); order.push('a'); }, { locks: null });
  await withLock('b', async () => { order.push('b'); }, { locks: null });
  await slow;
  assert.deepEqual(order, ['b', 'a']);
});

test('withLock uses locks.request with the name when available', async () => {
  const locks = fakeLocks();
  assert.equal(await withLock('proj', async () => 7, { locks }), 7);
  assert.deepEqual(locks.calls, ['proj']);
});

test('writeFile creates nested directories and readers round-trip', async () => {
  const root = new MemoryDirectoryHandle('root');
  await writeFile(root, 'a/b/c.txt', 'héllo');
  await writeFile(root, 'a/b/d.bin', new Uint8Array([1, 2, 3]));
  assert.equal(await readText(root, 'a/b/c.txt'), 'héllo');
  assert.deepEqual([...await readFile(root, 'a/b/d.bin')], [1, 2, 3]);
  await writeFile(root, 'a/b/c.txt', 'new');
  assert.equal(await readText(root, 'a/b/c.txt'), 'new');
  await writeFile(root, 'top.json', '{"x":1}');
  assert.deepEqual(await readJson(root, 'top.json'), { x: 1 });
});

test('a write that throws mid-way aborts and keeps the old content', async () => {
  const root = new MemoryDirectoryHandle('root', { 'f.txt': 'old' });
  const file = root.children.get('f.txt'), original = file.createWritable.bind(file);
  let aborted = false;
  file.createWritable = async () => {
    const writable = await original();
    return { ...writable, write: async () => { throw new Error('disk fail'); }, abort: async () => { aborted = true; await writable.abort(); } };
  };
  await assert.rejects(writeFile(root, 'f.txt', 'new'), /disk fail/);
  assert.equal(aborted, true);
  assert.equal(await readText(root, 'f.txt'), 'old');
});

test('abort is optional on the writable', async () => {
  const root = new MemoryDirectoryHandle('root');
  const file = await root.getFileHandle('f.txt', { create: true });
  file.createWritable = async () => ({ write: async () => { throw new Error('nope'); }, close: async () => {} });
  await assert.rejects(writeFile(root, 'f.txt', 'x'), /nope/);
});

test('QuotaExceededError becomes a friendly error with cause', async () => {
  const root = new MemoryDirectoryHandle('root');
  const file = await root.getFileHandle('f.txt', { create: true });
  const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  file.createWritable = async () => ({ write: async () => { throw quota; }, close: async () => {}, abort: async () => {} });
  await assert.rejects(writeFile(root, 'f.txt', 'x'), error => {
    assert.equal(error.message, 'Browser storage is full — export the project as ZIP and free some space.');
    assert.equal(error.cause, quota);
    return true;
  });
});

test('missing paths: reads return null, removal is ok, listing is empty', async () => {
  const root = new MemoryDirectoryHandle('root', { 'f.txt': 'x' });
  assert.equal(await readFile(root, 'nope/x.txt'), null);
  assert.equal(await readFile(root, 'nope.txt'), null);
  assert.equal(await readText(root, 'nope.txt'), null);
  assert.equal(await readJson(root, 'nope.json'), null);
  assert.equal(await lastModified(root, 'nope.txt'), null);
  assert.equal(await directoryAt(root, 'nope'), null);
  assert.equal(await fileAt(root, 'nope/x'), null);
  await removePath(root, 'nope/x.txt');
  await removePath(root, 'nope.txt');
  assert.deepEqual(await listDirectory(root, 'nope'), []);
});

test('directoryAt and fileAt create on demand; empty path is the root', async () => {
  const root = new MemoryDirectoryHandle('root');
  assert.equal(await directoryAt(root, ''), root);
  const dir = await directoryAt(root, 'x/y', { create: true });
  assert.equal(root.children.get('x').children.get('y'), dir);
  const file = await fileAt(root, 'x/y/z.txt', { create: true });
  assert.equal(file.kind, 'file');
});

test('readJson parse errors are ValidationErrors naming the path', async () => {
  const root = new MemoryDirectoryHandle('root', { 'bad.json': '{oops' });
  await assert.rejects(readJson(root, 'bad.json'), error => error instanceof ValidationError && /bad\.json/.test(error.message));
});

test('removePath removes files and recursive directories', async () => {
  const root = new MemoryDirectoryHandle('root');
  await writeFile(root, 'd/e/f.txt', 'x');
  await assert.rejects(removePath(root, 'd'));
  await removePath(root, 'd', { recursive: true });
  assert.equal(root.children.has('d'), false);
  await writeFile(root, 'g.txt', 'x');
  await removePath(root, 'g.txt');
  assert.equal(root.children.has('g.txt'), false);
});

test('lastModified uses the file clock', async () => {
  let time = 1000;
  const root = new MemoryDirectoryHandle('root', {}, { now: () => time });
  await writeFile(root, 'a/f.txt', 'x');
  assert.equal(await lastModified(root, 'a/f.txt'), 1000);
  time = 2000;
  await writeFile(root, 'a/f.txt', 'y');
  assert.equal(await lastModified(root, 'a/f.txt'), 2000);
});

test('listDirectory returns names and kinds', async () => {
  const root = new MemoryDirectoryHandle('root');
  await writeFile(root, 'd/a.txt', 'x');
  await writeFile(root, 'd/sub/b.txt', 'y');
  const list = await listDirectory(root, 'd');
  assert.deepEqual(list.sort((a, b) => a.name.localeCompare(b.name)), [{ name: 'a.txt', kind: 'file' }, { name: 'sub', kind: 'directory' }]);
  assert.equal((await listDirectory(root, '')).length, 1);
});
