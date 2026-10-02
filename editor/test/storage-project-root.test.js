import assert from 'node:assert/strict';
import test from 'node:test';
import { fromBase64, sha256Hex, toBase64 } from '@trafficops/template-editor-core';
import { adoptFolder, copyProject, createProjectInRoot, interruptImportedRuns, listKnownProjects, makeIndependent, readProjectSnapshot, remapConversation } from '../src/storage/project-root.js';
import { readProjectMeta, createProjectMeta } from '../src/storage/project-meta.js';
import { classifyFolder, createOpfsRoot, deleteOpfsRoot } from '../src/storage/roots.js';
import { rememberOpfsOpened, rememberRecent } from '../src/storage/recent.js';
import { fileAt, listDirectory, readFile, readText } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';
import { installMemoryIndexedDB } from './support/memory-idb.js';

const META = '.trafficops/project.json', DIR = '.trafficops/conversations';
const conflict = error => error?.code === 'conflict';
const png = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const brief = { id: 'brief-1', prompt: 'A bakery', mode: 'build', generateImages: false, attachments: [{ id: 'att-1', name: 'logo.png', mime: 'image/png', dataUrl: `data:image/png;base64,${toBase64(png)}`, useOnPage: true }] };
const conversation = projectId => ({ schema: 1, projectId, revision: 0,
  threads: [
    { id: 'thread-one', title: 'A', messages: [{ id: 'message-one', role: 'user', runId: 'run-one', parts: [{ type: 'text', text: 'Make it blue' }] }] },
    { id: 'thread-two', title: 'B', messages: [] },
  ],
  runs: [
    { id: 'run-one', threadId: 'thread-one', messageId: 'message-one', projectId, state: 'running', owner: { sessionId: 'old', fence: 1 }, updatedAt: 5, base: { projectId, files: { 'image.png': new Uint8Array([0, 128, 255]) }, translations: { en: { items: [{ id: 'run-one' }] } } } },
    { id: 'run-two', threadId: 'thread-one', state: 'queued', rebaseFrom: 'run-one' },
    { id: 'run-three', threadId: 'thread-two', state: 'completed' },
  ] });
const files = () => ({ 'index.tpl': 'hello', 'images/cover.png': new Uint8Array([1, 2, 3]) });
const threadFiles = async root => (await listDirectory(root, DIR)).filter(entry => entry.kind === 'file').map(entry => entry.name).sort();
const create = (root, extra = {}) => createProjectInRoot(root, { projectId: 'p-1', kind: 'landing', name: 'Bakery', files: files(), folders: ['images', 'empty'], values: { title: 'Hi' }, brief, sourceTemplateId: 'tpl-1', conversations: conversation('p-1'), ...extra });

test('createProjectInRoot writes files, values, history and the brief, with project.json last; readProjectSnapshot reads it all back', async () => {
  const root = new MemoryDirectoryHandle('bakery');
  const meta = await create(root);
  assert.equal(meta.projectId, 'p-1'); assert.equal(meta.kind, 'landing'); assert.equal(meta.name, 'Bakery'); assert.equal(meta.sourceTemplateId, 'tpl-1');
  assert.equal(meta.metadataRevision, 0); assert.ok(Number.isSafeInteger(meta.createdAt));
  assert.equal(meta.pendingAi.id, 'brief-1');
  assert.equal(meta.pendingAi.attachments[0].blob.$trafficopsBlob, await sha256Hex(png));
  assert.deepEqual(await readProjectMeta(root), meta);
  assert.deepEqual(await classifyFolder(root), { status: 'project', meta });
  const snapshot = await readProjectSnapshot(root);
  assert.deepEqual(snapshot.meta, meta);
  assert.deepEqual({ ...snapshot.files }, files());
  assert.deepEqual([...snapshot.folders].sort(), ['empty', 'images']);
  assert.deepEqual(snapshot.values, { title: 'Hi' });
  assert.equal(snapshot.conversations.projectId, 'p-1');
  assert.deepEqual(snapshot.conversations.threads.map(thread => [thread.id, thread.revision]), [['thread-one', 1], ['thread-two', 1]]);
  assert.deepEqual(snapshot.conversations.runs.map(run => run.id), ['run-one', 'run-two', 'run-three']);
  assert.deepEqual(snapshot.conversations.runs[0].base.files['image.png'], new Uint8Array([0, 128, 255]));
  assert.deepEqual(await threadFiles(root), ['thread-one.json', 'thread-two.json']);
});

