import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationDocumentFromFiles, fromBase64, readZipProject, runHostConformance, toBase64 } from '@trafficops/template-editor-core';
import { unzipSync } from 'fflate';
import { createFolderHost } from '../src/hosts/FolderHost.js';
import { createStudioAiPort } from '../src/hosts/StudioAiPort.js';
import { readProjectMeta, readValues, storePendingAi } from '../src/storage/project-meta.js';
import { createProjectInRoot } from '../src/storage/project-root.js';
import { listDirectory, readText, removePath, writeFile } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const knownIds = ['safe-html-v1', 'fast-landings-v1'];
const source = '@layout\n<h1>Local project</h1>\n@endlayout';
const conflict = error => error?.code === 'conflict';
const ai = () => createStudioAiPort({ storage: { load: async () => ({ apiKey: '', model: '', imageModel: '' }), save: async value => value, remove: async () => {} } });
const png = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const brief = { id: 'brief-1', prompt: 'A bakery', mode: 'create', generateImages: true, attachments: [{ id: 'att-1', name: 'logo.png', mime: 'image/png', dataUrl: `data:image/png;base64,${toBase64(png)}`, useOnPage: true }] };

async function project(extra = {}) {
  const root = new MemoryDirectoryHandle('bakery');
  const meta = await createProjectInRoot(root, { projectId: 'p-1', kind: 'landing', name: 'Bakery', files: { 'index.tpl': source }, ...extra });
  return { root, meta };
}
const host = (root, meta, options = {}) => createFolderHost({ root, meta, ...options });

test('FolderHost conforms over a project folder, with and without AI', async () => {
  for (const withAi of [false, true]) {
    const { root, meta } = await project();
    const result = await runHostConformance(() => host(root, meta, withAi ? { ai: ai() } : {}), { knownIds, faults: {
      validation: sample => sample.project.import(new Uint8Array([0, 1])),
      policy: async sample => sample.project.export(await sample.project.open(), { format: 'source', locale: 'en', history: { group: 'drafts', id: '1' } }),
    } });
    assert.ok(result.checks.includes('concurrency'));
    const sample = await host(root, meta, withAi ? { ai: ai() } : {});
    assert.deepEqual({ ...sample.capabilities }, { inlinePreview: true, preview: false, lifecycle: true, ai: withAi, locales: false, entrypoint: false, autosave: true, sourceExport: true, htmlExport: true });
    assert.equal(typeof sample.conversations.load, 'function');
    await sample.dispose();
  }
});

test('a saved project reopens in a fresh host with its files, values, name and revisions', async () => {
  const { root, meta } = await project();
  const first = await host(root, meta), opened = await first.project.open();
  assert.equal(opened.name, 'Bakery'); assert.equal(opened.projectId, 'p-1'); assert.equal(opened.contentRevision, 0);
  const saved = await first.project.save({ ...opened, name: 'Bakery & Co', files: { ...opened.files, 'images/cover.png': new Uint8Array([1, 2, 3]) }, folders: ['images', 'empty'], translations: { en: { title: 'Hi' } }, appliedAiRuns: ['run-1'] });
  assert.equal(saved.contentRevision, 1);
  await first.dispose();
  assert.deepEqual(await readValues(root), { title: 'Hi' });
  const disk = await readProjectMeta(root);
  assert.equal(disk.name, 'Bakery & Co'); assert.equal(disk.contentRevision, 1); assert.equal(disk.metadataRevision, 1); assert.deepEqual(disk.appliedAiRuns, ['run-1']);
  const second = await host(root, disk), reopened = await second.project.open();
  assert.equal(reopened.name, 'Bakery & Co'); assert.equal(reopened.contentRevision, 1); assert.deepEqual(reopened.appliedAiRuns, ['run-1']);
  assert.deepEqual({ ...reopened.files }, { 'index.tpl': source, 'images/cover.png': new Uint8Array([1, 2, 3]) });
  assert.deepEqual([...reopened.folders].sort(), ['empty', 'images']);
  assert.deepEqual(reopened.translations, { en: { title: 'Hi' } });
  // A rename alone keeps the content revision; clearing the values removes values.json.
  const renamed = await second.project.save({ ...reopened, name: 'Renamed' });
  assert.equal(renamed.contentRevision, 1); assert.equal((await readProjectMeta(root)).metadataRevision, 2);
  await second.project.save({ ...renamed, translations: { en: {} } });
  assert.equal(await readText(root, '.trafficops/values.json'), null);
  assert.equal((await readProjectMeta(root)).contentRevision, 2);
});

