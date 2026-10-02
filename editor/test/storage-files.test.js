import assert from 'node:assert/strict';
import test from 'node:test';
import { contentsEqual } from '@trafficops/template-editor-core';
import { projectSnapshotEqual, readProjectTree, syncProjectTree } from '../src/storage/files.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const encoder = new TextEncoder(), text = handle => new TextDecoder().decode(handle.value);
const conflict = error => error?.code === 'conflict' && /changed outside Studio/.test(error.message);

test('reads a project tree recursively and ignores hidden host files and the .trafficops sidecar', async () => {
  const root = new MemoryDirectoryHandle('campaign', {
    'index.tpl': '@layout\nHello\n@endlayout',
    '.DS_Store': 'ignored',
    '.trafficops': new MemoryDirectoryHandle('.trafficops', { 'project.json': '{}' }),
    images: new MemoryDirectoryHandle('images', { 'hero.png': new Uint8Array([1, 2, 3]) }),
    empty: new MemoryDirectoryHandle('empty'),
  });
  const project = await readProjectTree(root);
  assert.deepEqual(Object.keys(project.files).sort(), ['images/hero.png', 'index.tpl']);
  assert.equal(project.files['index.tpl'], '@layout\nHello\n@endlayout');
  assert.deepEqual(project.files['images/hero.png'], new Uint8Array([1, 2, 3]));
  assert.deepEqual(project.folders, ['empty', 'images']);
});

test('read rejects invalid UTF-8 in a text file and oversized text files', async () => {
  await assert.rejects(readProjectTree(new MemoryDirectoryHandle('p', { 'index.tpl': new Uint8Array([0xff, 0xfe]) })), /not valid UTF-8: index.tpl/);
  await assert.rejects(readProjectTree(new MemoryDirectoryHandle('p', { 'big.css': new Uint8Array(2 * 1024 * 1024 + 1) })), /too large: big.css/);
});

test('sync writes new and changed files, deletes removed files and preserves unknown files', async () => {
  const root = new MemoryDirectoryHandle('campaign', {
    'index.tpl': 'old',
    'remove.txt': 'remove me',
    'external.txt': 'leave me',
  });
  const previous = { files: { 'index.tpl': 'old', 'remove.txt': 'remove me' }, folders: [] };
  const next = { files: { 'index.tpl': 'new', 'images/hero.png': new Uint8Array([9, 8]) }, folders: ['images', 'empty'] };
  const saved = await syncProjectTree(root, previous, next);
  assert.ok(projectSnapshotEqual(saved, next));
  assert.equal(text(root.children.get('index.tpl')), 'new');
  assert.equal(root.children.has('remove.txt'), false);
  assert.equal(text(root.children.get('external.txt')), 'leave me');
  assert.deepEqual(root.children.get('images').children.get('hero.png').value, new Uint8Array([9, 8]));
  assert.equal(root.children.get('empty').kind, 'directory');
});

test('sync rejects an external edit before applying any Studio writes', async () => {
  const root = new MemoryDirectoryHandle('campaign', { 'index.tpl': 'changed elsewhere', 'styles.css': 'old' });
  const previous = { files: { 'index.tpl': 'old', 'styles.css': 'old' }, folders: [] };
  const next = { files: { 'index.tpl': 'from Studio', 'styles.css': 'new' }, folders: [] };
  await assert.rejects(() => syncProjectTree(root, previous, next), conflict);
  assert.equal(text(root.children.get('styles.css')), 'old');
});

test('sync conflicts when a new file already exists, a known file vanished, or a removed file was edited', async () => {
  const created = new MemoryDirectoryHandle('p', { 'index.tpl': 'a', 'new.css': 'someone else' });
  await assert.rejects(syncProjectTree(created, { files: { 'index.tpl': 'a' }, folders: [] }, { files: { 'index.tpl': 'a', 'new.css': 'mine' }, folders: [] }), conflict);
  const vanished = new MemoryDirectoryHandle('p', {});
  await assert.rejects(syncProjectTree(vanished, { files: { 'index.tpl': 'a' }, folders: [] }, { files: { 'index.tpl': 'b' }, folders: [] }), conflict);
  const edited = new MemoryDirectoryHandle('p', { 'index.tpl': 'a', 'gone.css': 'edited' });
  await assert.rejects(syncProjectTree(edited, { files: { 'index.tpl': 'a', 'gone.css': 'old' }, folders: [] }, { files: { 'index.tpl': 'a' }, folders: [] }), conflict);
  assert.equal(text(edited.children.get('gone.css')), 'edited');
});

test('sync removes empty folders deepest first but retains folders holding unknown files', async () => {
  const root = new MemoryDirectoryHandle('p', {
    'index.tpl': 'a',
    a: new MemoryDirectoryHandle('a', { b: new MemoryDirectoryHandle('b') }),
    kept: new MemoryDirectoryHandle('kept', { 'notes.txt': 'external' }),
  });
  await syncProjectTree(root, { files: { 'index.tpl': 'a' }, folders: ['a', 'a/b', 'kept'] }, { files: { 'index.tpl': 'a' }, folders: [] });
  assert.equal(root.children.has('a'), false);
  assert.equal(text(root.children.get('kept').children.get('notes.txt')), 'external');
});

test('sync validates the next project before touching the folder', async () => {
  const root = new MemoryDirectoryHandle('p', { 'index.tpl': 'a' });
  await assert.rejects(syncProjectTree(root, { files: { 'index.tpl': 'a' }, folders: [] }, { files: { 'index.tpl': 'b', '../escape.txt': 'x' }, folders: [] }));
  assert.equal(text(root.children.get('index.tpl')), 'a');
});

test('content and snapshot equality work across strings and binary values', () => {
  assert.equal(contentsEqual('hello', encoder.encode('hello')), true);
  assert.equal(contentsEqual(new Uint8Array([1]), new Uint8Array([2])), false);
  assert.equal(projectSnapshotEqual({ files: { a: 'x' }, folders: ['empty'] }, { files: { a: 'x' }, folders: ['empty'] }), true);
  assert.equal(projectSnapshotEqual({ files: { a: 'x' }, folders: ['one'] }, { files: { a: 'x' }, folders: ['two'] }), false);
});