test('createProjectInRoot without values, history or brief writes only files and project.json', async () => {
  const root = new MemoryDirectoryHandle('plain');
  const meta = await createProjectInRoot(root, { kind: 'template', name: 'Plain', files: { 'index.tpl': 'x' } });
  assert.equal(typeof meta.projectId, 'string'); assert.equal(meta.pendingAi, undefined); assert.equal(meta.sourceTemplateId, undefined);
  assert.deepEqual((await listDirectory(root, '.trafficops')).map(entry => entry.name), ['project.json']);
  const snapshot = await readProjectSnapshot(root);
  assert.deepEqual(snapshot.values, {});
  assert.deepEqual(snapshot.conversations.threads, []);
});

test('a project created from a user template records sourceTemplateId in project.json; one without it records none', async () => {
  const root = new MemoryDirectoryHandle('from-template'), plain = new MemoryDirectoryHandle('plain');
  const meta = await createProjectInRoot(root, { projectId: 'landing-1', kind: 'landing', name: 'From template', files: { 'index.tpl': 'x' }, sourceTemplateId: 'template-7' });
  assert.equal(meta.sourceTemplateId, 'template-7');
  assert.equal(JSON.parse(await readText(root, META)).sourceTemplateId, 'template-7');
  assert.equal((await readProjectMeta(root)).sourceTemplateId, 'template-7');
  assert.equal((await readProjectSnapshot(root)).meta.sourceTemplateId, 'template-7');
  await createProjectInRoot(plain, { projectId: 'landing-2', kind: 'landing', name: 'Plain', files: { 'index.tpl': 'x' } });
  assert.equal(Object.hasOwn(JSON.parse(await readText(plain, META)), 'sourceTemplateId'), false);
  await assert.rejects(createProjectInRoot(new MemoryDirectoryHandle('bad'), { kind: 'landing', name: 'Bad', files: { 'index.tpl': 'x' }, sourceTemplateId: '' }), /source template ID/);
});

test('createProjectInRoot rejects history of another project before writing anything', async () => {
  const root = new MemoryDirectoryHandle('x');
  await assert.rejects(create(root, { conversations: conversation('someone-else') }), /different project/);
  assert.deepEqual(await listDirectory(root, ''), []);
});

// Patches a directory of `root` when it is first opened, so the destination itself starts empty.
function onDirectory(directory, [name, ...rest], patch) {
  const get = directory.getDirectoryHandle.bind(directory);
  let patched = false;
  directory.getDirectoryHandle = async (child, options) => {
    const handle = await get(child, options);
    if (child === name && !patched) { patched = true; if (rest.length) onDirectory(handle, rest, patch); else patch(handle); }
    return handle;
  };
  return directory;
}

test('createProjectInRoot validates the brief before writing anything', async () => {
  const root = new MemoryDirectoryHandle('x');
  await assert.rejects(create(root, { brief: { ...brief, attachments: [{ ...brief.attachments[0], dataUrl: 'data:image/png;base64,AAAA' }] } }), error => error?.code === 'validation');
  await assert.rejects(create(root, { brief: { ...brief, prompt: 'x'.repeat(6001) } }), error => error?.code === 'validation');
  assert.deepEqual(await listDirectory(root, ''), []);
});

test('createProjectInRoot needs an empty destination unless allowExistingFiles; a project is never overwritten', async () => {
  const busy = new MemoryDirectoryHandle('busy', { 'notes.txt': 'mine', '.DS_Store': 'x' });
  await assert.rejects(create(busy), conflict);
  assert.deepEqual((await listDirectory(busy, '')).map(entry => entry.name).sort(), ['.DS_Store', 'notes.txt']);
  const clutter = new MemoryDirectoryHandle('clutter', { '.DS_Store': 'x' });
  assert.equal((await create(clutter)).projectId, 'p-1');
  const allowed = new MemoryDirectoryHandle('allowed', { 'notes.txt': 'mine' });
  await create(allowed, { allowExistingFiles: true });
  assert.equal(await readText(allowed, 'notes.txt'), 'mine');
  await assert.rejects(create(allowed, { allowExistingFiles: true }), conflict);
});