test('reopening an unchanged folder keeps the revision, so a concurrent reader never stales the editor', async () => {
  const { root, meta } = await project(), sample = await host(root, meta);
  const [left, right] = await Promise.all([sample.project.open(), sample.project.open()]);
  assert.equal(left.revision, right.revision);
  const again = await sample.project.open();
  assert.equal(again.revision, left.revision);
  await sample.project.save({ ...again, files: { ...again.files, 'styles.css': 'a' } });
  await writeFile(root, 'styles.css', 'external');
  const changed = await sample.project.open();
  assert.equal(changed.files['styles.css'], 'external');
});

test('an empty project folder opens with an in-memory starter and nothing is written until the first save', async () => {
  const root = new MemoryDirectoryHandle('empty');
  const meta = await createProjectInRoot(root, { projectId: 'p-empty', name: 'Empty' });
  const sample = await host(root, meta), opened = await sample.project.open();
  assert.ok(opened.files['index.tpl']);
  assert.deepEqual([...root.children.keys()], ['.trafficops']);
  assert.deepEqual((await listDirectory(root, '.trafficops')).map(entry => entry.name), ['project.json']);
  await sample.project.save(opened);
  assert.ok(root.children.has('index.tpl'));
  assert.equal((await readProjectMeta(root)).contentRevision, 1);
});

test('a folder that belongs to another project is rejected on open', async () => {
  const { root, meta } = await project();
  const sample = await host(root, { ...meta, projectId: 'p-other' });
  await assert.rejects(sample.project.open(), conflict);
  const missing = await host(new MemoryDirectoryHandle('none', { 'index.tpl': source }), meta);
  await assert.rejects(missing.project.open(), conflict);
});

test('files, values and project.json changed outside Studio make the save a conflict and keep the disk', async () => {
  const { root, meta } = await project({ values: { title: 'Hi' } });
  const cases = [
    ['file', () => writeFile(root, 'index.tpl', 'external')],
    ['values', () => writeFile(root, '.trafficops/values.json', JSON.stringify({ title: 'external' }))],
    ['meta name', async () => writeFile(root, '.trafficops/project.json', JSON.stringify({ ...await readProjectMeta(root), name: 'External' }))],
    ['meta identity', async () => writeFile(root, '.trafficops/project.json', JSON.stringify({ ...await readProjectMeta(root), projectId: 'p-other' }))],
  ];
  for (const [label, change] of cases) {
    const sample = await host(root, meta), opened = await sample.project.open();
    const before = await readText(root, '.trafficops/project.json');
    await change();
    const changed = await readText(root, '.trafficops/project.json'), changedSource = await readText(root, 'index.tpl');
    await assert.rejects(sample.project.save({ ...opened, files: { ...opened.files, 'index.tpl': 'local' }, translations: { en: { title: 'local' } } }), conflict, label);
    assert.equal(await readText(root, 'index.tpl'), changedSource, label);
    assert.equal(await readText(root, '.trafficops/project.json'), changed, label);
    // Restore the folder for the next case.
    await writeFile(root, 'index.tpl', source); await writeFile(root, '.trafficops/values.json', JSON.stringify({ title: 'Hi' })); await writeFile(root, '.trafficops/project.json', before);
  }
});

