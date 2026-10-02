import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFolder, createOpfsRoot, createSubfolder, deleteOpfsRoot, listOpfsRoots, opfsProjectsRoot, persistStorage, pickFolder, queryAccess, requestAccess, storageMode } from '../src/storage/roots.js';
import { createProjectMeta } from '../src/storage/project-meta.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const names = async directory => { const out = []; for await (const name of directory.keys()) out.push(name); return out.sort(); };
const opfs = (root = new MemoryDirectoryHandle('opfs')) => ({ root, getDirectory: async () => root });

test('classifyFolder: empty ignores system clutter, a project carries its meta, anything else is files', async () => {
  assert.deepEqual(await classifyFolder(new MemoryDirectoryHandle('a')), { status: 'empty' });
  assert.deepEqual(await classifyFolder(new MemoryDirectoryHandle('a', { '.DS_Store': 'x', 'Thumbs.db': 'x', 'desktop.ini': 'x' })), { status: 'empty' });
  assert.deepEqual(await classifyFolder(new MemoryDirectoryHandle('a', { '.DS_Store': 'x', 'index.tpl': 'hello' })), { status: 'files' });
  assert.deepEqual(await classifyFolder(new MemoryDirectoryHandle('a', { notes: new MemoryDirectoryHandle('notes') })), { status: 'files' });
  // A sidecar without project.json (an interrupted create, values only) is not a project.
  assert.deepEqual(await classifyFolder(new MemoryDirectoryHandle('a', { '.trafficops': new MemoryDirectoryHandle('.trafficops', { 'values.json': '{}' }) })), { status: 'files' });
  const project = new MemoryDirectoryHandle('p', { 'index.tpl': 'hello' });
  await createProjectMeta(project, { schema: 1, projectId: 'p-1', kind: 'template', name: 'Bakery' });
  assert.deepEqual(await classifyFolder(project), { status: 'project', meta: { schema: 1, projectId: 'p-1', kind: 'template', name: 'Bakery' } });
});

test('createSubfolder slugs the name and suffixes -2, -3 on collisions (case-insensitive, files included)', async () => {
  const parent = new MemoryDirectoryHandle('parent', { 'my-landing': new MemoryDirectoryHandle('my-landing'), 'My-Landing-2': 'a file' });
  const first = await createSubfolder(parent, '  My Landing!  ');
  assert.equal(first.name, 'my-landing-3');
  assert.equal(first.kind, 'directory');
  assert.equal((await createSubfolder(parent, 'My Landing')).name, 'my-landing-4');
  assert.equal((await createSubfolder(parent, 'Пекарня №1')).name, 'пекарня-no1');
  assert.equal((await createSubfolder(parent, '***')).name, 'project');
  assert.equal((await createSubfolder(parent, 'x'.repeat(200))).name.length, 60);
  assert.deepEqual(await names(parent), ['My-Landing-2', 'my-landing', 'my-landing-3', 'my-landing-4', 'project', 'x'.repeat(60), 'пекарня-no1'].sort());
});

test('queryAccess and requestAccess fall back to granted when the permission API is missing (D9)', async () => {
  assert.equal(await queryAccess({ kind: 'directory' }), 'granted');
  assert.equal(await requestAccess({ kind: 'directory' }), 'granted');
  const calls = [];
  const handle = { queryPermission: async options => { calls.push(['query', options]); return 'prompt'; }, requestPermission: async options => { calls.push(['request', options]); return 'denied'; } };
  assert.equal(await queryAccess(handle), 'prompt');
  // The request is issued synchronously, so it keeps the click's user activation (D8).
  const pending = requestAccess(handle);
  assert.deepEqual(calls.at(-1), ['request', { mode: 'readwrite' }]);
  assert.equal(await pending, 'denied');
  assert.deepEqual(calls[0], ['query', { mode: 'readwrite' }]);
  assert.equal(await queryAccess({ queryPermission: async () => { throw new Error('revoked'); } }), 'denied');
});

test('storageMode probes the folder picker, then OPFS; a rejecting getDirectory is unsupported (D9)', async () => {
  assert.equal(await storageMode({ showDirectoryPicker: () => {}, storage: undefined }), 'folder');
  assert.equal(await storageMode({ showDirectoryPicker: undefined, storage: opfs() }), 'opfs');
  assert.equal(await storageMode({ showDirectoryPicker: undefined, storage: { getDirectory: async () => { throw new DOMException('private mode', 'SecurityError'); } } }), 'unsupported');
  assert.equal(await storageMode({ showDirectoryPicker: undefined, storage: {} }), 'unsupported');
  assert.equal(await storageMode({ showDirectoryPicker: undefined, storage: undefined }), 'unsupported');
});

test('pickFolder opens the picker synchronously in readwrite mode; cancelling returns null', async () => {
  const calls = [], folder = new MemoryDirectoryHandle('chosen');
  const pending = pickFolder({ showDirectoryPicker: async options => { calls.push(options); return folder; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'readwrite');
  assert.equal(await pending, folder);
  assert.equal(await pickFolder({ showDirectoryPicker: async () => { throw new DOMException('cancelled', 'AbortError'); } }), null);
  await assert.rejects(pickFolder({ showDirectoryPicker: async () => { throw new DOMException('busy', 'SecurityError'); } }), /busy/);
  await assert.rejects(pickFolder({ showDirectoryPicker: undefined }), /Chromium/);
});

test('OPFS roots live under projects/<projectId>; list, create and delete', async () => {
  const storage = opfs();
  assert.deepEqual(await listOpfsRoots({ storage }), []);
  const one = await createOpfsRoot('project-1', { storage }), two = await createOpfsRoot('project-2', { storage });
  assert.equal(one, await createOpfsRoot('project-1', { storage }));
  assert.equal((await opfsProjectsRoot({ storage })).name, 'projects');
  await (await opfsProjectsRoot({ storage })).getFileHandle('stray.txt', { create: true });
  assert.deepEqual((await listOpfsRoots({ storage })).map(entry => [entry.projectId, entry.handle]).sort(), [['project-1', one], ['project-2', two]]);
  await deleteOpfsRoot('project-1', { storage });
  await deleteOpfsRoot('missing', { storage });
  assert.deepEqual((await listOpfsRoots({ storage })).map(entry => entry.projectId), ['project-2']);
  // Any other id gets a hashed, path-safe folder name.
  const odd = await createOpfsRoot('../My project', { storage });
  assert.match(odd.name, /^~[a-f0-9]{64}$/);
  assert.equal(await createOpfsRoot('../My project', { storage }), odd);
  assert.deepEqual((await listOpfsRoots({ storage })).map(entry => entry.projectId).sort(), [null, 'project-2'].sort());
  await deleteOpfsRoot('../My project', { storage });
  assert.deepEqual((await listOpfsRoots({ storage })).map(entry => entry.projectId), ['project-2']);
  await assert.rejects(createOpfsRoot('', { storage }), /Invalid project ID/);
});

test('persistStorage asks once per storage and never throws', async () => {
  let calls = 0;
  const storage = { persist: async () => { calls++; return true; } };
  assert.equal(await persistStorage({ storage }), true);
  assert.equal(await persistStorage({ storage }), true);
  assert.equal(calls, 1);
  assert.equal(await persistStorage({ storage: { persist: async () => { throw new Error('no'); } } }), false);
  assert.equal(await persistStorage({ storage: {} }), false);
});
