import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { createZip, readZipProject } from '@trafficops/template-editor-core';
import { createStudioProject } from '../src/studio-library.js';
import { readPortableDirectory, saveProjectToDirectory, portableProjectRecord, projectMetadata } from '../src/portable-project.js';
import { rememberDirectoryProject, readDirectoryProject } from '../src/directory-projects.js';
import { createStudioHost } from '../src/hosts/StudioHost.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';
import { installConversationStorage } from './support/conversation-idb.js';

const project = () => createStudioProject({ kind: 'landing', name: 'One project', files: { 'index.tpl': '@layout\nHello\n@endlayout', 'photo.png': new Uint8Array([0, 127, 255]) }, folders: ['empty'], settings: { title: 'Saved' }, appliedAiRuns: ['applied-run'] }, { id: 'project-one' });
const history = () => ({ schema: 1, projectId: 'project-one', revision: 2, threads: [{ id: 't-one', messages: [{ id: 'm-one', role: 'user', text: 'Change this', runId: 'r-one' }] }], runs: [{ id: 'r-one', threadId: 't-one', state: 'running', base: { files: project().files } }] });

test('source ZIP retains identity/kind/name/history/bytes; generated ZIP excludes all sidecars', () => {
  const record = project(), metadata = projectMetadata(record);
  const bytes = createZip(record.files, { directories: record.folders, settings: record.settings, metadata, conversations: history() });
  const imported = readZipProject(bytes);
  assert.equal(imported.metadata.projectId, record.id); assert.equal(imported.metadata.kind, 'landing');
  assert.deepEqual(imported.metadata.appliedAiRuns, ['applied-run']);
  assert.deepEqual(imported.conversations.runs[0].base.files['photo.png'], record.files['photo.png']);
  assert.deepEqual({ ...imported.files }, record.files);
  const output = unzipSync(createZip({ 'index.html': 'Hello', 'photo.png': record.files['photo.png'] }, { generated: true, metadata, conversations: history() }));
  assert.equal(Object.keys(output).some(path => path.startsWith('.trafficops')), false);
  const resumed = portableProjectRecord(imported);
  assert.equal(resumed.record.id, record.id); assert.equal(resumed.record.kind, 'landing');
  assert.equal(resumed.conversations.runs[0].state, 'interrupted');
  const copied = portableProjectRecord(imported, { copy: true, id: 'copy-one' });
  assert.equal(copied.record.id, 'copy-one'); assert.notEqual(copied.conversations.threads[0].id, 't-one');
  assert.equal(copied.record.appliedAiRuns, undefined);
});

test('metadata allowlist rejects hidden arbitrary files, malformed identity and mismatched history', () => {
  for (const path of ['.trafficops/key.json', '.trafficops/nested/secret.json', '.git/config']) assert.throws(() => readZipProject(zipSync({ 'index.tpl': strToU8('Hello'), [path]: strToU8('{}') })), /Unsafe/);
  assert.throws(() => createZip(project().files, { metadata: { ...projectMetadata(project()), schema: 99 } }), /metadata/);
  assert.throws(() => createZip(project().files, { metadata: projectMetadata(project()), conversations: { ...history(), projectId: 'different' } }), /different/);
  const legacy = readZipProject(createZip(project().files, { settings: project().settings }));
  assert.equal(legacy.metadata, undefined); assert.equal(portableProjectRecord(legacy).record.kind, 'template');
});

test('AI creation records accept validated PDF/text references while retaining image asset intent', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n%%EOF');
  const attachments = [{ id: 'reference-pdf', mime: 'application/pdf', name: 'Reference.pdf', dataUrl: `data:application/pdf;base64,${btoa(String.fromCharCode(...bytes))}`, useOnPage: true },
    { id: 'reference-text', mime: 'text/plain', name: 'Brief.txt', text: 'Source material', useOnPage: true }];
  const stored = createStudioProject({ ...project(), aiAttachments: attachments });
  assert.equal(stored.aiAttachments[0].mime, 'application/pdf'); assert.equal(stored.aiAttachments[0].useOnPage, false);
  assert.equal(stored.aiAttachments[1].text, 'Source material');
  assert.throws(() => createStudioProject({ ...project(), aiAttachments: [{ ...attachments[0], dataUrl: 'data:application/pdf;base64,YmFk' }] }), /PDF/);
});

test('save to empty folder and reopen preserve one logical identity and dialogue history', async () => {
  const directory = new MemoryDirectoryHandle('campaign'), record = project();
  const result = await saveProjectToDirectory({ record, handle: directory, conversations: history() });
  assert.equal(result.metadata.projectId, record.id); assert.match(result.metadata.contentHash, /^[a-f0-9]{64}$/);
  const reopened = await readPortableDirectory(directory);
  assert.equal(reopened.metadata.name, record.name); assert.equal(reopened.transfer.state, 'complete');
  assert.deepEqual({ ...reopened.files }, record.files); assert.deepEqual(reopened.settings, record.settings);
  assert.equal(reopened.conversations.runs[0].id, 'r-one');
  const remembered = await rememberDirectoryProject(directory, []);
  assert.equal(remembered.id, record.id); assert.equal(remembered.projectId, record.id);
  assert.deepEqual(Object.keys((await readDirectoryProject(directory)).files).sort(), ['index.tpl', 'photo.png']);
});