test('a pending AI brief becomes one auto-start initial request that only one host can claim', async () => {
  const { root, meta } = await project({ brief });
  assert.equal(meta.pendingAi.id, 'brief-1');
  const [left, right] = await Promise.all([host(root, meta, { ai: ai() }), host(root, meta, { ai: ai() })]);
  for (const sample of [left, right]) {
    const initial = sample.ai.initialRequest;
    assert.equal(initial.id, 'brief-1'); assert.equal(initial.prompt, 'A bakery'); assert.equal(initial.mode, 'create'); assert.equal(initial.autoStart, true); assert.equal(initial.generateImages, true);
    assert.deepEqual(initial.attachments, [{ id: 'att-1', name: 'logo.png', mime: 'image/png', dataUrl: brief.attachments[0].dataUrl, useOnPage: true }]);
  }
  assert.deepEqual((await Promise.all([left.ai.initialRequest.claim(), right.ai.initialRequest.claim()])).sort(), [false, true]);
  assert.equal((await readProjectMeta(root)).pendingAi, undefined);
  // The claim edits project.json, but not as a change outside Studio.
  const opened = await left.project.open();
  await left.project.save({ ...opened, files: { ...opened.files, 'styles.css': 'body{}' } });
  const later = await host(root, await readProjectMeta(root), { ai: ai() });
  assert.equal(later.ai.initialRequest, undefined);
  // The AI port passes through untouched; a brief without AI is ignored.
  assert.equal(typeof later.ai.begin, 'function'); assert.equal(later.ai.settings.owner, 'user');
  await storePendingAi(root, 'p-1', { ...brief, id: 'brief-2', mode: 'something' });
  assert.equal((await host(root, meta, { ai: ai() })).ai.initialRequest.mode, 'create');
  assert.equal(Object.hasOwn(await host(root, meta), 'ai'), false);
});

test('source export carries the store\'s dialogue files with shared blobs once and imports back', async () => {
  const { root, meta } = await project({ values: { title: 'Hi' } });
  const sample = await host(root, meta, { ai: ai() }), opened = await sample.project.open(), logo = brief.attachments[0];
  const loaded = await sample.conversations.load();
  // The same attachment in two dialogues: one blob in the folder and one in the ZIP.
  const thread = (id, title) => ({ id, title, messages: [{ id: `${id}-message`, role: 'user', parts: [{ type: 'text', text: title }], attachments: [{ id: logo.id, name: logo.name, mime: logo.mime, dataUrl: logo.dataUrl }] }] });
  await sample.conversations.save({ ...loaded, threads: [thread('thread-one', 'A'), thread('thread-two', 'B')], runs: [] }, { expectedRevision: loaded.revision });
  const archive = await sample.project.export(opened, { format: 'source', locale: 'en' });
  assert.equal(archive.name, 'Bakery-source.zip'); assert.equal(archive.mime, 'application/zip');
  const entries = Object.keys(unzipSync(archive.bytes));
  assert.equal(entries.filter(name => name.startsWith('.trafficops/conversations/blobs/') && !name.endsWith('/')).length, 1);
  const read = readZipProject(archive.bytes, { history: true });
  assert.equal(read.metadata.projectId, 'p-1'); assert.equal(read.metadata.name, 'Bakery'); assert.deepEqual(read.settings, { title: 'Hi' });
  assert.deepEqual(read.conversationFiles.threads.map(item => item.id).sort(), ['thread-one', 'thread-two']);
  const imported = await sample.project.import(archive.bytes);
  assert.equal(imported.conversationFiles.blobs.size, 1);
  const document = await conversationDocumentFromFiles(imported.conversationFiles, 'p-1');
  assert.deepEqual(document.threads.map(item => [item.id, item.messages[0].attachments[0].dataUrl]).sort(), [['thread-one', logo.dataUrl], ['thread-two', logo.dataUrl]]);
  assert.deepEqual({ ...imported.files }, { 'index.tpl': source });
  const plain = await sample.project.export(opened, { format: 'source', locale: 'en', includeHistory: false });
  assert.equal(Object.keys(unzipSync(plain.bytes)).some(name => name.startsWith('.trafficops/conversations')), false);
  assert.equal(readZipProject(plain.bytes).metadata.projectId, 'p-1');
  const html = await sample.project.export(opened, { format: 'html', locale: 'en' });
  assert.ok(Object.hasOwn(unzipSync(html.bytes), 'index.html'));
  await sample.dispose();
});

