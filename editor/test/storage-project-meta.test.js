import assert from 'node:assert/strict';
import test from 'node:test';
import { fromBase64, sha256Hex, toBase64 } from '@trafficops/template-editor-core';
import { claimPendingAi, createProjectMeta, encodePendingAi, preparePendingAi, readProjectMeta, readValues, rekeyProjectMeta, resolvePendingAi, storePendingAi, updateProjectMeta, writeValues } from '../src/storage/project-meta.js';
import { createDirectoryConversationStore } from '../src/storage/directory-conversation-store.js';
import { readFile, readJson, writeFile } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const META = '.trafficops/project.json', BLOBS = '.trafficops/conversations/blobs';
const conflict = error => error?.code === 'conflict';
const validation = error => error?.code === 'validation';
// A real 1×1 PNG: the runtime's attachment rules read the image header.
const png = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const pngUrl = `data:image/png;base64,${toBase64(png)}`;
const brief = (id = 'brief-1', extra = {}) => ({ id, prompt: 'A landing page for a bakery', mode: 'build', generateImages: true, attachments: [{ id: 'att-1', name: 'logo.png', mime: 'image/png', dataUrl: pngUrl, useOnPage: true }], ...extra });
let count = 0;

async function project(meta = {}) {
  const root = new MemoryDirectoryHandle('root'), projectId = `project-${++count}`;
  await createProjectMeta(root, { schema: 1, projectId, kind: 'landing', name: 'Bakery', metadataRevision: 0, ...meta });
  return { root, projectId };
}

test('createProjectMeta writes project.json once and readProjectMeta validates it', async () => {
  const { root, projectId } = await project({ createdAt: 5 });
  assert.deepEqual(await readProjectMeta(root), { schema: 1, projectId, kind: 'landing', name: 'Bakery', metadataRevision: 0, createdAt: 5 });
  await assert.rejects(createProjectMeta(root, { schema: 1, projectId: 'other', kind: 'landing', name: 'Other' }), conflict);
  assert.equal((await readProjectMeta(root)).projectId, projectId);
  assert.equal(await readProjectMeta(new MemoryDirectoryHandle('empty')), null);
  await assert.rejects(createProjectMeta(new MemoryDirectoryHandle('x'), { schema: 1, projectId: 'p', kind: 'landing', name: 'P', pendingAi: brief() }), validation);
  await writeFile(root, META, JSON.stringify({ schema: 2 }));
  await assert.rejects(readProjectMeta(root), /Unsupported Studio project metadata/);
});

test('pendingAi round trip stores attachment bytes as conversation blobs and resolves them back', async () => {
  const { root, projectId } = await project();
  await storePendingAi(root, projectId, brief());
  const sha = await sha256Hex(png), stored = await readJson(root, META);
  assert.deepEqual(stored.pendingAi, { id: 'brief-1', prompt: 'A landing page for a bakery', mode: 'build', generateImages: true, attachments: [{ id: 'att-1', name: 'logo.png', mime: 'image/png', useOnPage: true, blob: { $trafficopsBlob: sha, encoding: 'bytes', size: png.byteLength } }] });
  assert.deepEqual(await readFile(root, `${BLOBS}/${sha}`), png);
  const meta = await readProjectMeta(root);
  assert.deepEqual(meta.pendingAi, stored.pendingAi);
  assert.deepEqual(await resolvePendingAi(root, meta), brief());
  assert.equal(await resolvePendingAi(root, { ...meta, pendingAi: undefined }), null);
  // The conversation store's GC sees the brief's blob as referenced.
  const store = createDirectoryConversationStore(root, { projectId, locks: null, graceMs: -1 });
  try { await store.collectGarbage(); assert.deepEqual(await store.getBlob(sha), png); } finally { store.close(); }
});

