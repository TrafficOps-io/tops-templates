import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex, toBase64 } from '@trafficops/template-editor-core';
import { claimPendingAi, createProjectMeta, readProjectMeta, readValues, resolvePendingAi, storePendingAi, updateProjectMeta, writeValues } from '../src/storage/project-meta.js';
import { createDirectoryConversationStore } from '../src/storage/directory-conversation-store.js';
import { readFile, readJson, writeFile } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const META = '.trafficops/project.json', BLOBS = '.trafficops/conversations/blobs';
const conflict = error => error?.code === 'conflict';
const validation = error => error?.code === 'validation';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
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
  await assert.rejects(storePendingAi(root, projectId, { ...brief('b'), id: '' }), validation);
  await assert.rejects(storePendingAi(root, 'someone-else', brief()), conflict);
  assert.equal((await readProjectMeta(root)).pendingAi, undefined);
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