test('save as template writes a new template project through the App-provided root and leaves the source alone', async () => {
  const { root, meta } = await project({ values: { title: 'Hi' } });
  const created = [], requested = [], target = new MemoryDirectoryHandle('template');
  const createProjectRoot = options => { requested.push(options); return Promise.resolve(target); };
  const sample = await host(root, meta, { createProjectRoot, onProjectCreated: (value, handle) => created.push([value, handle]) });
  const opened = await sample.project.open();
  assert.deepEqual(opened.actions.map(action => action.id), ['save-template']);
  const draft = { ...opened, files: { ...opened.files, 'styles.css': 'unsaved' }, translations: { en: { title: 'Draft' } } };
  await assert.rejects(sample.lifecycle.run('save-template', draft, { locale: 'en', inputValue: ' ' }), error => error.code === 'validation');
  assert.equal(requested.length, 0);
  const result = await sample.lifecycle.run('save-template', draft, { locale: 'en', inputValue: 'Bakery template' });
  assert.equal(result.persisted, false); assert.equal(result.notice, 'Template saved.');
  assert.deepEqual(result.state.files, draft.files);
  assert.deepEqual(requested, [{ kind: 'template', name: 'Bakery template' }]);
  assert.equal(created.length, 1); assert.equal(created[0][1], target);
  const templateMeta = await readProjectMeta(target);
  assert.deepEqual(created[0][0], templateMeta);
  assert.equal(templateMeta.kind, 'template'); assert.equal(templateMeta.name, 'Bakery template'); assert.notEqual(templateMeta.projectId, 'p-1');
  assert.equal(await readText(target, 'styles.css'), 'unsaved');
  assert.deepEqual(await readValues(target), { title: 'Draft' });
  assert.deepEqual((await listDirectory(target, '.trafficops')).map(entry => entry.name).sort(), ['project.json', 'values.json']);
  assert.equal(await readText(root, 'styles.css'), null);
  // The action must start the folder request before any await (user activation).
  let synchronous = false;
  const eager = await host(root, meta, { createProjectRoot: () => { synchronous = true; return Promise.resolve(null); } });
  const pending = eager.lifecycle.run('save-template', opened, { locale: 'en', inputValue: 'Later' });
  assert.equal(synchronous, true);
  assert.deepEqual(await pending, { state: opened, persisted: false, notice: '' });
  // A dismissed folder picker (AbortError) cancels silently too.
  const dismissed = await host(root, meta, { createProjectRoot: async () => { throw new DOMException('The user aborted a request.', 'AbortError'); } });
  assert.deepEqual(await dismissed.lifecycle.run('save-template', opened, { locale: 'en', inputValue: 'Later' }), { state: opened, persisted: false, notice: '' });
  // Templates do not offer the action.
  const template = await host(target, templateMeta, { createProjectRoot }), templateState = await template.project.open();
  assert.deepEqual(templateState.actions, []);
  await assert.rejects(template.lifecycle.run('save-template', templateState, { locale: 'en', inputValue: 'Again' }), error => error.code === 'policy');
});

test('folders are normalized on save, so an unlisted parent folder never stales the revision or conflicts', async () => {
  const { root, meta } = await project(), sample = await host(root, meta), opened = await sample.project.open();
  const saved = await sample.project.save({ ...opened, files: { ...opened.files, 'images/deep/a.png': new Uint8Array([1]) }, folders: [] });
  assert.deepEqual(saved.folders, ['images', 'images/deep']);
  const reopened = await sample.project.open();
  assert.equal(reopened.revision, saved.revision);
  const next = await sample.project.save({ ...reopened, files: { ...reopened.files, 'styles.css': 'b' } });
  assert.equal(next.files['styles.css'], 'b');
});