test('create order: a failed history write leaves no project.json', async () => {
  const root = onDirectory(new MemoryDirectoryHandle('x'), ['.trafficops', 'conversations'], conversations => { conversations.getFileHandle = async () => { throw new Error('Disk disconnected'); }; });
  await assert.rejects(create(root), /Disk disconnected/);
  assert.equal(await readText(root, 'index.tpl'), 'hello');
  assert.equal(await readText(root, '.trafficops/values.json'), JSON.stringify({ title: 'Hi' }, null, 2) + '\n');
  assert.equal(await fileAt(root, META), null);
  assert.deepEqual(await classifyFolder(root), { status: 'files' });
});

test('create order: a failure after the history write (the brief blobs) still leaves no project.json', async () => {
  const sha = await sha256Hex(png);
  const root = onDirectory(new MemoryDirectoryHandle('x'), ['.trafficops', 'conversations', 'blobs'], blobs => {
    const getFileHandle = blobs.getFileHandle.bind(blobs);
    blobs.getFileHandle = async (name, options) => { if (name === sha && options?.create) throw new Error('Quota hit'); return getFileHandle(name, options); };
  });
  await assert.rejects(create(root), /Quota hit/);
  assert.deepEqual(await threadFiles(root), ['thread-one.json', 'thread-two.json']);
  assert.equal(await fileAt(root, META), null);
});

test('adoptFolder gives a folder of files an identity; an existing project is not adopted twice', async () => {
  const root = new MemoryDirectoryHandle('my-site', { 'index.tpl': 'hello' });
  const meta = await adoptFolder(root, { name: 'My site' });
  assert.equal(meta.kind, 'landing'); assert.equal(meta.name, 'My site'); assert.equal(typeof meta.projectId, 'string');
  assert.deepEqual(await readProjectMeta(root), meta);
  await assert.rejects(adoptFolder(root, { name: 'Again' }), conflict);
  assert.equal((await adoptFolder(new MemoryDirectoryHandle('folder-name', { 'index.tpl': 'x' }))).name, 'folder-name');
  await assert.rejects(adoptFolder(new MemoryDirectoryHandle('broken', { 'index.tpl': new Uint8Array([0xff]) })), /UTF-8/);
});

test('listKnownProjects merges recent folders and OPFS roots, deduplicated by projectId with recent winning', async t => {
  installMemoryIndexedDB(t);
  const storage = (() => { const root = new MemoryDirectoryHandle('opfs', {}, { now: () => 500 }); return { getDirectory: async () => root }; })();
  const folder = new MemoryDirectoryHandle('folder');
  await createProjectMeta(folder, { schema: 1, projectId: 'p-a', kind: 'landing', name: 'Folder A' });
  folder.permission = 'prompt';
  await rememberRecent({ projectId: 'p-a', name: 'Folder A', kind: 'landing', handle: folder, lastOpenedAt: 100 });
  const duplicate = await createOpfsRoot('p-a', { storage });
  await createProjectMeta(duplicate, { schema: 1, projectId: 'p-a', kind: 'landing', name: 'OPFS A' });
  const opfsProject = await createOpfsRoot('p-b', { storage });
  await createProjectMeta(opfsProject, { schema: 1, projectId: 'p-b', kind: 'template', name: 'OPFS B' });
  await createOpfsRoot('p-unfinished', { storage });
  const known = await listKnownProjects({ storage });
  assert.deepEqual(known, [
    { projectId: 'p-b', name: 'OPFS B', kind: 'template', source: 'opfs', handle: opfsProject, folderName: 'p-b', lastOpenedAt: 500, access: 'granted' },
    { projectId: 'p-a', name: 'Folder A', kind: 'landing', source: 'folder', handle: folder, lastOpenedAt: 100, access: 'prompt' },
  ]);
  assert.deepEqual((await listKnownProjects({ storage: undefined })).map(entry => entry.projectId), ['p-a']);
  // A rekeyed OPFS project keeps its folder: the entry names it, so it can still be deleted.
  const moved = await createOpfsRoot('p-c', { storage });
  await createProjectInRoot(moved, { projectId: 'p-c', name: 'Moved', files: { 'index.tpl': 'x' } });
  const rekeyed = await makeIndependent(moved);
  const entry = (await listKnownProjects({ storage })).find(item => item.projectId === rekeyed.projectId);
  assert.equal(entry.folderName, 'p-c'); assert.equal(entry.handle, moved);
  await deleteOpfsRoot(entry.folderName, { storage });
  assert.equal((await listKnownProjects({ storage })).some(item => item.projectId === rekeyed.projectId), false);
});