test('pendingAi keeps text attachments and drops useOnPage for non-images', async () => {
  const { root, projectId } = await project();
  const notes = { id: 'att-2', name: 'notes.md', mime: 'text/markdown', text: '# Menu\nBread' };
  await storePendingAi(root, projectId, brief('b', { generateImages: false, attachments: [{ ...notes, useOnPage: true }] }));
  const meta = await readProjectMeta(root);
  assert.equal(meta.pendingAi.attachments[0].blob.encoding, 'utf8');
  assert.equal(meta.pendingAi.attachments[0].useOnPage, false);
  assert.deepEqual(await resolvePendingAi(root, meta), brief('b', { generateImages: false, attachments: [{ ...notes, useOnPage: false }] }));
});

test('storePendingAi rejects malformed briefs and a foreign project', async () => {
  const { root, projectId } = await project();
  await assert.rejects(storePendingAi(root, projectId, brief('b', { attachments: [{ id: 'a', name: 'x.png', mime: 'image/png', dataUrl: 'data:image/jpeg;base64,AAAA' }] })), validation);
  await assert.rejects(storePendingAi(root, projectId, brief('b', { prompt: 'x'.repeat(6001) })), validation);
  const image = brief().attachments[0], notes = { id: 'n', name: 'n.md', mime: 'text/markdown', text: 'hi' };
  for (const attachments of [
    [{ ...image, id: 'not ok' }], // id outside the runtime's regex
    [image, { ...image }], // duplicate id
    [1, 2, 3, 4, 5].map(index => ({ ...image, id: `a${index}` })), // more than 4
    [{ ...image, mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${toBase64(png)}` }], // contents do not match the type
    [{ ...notes, mime: 'image/png', dataUrl: undefined }], // an image needs a data URL
    [{ ...image, mime: 'text/markdown' }], // a text document needs text
    [{ ...image, mime: 'application/zip', dataUrl: 'data:application/zip;base64,AAAA' }],
  ]) await assert.rejects(storePendingAi(root, projectId, brief('b', { attachments })), validation, JSON.stringify(attachments).slice(0, 120));
  await assert.rejects(storePendingAi(root, projectId, { ...brief('b'), id: '' }), validation);
  await assert.rejects(storePendingAi(root, 'someone-else', brief()), conflict);
  assert.equal((await readProjectMeta(root)).pendingAi, undefined);
});

test('attachment names are defaulted and truncated like the runtime does', async () => {
  const { root, projectId } = await project();
  const notes = { id: 'n', name: '', mime: 'text/plain', text: 'menu' };
  await storePendingAi(root, projectId, brief('b', { attachments: [{ ...brief().attachments[0], name: 'x'.repeat(300) }, notes] }));
  const [image, text] = (await resolvePendingAi(root, await readProjectMeta(root))).attachments;
  assert.equal(image.name, 'x'.repeat(160));
  assert.equal(text.name, 'Document');
});

test('preparePendingAi stores blobs without touching project.json; createProjectMeta can write the brief with the project', async () => {
  const root = new MemoryDirectoryHandle('root');
  const pendingAi = await preparePendingAi(root, 'fresh', brief());
  assert.equal(await readFile(root, META), null, 'prepare writes no metadata');
  assert.deepEqual(await readFile(root, `${BLOBS}/${pendingAi.attachments[0].blob.$trafficopsBlob}`), png);
  const created = await createProjectMeta(root, { schema: 1, projectId: 'fresh', kind: 'landing', name: 'Fresh' }, { pendingAi });
  assert.deepEqual(created.pendingAi, pendingAi);
  assert.deepEqual(await resolvePendingAi(root, await readProjectMeta(root)), brief());
  const other = new MemoryDirectoryHandle('other');
  await assert.rejects(createProjectMeta(other, { schema: 1, projectId: 'x', kind: 'landing', name: 'X' }, { pendingAi }), validation, 'refs to blobs missing from this folder are rejected');
  await assert.rejects(createProjectMeta(other, { schema: 1, projectId: 'x', kind: 'landing', name: 'X' }, { pendingAi: brief() }), validation, 'an unprepared brief is rejected');
  assert.equal(await readFile(other, META), null);
});

test('a malformed pendingAi on disk is dropped from reads with an error; claim and update tolerate it', async () => {
  const { root, projectId } = await project();
  const good = await readJson(root, META);
  await writeFile(root, META, JSON.stringify({ ...good, pendingAi: { id: 'b', prompt: 'Go', mode: 'build', attachments: [{ id: 'a', name: 'a.png', mime: 'image/png', blob: { $trafficopsBlob: 'nope' } }] } }));
  const meta = await readProjectMeta(root);
  assert.equal(meta.pendingAi, undefined);
  assert.equal(typeof meta.pendingAiError, 'string');
  assert.equal(meta.name, 'Bakery');
  assert.equal(await resolvePendingAi(root, meta), null);
  assert.equal(await claimPendingAi(root, projectId, 'b'), false);
  assert.ok((await readJson(root, META)).pendingAi, 'a refused claim leaves the file alone');
  const saved = await updateProjectMeta(root, projectId, { name: 'Renamed' });
  assert.equal(typeof saved.pendingAiError, 'string', 'the dropped brief is reported');
  const disk = await readJson(root, META);
  assert.equal(disk.pendingAi, undefined);
  assert.equal(disk.pendingAiError, undefined, 'the report is never written');
  assert.equal(disk.name, 'Renamed');
});

test('resolvePendingAi re-validates the rebuilt attachments', async () => {
  const { root, projectId } = await project();
  await storePendingAi(root, projectId, brief());
  const disk = await readJson(root, META);
  disk.pendingAi.attachments[0].mime = 'image/jpeg';
  await writeFile(root, META, JSON.stringify(disk));
  await assert.rejects(resolvePendingAi(root, await readProjectMeta(root)), validation);
});

test('claimPendingAi removes the brief exactly once; concurrent claims have one winner', async () => {
  const { root, projectId } = await project();
  await storePendingAi(root, projectId, brief());
  assert.equal(await claimPendingAi(root, projectId, 'other-brief'), false);
  assert.ok((await readProjectMeta(root)).pendingAi, 'a different id leaves the brief in place');
  const results = await Promise.all([1, 2, 3, 4].map(() => claimPendingAi(root, projectId, 'brief-1')));
  assert.deepEqual(results.filter(Boolean), [true]);
  assert.equal((await readProjectMeta(root)).pendingAi, undefined);
  assert.equal(await claimPendingAi(root, projectId, 'brief-1'), false);
  assert.equal((await readProjectMeta(root)).name, 'Bakery', 'claiming keeps the rest of the metadata');
});

test('a stale updateProjectMeta cannot bring pendingAi back', async () => {
  const { root, projectId } = await project();
  await storePendingAi(root, projectId, brief());
  const stale = await readProjectMeta(root);
  assert.equal(await claimPendingAi(root, projectId, 'brief-1'), true);
  await assert.rejects(updateProjectMeta(root, projectId, stale), validation, 'pendingAi in a patch is rejected');
  const { pendingAi, ...rest } = stale;
  const saved = await updateProjectMeta(root, projectId, { ...rest, name: 'Renamed' });
  assert.equal(saved.pendingAi, undefined);
  assert.equal((await readProjectMeta(root)).pendingAi, undefined);
  assert.equal((await readProjectMeta(root)).name, 'Renamed');
});

test('updateProjectMeta preserves a pending brief it does not mention', async () => {
  const { root, projectId } = await project();
  await storePendingAi(root, projectId, brief());
  await updateProjectMeta(root, projectId, { contentRevision: 3 });
  const meta = await readProjectMeta(root);
  assert.equal(meta.contentRevision, 3);
  assert.equal(meta.pendingAi.id, 'brief-1');
});

test('updateProjectMeta rejects a foreign projectId on disk, a projectId patch and missing metadata', async () => {
  const { root, projectId } = await project();
  await assert.rejects(updateProjectMeta(root, 'someone-else', { name: 'X' }), conflict);
  await assert.rejects(updateProjectMeta(root, projectId, { projectId: 'moved' }), validation);
  await assert.rejects(updateProjectMeta(new MemoryDirectoryHandle('empty'), projectId, { name: 'X' }), conflict);
  assert.equal((await readProjectMeta(root)).name, 'Bakery');
});

test('metadataRevision increments only when name or kind change', async () => {
  const { root, projectId } = await project({ metadataRevision: 4 });
  assert.equal((await updateProjectMeta(root, projectId, { contentRevision: 1, contentHash: 'a'.repeat(64) })).metadataRevision, 4);
  assert.equal((await updateProjectMeta(root, projectId, { name: 'Bakery' })).metadataRevision, 4, 'an unchanged name is not a change');
  assert.equal((await updateProjectMeta(root, projectId, { name: 'Bakery 2' })).metadataRevision, 5);
  assert.equal((await updateProjectMeta(root, projectId, { kind: 'template' })).metadataRevision, 6);
  assert.equal((await updateProjectMeta(root, projectId, { name: 'Both', kind: 'landing', metadataRevision: 99 })).metadataRevision, 7, 'the store owns the counter');
  assert.equal((await readProjectMeta(root)).metadataRevision, 7);
});

test('concurrent updateProjectMeta patches are serialized and none is lost', async () => {
  const { root, projectId } = await project();
  await Promise.all([updateProjectMeta(root, projectId, { name: 'One' }), updateProjectMeta(root, projectId, { contentRevision: 9 }), updateProjectMeta(root, projectId, { appliedAiRuns: ['run-1'] })]);
  const meta = await readProjectMeta(root);
  assert.deepEqual([meta.name, meta.contentRevision, meta.appliedAiRuns, meta.metadataRevision], ['One', 9, ['run-1'], 1]);
});

test('values round trip; an empty object removes the file and an empty sidecar folder', async () => {
  const root = new MemoryDirectoryHandle('root', { 'index.tpl': 'hello' });
  assert.deepEqual(await readValues(root), {});
  await writeValues(root, { headline: 'Saved locally' });
  assert.deepEqual(await readValues(root), { headline: 'Saved locally' });
  await writeValues(root, {});
  assert.deepEqual(await readValues(root), {});
  assert.equal(root.children.has('.trafficops'), false);
  const { root: withMeta } = await project();
  await writeValues(withMeta, { a: 1 }); await writeValues(withMeta, {});
  assert.equal(await readFile(withMeta, '.trafficops/values.json'), null);
  assert.ok(await readProjectMeta(withMeta), 'project.json survives');
  await writeFile(withMeta, '.trafficops/values.json', '[1]');
  await assert.rejects(readValues(withMeta), /values.json/);
});

test('rekeyProjectMeta moves the folder to a new projectId, keeping the brief and every other field', async () => {
  const { root, projectId } = await project({ contentRevision: 3 });
  await storePendingAi(root, projectId, brief());
  const before = await readProjectMeta(root);
  const after = await rekeyProjectMeta(root, projectId, 'fresh-id');
  assert.deepEqual(after, { ...before, projectId: 'fresh-id' });
  assert.deepEqual(await readProjectMeta(root), after);
  await assert.rejects(rekeyProjectMeta(root, projectId, 'again'), conflict, 'the old id no longer owns the folder');
  await assert.rejects(updateProjectMeta(root, projectId, { name: 'Stale' }), conflict);
  assert.equal(await claimPendingAi(root, 'fresh-id', 'brief-1'), true);
  await assert.rejects(rekeyProjectMeta(root, 'fresh-id', ''), /project ID/);
});

test('encodePendingAi validates a brief and returns its refs and blob bytes without any I/O', async () => {
  const { pendingAi, blobs } = await encodePendingAi(brief());
  const sha = await sha256Hex(png);
  assert.deepEqual(pendingAi.attachments[0].blob, { $trafficopsBlob: sha, encoding: 'bytes', size: png.byteLength });
  assert.deepEqual(blobs, [[sha, png]]);
  await assert.rejects(encodePendingAi(brief('brief-1', { prompt: 'x'.repeat(6001) })), validation);
  await assert.rejects(encodePendingAi(brief('brief-1', { attachments: [{ id: 'bad id!', name: 'a', mime: 'image/png', dataUrl: pngUrl }] })), validation);
  await assert.rejects(encodePendingAi(null), validation);
});