test('a save that fails after writing rebuilds from disk on the next open', async () => {
  for (const failing of ['values.json', 'project.json']) {
    const { root, meta } = await project({ values: { title: 'Hi' } }), sample = await host(root, meta), opened = await sample.project.open();
    const file = root.children.get('.trafficops').children.get(failing);
    file.createWritable = async () => { throw new Error('Disk failure'); };
    await assert.rejects(sample.project.save({ ...opened, files: { ...opened.files, 'styles.css': 'written' }, translations: { en: { title: 'New' } } }), /Disk failure/, failing);
    delete file.createWritable;
    const reopened = await sample.project.open();
    assert.notEqual(reopened.revision, opened.revision, failing);
    assert.equal(reopened.files['styles.css'], 'written', failing);
    assert.deepEqual(reopened.translations.en, { title: failing === 'values.json' ? 'Hi' : 'New' }, failing);
    const saved = await sample.project.save({ ...reopened, translations: { en: { title: 'New' } } });
    assert.equal(saved.contentRevision, 1, failing);
    assert.equal((await readProjectMeta(root)).contentRevision, 1, failing);
  }
});

test('an AI brief that cannot be resolved is not started and the opened status says so', async t => {
  const warnings = [], warn = console.warn; console.warn = (...args) => warnings.push(args.join(' ')); t.after(() => { console.warn = warn; });
  const { root, meta } = await project({ brief });
  await removePath(root, `.trafficops/conversations/blobs/${meta.pendingAi.attachments[0].blob.$trafficopsBlob}`);
  const sample = await host(root, meta, { ai: ai() });
  assert.equal(sample.ai.initialRequest, undefined);
  assert.match((await sample.project.open()).status, /The saved AI request could not be started\./);
  assert.equal(warnings.length, 1);
});

test('history exports pack in the archive worker, store blobs uncompressed, and fail early when too large', async t => {
  const posted = [], self = globalThis.self;
  let current = null;
  globalThis.self = { postMessage: (data, transfer = []) => { const worker = current; queueMicrotask(() => worker.onmessage({ data: structuredClone(data, { transfer }) })); } };
  await import('../src/archive.worker.js');
  const handler = globalThis.self.onmessage;
  globalThis.Worker = class { constructor() { current = this; } postMessage(data, transfer = []) { posted.push(data.type || 'read'); handler({ data: structuredClone(data, { transfer }) }); } terminate() {} };
  t.after(() => { delete globalThis.Worker; globalThis.self = self; });
  const { root, meta } = await project(), sample = await host(root, meta, { ai: ai() });
  const opened = await sample.project.open(), state = { ...opened, files: { ...opened.files, 'image.bin': new Uint8Array([1, 2, 3]) } };
  const zeros = new Uint8Array(200 * 1024), loaded = await sample.conversations.load();
  await sample.conversations.save({ ...loaded, threads: [{ id: 'thread-one', title: 'A', messages: [{ id: 'm', role: 'user', parts: [], attachments: [{ id: 'z', name: 'zeros.bin', mime: 'application/octet-stream', dataUrl: `data:application/octet-stream;base64,${toBase64(zeros)}` }] }] }], runs: [] }, { expectedRevision: loaded.revision });
  const archive = await sample.project.export(state, { format: 'source', locale: 'en' });
  assert.deepEqual(posted, ['pack']);
  assert.ok(archive.bytes.byteLength > zeros.byteLength, 'blobs are stored, not deflated');
  assert.deepEqual(state.files['image.bin'], new Uint8Array([1, 2, 3]), 'the editor state keeps its buffers');
  const imported = await sample.project.import(archive.bytes);
  assert.deepEqual(posted, ['pack', 'read']);
  assert.equal(imported.conversationFiles.blobs.size, 1);
  // Thirty 20 MiB references exceed 512 MiB: rejected from the listing, before any blob is read.
  const refs = Array.from({ length: 30 }, (_, index) => ({ $trafficopsBlob: index.toString(16).padStart(64, '0'), encoding: 'bytes', size: 20 * 1024 * 1024 }));
  await writeFile(root, '.trafficops/conversations/huge.json', JSON.stringify({ schema: 1, id: 'huge', revision: 1, messages: [{ id: 'm', role: 'user', parts: [], refs }], runs: [] }));
  await assert.rejects(sample.project.export(state, { format: 'source', locale: 'en' }), error => error.code === 'validation' && /512 MiB/.test(error.message));
  assert.deepEqual(posted, ['pack', 'read']);
  await sample.dispose();
});