test('an OPFS project opened recently is listed by its open time; its project.json time is the floor', async t => {
  installMemoryIndexedDB(t);
  const storage = (() => { const root = new MemoryDirectoryHandle('opfs', {}, { now: () => 500 }); return { getDirectory: async () => root }; })();
  const items = new Map(), localStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
  const folder = new MemoryDirectoryHandle('folder');
  await createProjectMeta(folder, { schema: 1, projectId: 'p-folder', kind: 'landing', name: 'Folder' });
  await rememberRecent({ projectId: 'p-folder', name: 'Folder', kind: 'landing', handle: folder, lastOpenedAt: 1000 });
  for (const id of ['p-old', 'p-new']) await createProjectMeta(await createOpfsRoot(id, { storage }), { schema: 1, projectId: id, kind: 'landing', name: id });
  const order = async () => (await listKnownProjects({ storage, localStorage })).map(entry => [entry.projectId, entry.lastOpenedAt]);
  const before = await order();
  assert.deepEqual(before[0], ['p-folder', 1000]); assert.deepEqual(before.slice(1).map(([, time]) => time), [500, 500]);
  rememberOpfsOpened('p-new', { storage: localStorage, now: () => 2000 });
  rememberOpfsOpened('p-old', { storage: localStorage, now: () => 100 });
  assert.deepEqual(await order(), [['p-new', 2000], ['p-folder', 1000], ['p-old', 500]]);
});

test('remapConversation gives every internal id a new value, keeps references consistent and interrupts runs', () => {
  let next = 0;
  const source = conversation('one');
  const copy = remapConversation(source, 'copy', { newId: () => `copy-${++next}` });
  assert.equal(copy.projectId, 'copy'); assert.equal(copy.revision, 0);
  const [thread] = copy.threads, [run, queued, done] = copy.runs;
  assert.notEqual(thread.id, 'thread-one'); assert.notEqual(copy.threads[1].id, 'thread-two');
  assert.equal(run.threadId, thread.id); assert.equal(run.messageId, thread.messages[0].id); assert.equal(thread.messages[0].runId, run.id);
  assert.equal(done.threadId, copy.threads[1].id);
  assert.equal(run.state, 'interrupted'); assert.equal(run.owner, undefined); assert.equal(queued.state, 'interrupted'); assert.equal(done.state, 'completed');
  assert.equal(run.projectId, 'copy'); assert.equal(run.base.projectId, 'copy');
  assert.equal(queued.rebaseFrom, run.id);
  assert.deepEqual(run.base.translations, source.runs[0].base.translations);
  run.base.files['image.png'][0] = 10;
  assert.equal(source.runs[0].base.files['image.png'][0], 0);
  // Stored dialogue revisions do not carry over: the copy is new history.
  const stored = { ...source, threads: source.threads.map(item => ({ ...item, revision: 4 })) };
  assert.deepEqual(remapConversation(stored, 'copy').threads.map(item => item.revision), [undefined, undefined]);
});

test('interruptImportedRuns keeps ids and interrupts running and queued runs', () => {
  const result = interruptImportedRuns(conversation('one'));
  assert.deepEqual(result.runs.map(run => [run.id, run.state, run.owner]), [['run-one', 'interrupted', undefined], ['run-two', 'interrupted', undefined], ['run-three', 'completed', undefined]]);
  assert.equal(result.threads[0].id, 'thread-one');
});

