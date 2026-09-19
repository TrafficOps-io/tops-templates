import assert from 'node:assert/strict';
import test from 'node:test';
import { contentsEqual, projectSnapshotEqual, readDirectoryProject, readProjectSettings, rememberDirectoryProject, syncDirectoryProject, writeProjectSettings } from '../src/directory-projects.js';

import { MemoryDirectoryHandle } from './support/fs-access.js';
const encoder = new TextEncoder();

test('reads a directory project recursively and ignores hidden host files', async () => {
  const root = new MemoryDirectoryHandle('campaign', {
    'index.tpl': '@layout\nHello\n@endlayout',
    '.DS_Store': 'ignored',
    images: new MemoryDirectoryHandle('images', { 'hero.png': new Uint8Array([1, 2, 3]) }),
    empty: new MemoryDirectoryHandle('empty'),
  });
  const project = await readDirectoryProject(root);
  assert.deepEqual(Object.keys(project.files).sort(), ['images/hero.png', 'index.tpl']);
  assert.equal(project.files['index.tpl'], '@layout\nHello\n@endlayout');
  assert.deepEqual(project.files['images/hero.png'], new Uint8Array([1, 2, 3]));
  assert.deepEqual(project.folders, ['empty', 'images']);
});

test('sync writes new and changed files, deletes removed files and preserves unknown files', async () => {
  const root = new MemoryDirectoryHandle('campaign', {
    'index.tpl': 'old',
    'remove.txt': 'remove me',
    'external.txt': 'leave me',
  });
  const previous = { files: { 'index.tpl': 'old', 'remove.txt': 'remove me' }, folders: [] };
  const next = { files: { 'index.tpl': 'new', 'images/hero.png': new Uint8Array([9, 8]) }, folders: ['images', 'empty'] };
  const saved = await syncDirectoryProject(root, previous, next);
  assert.ok(projectSnapshotEqual(saved, next));
  assert.equal(new TextDecoder().decode(root.entries.get('index.tpl').value), 'new');
  assert.equal(root.entries.has('remove.txt'), false);
  assert.equal(new TextDecoder().decode(root.entries.get('external.txt').value), 'leave me');
  assert.deepEqual(root.entries.get('images').entries.get('hero.png').value, new Uint8Array([9, 8]));
  assert.equal(root.entries.get('empty').kind, 'directory');
});

test('sync rejects an external edit before applying any Studio writes', async () => {
  const root = new MemoryDirectoryHandle('campaign', { 'index.tpl': 'changed elsewhere', 'styles.css': 'old' });
  const previous = { files: { 'index.tpl': 'old', 'styles.css': 'old' }, folders: [] };
  const next = { files: { 'index.tpl': 'from Studio', 'styles.css': 'new' }, folders: [] };
  await assert.rejects(() => syncDirectoryProject(root, previous, next), /changed outside Studio/);
  assert.equal(new TextDecoder().decode(root.entries.get('styles.css').value), 'old');
});

test('content and snapshot equality work across strings and binary values', () => {
  assert.equal(contentsEqual('hello', encoder.encode('hello')), true);
  assert.equal(contentsEqual(new Uint8Array([1]), new Uint8Array([2])), false);
  assert.equal(projectSnapshotEqual({ files: { a: 'x' }, folders: ['empty'] }, { files: { a: 'x' }, folders: ['empty'] }), true);
});

test('project settings persist in an internal sidecar outside the template file tree', async () => {
  const root = new MemoryDirectoryHandle('campaign', { 'index.tpl': 'hello' });
  await writeProjectSettings(root, { headline: 'Saved locally' });
  assert.deepEqual(await readProjectSettings(root), { headline: 'Saved locally' });
  assert.deepEqual(Object.keys((await readDirectoryProject(root)).files), ['index.tpl']);
  await writeProjectSettings(root, {});
  assert.equal(root.entries.has('.trafficops'), false);
});

test('remembering the same directory reuses its project identity', async () => {
  const handle = { name: 'campaign', isSameEntry: async candidate => candidate === handle };
  const first = await rememberDirectoryProject(handle);
  const second = await rememberDirectoryProject(handle, [first]);
  assert.equal(second.id, first.id);
  assert.equal(second.name, 'campaign');
});