test('unreviewed nonempty folders and stale reviewed snapshots are untouched', async () => {
  const directory = new MemoryDirectoryHandle('unknown', { 'index.tpl': 'Their file' });
  await assert.rejects(saveProjectToDirectory({ record: project(), handle: directory }), /not empty/);
  assert.equal(directory.children.has('.trafficops'), false);
  const before = await readPortableDirectory(directory);
  directory.children.get('index.tpl').value = strToU8('External edit');
  await assert.rejects(saveProjectToDirectory({ record: project(), handle: directory, expectedSnapshot: before }), /changed before/);
  assert.equal(directory.children.has('.trafficops'), false);
});

test('interrupted transfer retains source and journal, and retries only matching bytes', async () => {
  const directory = new MemoryDirectoryHandle('campaign'), record = project();
  const getFileHandle = directory.getFileHandle.bind(directory);
  let fail = true;
  directory.getFileHandle = async (name, options) => {
    if (name === 'photo.png' && options?.create && fail) { fail = false; throw new Error('Disk disconnected'); }
    return getFileHandle(name, options);
  };
  await assert.rejects(saveProjectToDirectory({ record, handle: directory }), /disconnected/);
  assert.equal((await readPortableDirectory(directory)).transfer.state, 'writing');
  assert.deepEqual(record.files['photo.png'], new Uint8Array([0, 127, 255]));
  const result = await saveProjectToDirectory({ record, handle: directory });
  assert.equal(result.metadata.projectId, record.id);
  assert.equal((await readPortableDirectory(directory)).transfer.state, 'complete');
});

test('folder host opens an empty folder without disk writes and honors persistent identity', async t => {
  installConversationStorage(t);
  const empty = new MemoryDirectoryHandle('empty');
  const emptyHost = createStudioHost({ directory: empty, projectId: 'empty-one' });
  const state = await emptyHost.project.open();
  assert.ok(state.files['index.tpl']); assert.equal(empty.children.size, 0);
  await emptyHost.conversations.save({ schema: 1, projectId: 'empty-one', revision: 0, threads: [{ id: 'empty-chat', messages: [] }], runs: [] });
  const initialized = await emptyHost.project.save(state);
  assert.equal(initialized.status, 'Saved to folder');
  assert.ok(empty.children.has('index.tpl'));
  const directory = new MemoryDirectoryHandle('one');
  await saveProjectToDirectory({ record: project(), handle: directory });
  const host = createStudioHost({ directory });
  const opened = await host.project.open();
  assert.equal(opened.projectId, 'project-one'); assert.equal(opened.name, 'One project');
  assert.deepEqual(opened.appliedAiRuns, ['applied-run']);
  await host.conversations.save({ ...history(), revision: 0 });
  const saved = await host.project.save({ ...opened, files: { ...opened.files, 'styles.css': 'body{}' } });
  assert.equal(saved.projectId, opened.projectId);
  assert.ok((await readPortableDirectory(directory)).files['styles.css']);
});

test('folder content failure is retryable without overwriting external changes', async t => {
  installConversationStorage(t);
  const directory = new MemoryDirectoryHandle('one');
  await saveProjectToDirectory({ record: project(), handle: directory });
  const host = createStudioHost({ directory });
  const opened = await host.project.open();
  const photo = directory.children.get('photo.png'), original = photo.createWritable.bind(photo);
  let fail = true;
  photo.createWritable = async () => { if (fail) { fail = false; throw new Error('Disk write interrupted'); } return original(); };
  const candidate = { ...opened, files: { ...opened.files, 'index.tpl': '@layout\nChanged\n@endlayout', 'photo.png': new Uint8Array([9]) } };
  await assert.rejects(host.project.save(candidate), /interrupted/);
  const retried = await host.project.save(candidate);
  assert.equal(retried.files['index.tpl'], candidate.files['index.tpl']);
  assert.deepEqual((await readPortableDirectory(directory)).files['photo.png'], new Uint8Array([9]));
});

test('editor and conversation concurrent folder opening share the same save revision', async t => {
  installConversationStorage(t);
  const directory = new MemoryDirectoryHandle('concurrent');
  await saveProjectToDirectory({ record: project(), handle: directory });
  const host = createStudioHost({ directory, projectId: 'project-one' });
  const [state] = await Promise.all([host.project.open(), host.conversations.load()]);
  const saved = await host.project.save({ ...state, translations: { en: { title: 'Concurrent open saved' } } });
  assert.equal(saved.translations.en.title, 'Concurrent open saved');
  assert.equal((await readPortableDirectory(directory)).settings.title, 'Concurrent open saved');
});