test('makeIndependent gives the folder a new projectId and remaps every thread and run id', async () => {
  const root = new MemoryDirectoryHandle('copy-of-bakery');
  await create(root);
  const names = [], locks = { request: (name, fn) => { names.push(name); return fn(); } };
  const meta = await makeIndependent(root, { locks });
  // The rewrite runs under the old id's conversation lock and the rekey under its meta lock, never the new id's.
  assert.ok(names.includes('trafficops-conversations:p-1')); assert.ok(names.includes('trafficops-project-meta:p-1'));
  assert.deepEqual(names.filter(name => !name.endsWith(':p-1')), []);
  assert.notEqual(meta.projectId, 'p-1');
  assert.equal(meta.name, 'Bakery');
  assert.equal(meta.pendingAi.id, 'brief-1');
  assert.deepEqual(await readProjectMeta(root), meta);
  const { conversations } = await readProjectSnapshot(root);
  assert.equal(conversations.projectId, meta.projectId);
  const threadIds = conversations.threads.map(thread => thread.id), runIds = conversations.runs.map(run => run.id);
  assert.equal(threadIds.length, 2); assert.equal(runIds.length, 3);
  for (const id of ['thread-one', 'thread-two']) assert.equal(threadIds.includes(id), false);
  for (const id of ['run-one', 'run-two', 'run-three']) assert.equal(runIds.includes(id), false);
  assert.equal(conversations.threads[0].messages[0].id === 'message-one', false);
  assert.equal(conversations.runs[0].threadId, threadIds[0]);
  assert.equal(conversations.threads[0].messages[0].runId, runIds[0]);
  assert.equal(conversations.runs[1].rebaseFrom, runIds[0]);
  assert.deepEqual(conversations.runs.map(run => run.state), ['interrupted', 'interrupted', 'completed']);
  assert.equal(conversations.runs[0].owner, undefined);
  assert.equal(conversations.runs[0].projectId, meta.projectId);
  assert.deepEqual(conversations.runs[0].base.files['image.png'], new Uint8Array([0, 128, 255]));
  assert.deepEqual(await threadFiles(root), threadIds.map(id => `${id}.json`).sort());
});

test('copyProject copies files, values and remapped history to a new identity, without the brief', async () => {
  const source = new MemoryDirectoryHandle('bakery'), destination = new MemoryDirectoryHandle('bakery-copy');
  await create(source);
  const before = await readProjectSnapshot(source);
  const meta = await copyProject(source, destination, { name: 'Bakery copy' });
  assert.notEqual(meta.projectId, 'p-1');
  assert.equal(meta.name, 'Bakery copy'); assert.equal(meta.kind, 'landing'); assert.equal(meta.sourceTemplateId, 'tpl-1');
  assert.equal(meta.pendingAi, undefined);
  const copy = await readProjectSnapshot(destination);
  assert.deepEqual(copy.meta, meta);
  assert.deepEqual(copy.files, before.files);
  assert.deepEqual([...copy.folders].sort(), [...before.folders].sort());
  assert.deepEqual(copy.values, before.values);
  assert.equal(copy.conversations.projectId, meta.projectId);
  assert.deepEqual(copy.conversations.threads.map(thread => thread.title), ['A', 'B']);
  assert.equal(copy.conversations.threads.some(thread => ['thread-one', 'thread-two'].includes(thread.id)), false);
  assert.deepEqual(copy.conversations.runs.map(run => run.state), ['interrupted', 'interrupted', 'completed']);
  assert.equal((await readFile(destination, `${DIR}/blobs/${await sha256Hex(png)}`)), null);
  assert.deepEqual(await readProjectSnapshot(source), before);
  assert.equal((await copyProject(source, new MemoryDirectoryHandle('default-name'))).name, 'Bakery');
  await assert.rejects(copyProject(source, destination), conflict);
  const occupied = new MemoryDirectoryHandle('occupied', { 'keep.txt': 'mine' });
  await assert.rejects(copyProject(source, occupied), conflict);
  assert.deepEqual((await listDirectory(occupied, '')).map(item => item.name), ['keep.txt']);
});
