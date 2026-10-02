import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationFilesFromDocument, conversationThreadFileName, createZip } from '@trafficops/template-editor-core';
import { archiveReadTimeout, readArchive } from '../src/hosts/read-archive.js';
import { createDirectoryConversationStore } from '../src/storage/directory-conversation-store.js';
import { listDirectory } from '../src/storage/write.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const metadata = { schema: 1, projectId: 'project-1', kind: 'landing', name: 'Demo' };
const document = { schema: 1, projectId: 'project-1', revision: 1, threads: [{ id: 'thread-1', title: 'Hero', messages: [] }],
  runs: [{ id: 'r1', threadId: 'thread-1', updatedAt: 1, base: { files: { 'logo.png': new Uint8Array([1, 2, 3]) } } }] };
const archive = async () => createZip({ 'index.tpl': 'x', 'logo.png': new Uint8Array([9, 8, 7]) }, { metadata, conversationFiles: await conversationFilesFromDocument(document) });

test('readArchive passes the history option through (no worker)', async () => {
  const bytes = await archive();
  assert.equal((await readArchive(bytes, { history: true })).conversationFiles.threads[0].id, 'thread-1');
  await assert.rejects(readArchive(bytes), error => error.code === 'validation' && /history/i.test(error.message));
  await assert.rejects(readArchive(bytes, { signal: AbortSignal.abort() }), error => error.code === 'abort');
});

test('readArchive posts { bytes, history } to the worker, transferring the input, and scales its timeout', async t => {
  const posted = [];
  globalThis.Worker = class { postMessage(data, transfer) { posted.push({ data, transfer }); queueMicrotask(() => this.onmessage({ data: { files: {}, folders: [], settings: {} } })); } terminate() {} };
  t.after(() => { delete globalThis.Worker; });
  const bytes = new Uint8Array([1, 2, 3]), backing = new Uint8Array([0, 1, 2, 3, 4]), view = backing.subarray(1, 4);
  await readArchive(bytes, { history: true });
  await readArchive(view);
  assert.deepEqual(posted.map(({ data }) => data.history), [true, false]);
  assert.equal(posted[0].data.bytes, bytes);
  assert.deepEqual(posted[0].transfer, [bytes.buffer]);
  // A view over a larger buffer is copied, so the caller's other data is not detached.
  assert.notEqual(posted[1].data.bytes.buffer, backing.buffer);
  assert.deepEqual([...posted[1].data.bytes], [1, 2, 3]);
  assert.deepEqual(posted[1].transfer, [posted[1].data.bytes.buffer]);
  assert.equal(archiveReadTimeout(1024), 15000);
  assert.equal(archiveReadTimeout(100 * 1024 * 1024), 50000);
});

test('archive.worker reads { bytes, history }; history defaults to off', async t => {
  const messages = [];
  globalThis.self = { postMessage: (data, transfer = []) => messages.push(Object.assign(data, { transfer })) };
  t.after(() => { delete globalThis.self; });
  await import('../src/archive.worker.js');
  const bytes = await archive();
  globalThis.self.onmessage({ data: { bytes, history: true } });
  globalThis.self.onmessage({ data: { bytes } });
  assert.equal(messages[0].conversationFiles.threads[0].id, 'thread-1');
  // Result buffers (binary files and blobs) are transferred back.
  const buffers = [messages[0].files['logo.png'].buffer, ...[...messages[0].conversationFiles.blobs.values()].map(blob => blob.buffer)];
  assert.ok(buffers.every(buffer => messages[0].transfer.includes(buffer)));
  assert.equal(messages[1].transfer.length, 0);
  assert.match(messages[1].error, /history/i);
});

test('ZIP thread file names match the directory store names', async () => {
  const root = new MemoryDirectoryHandle('root'), store = createDirectoryConversationStore(root, { projectId: 'p', locks: null });
  try {
    const ids = ['thread-1', 'Thread Two', 'initial-thread-64-ab', 'ÄÖü 💬', 'x'.repeat(160)];
    for (const id of ids) await store.writeThread({ schema: 1, id, revision: 0, messages: [], runs: [] }, { expectedRevision: 0 });
    const names = (await listDirectory(root, '.trafficops/conversations')).filter(entry => entry.kind === 'file').map(entry => entry.name).sort();
    assert.deepEqual(names, ids.map(conversationThreadFileName).sort());
  } finally { store.close(); }
});

test('the directory store refuses ill-formed ids instead of touching the dialogue that shares their UTF-8 name', async () => {
  const root = new MemoryDirectoryHandle('root'), store = createDirectoryConversationStore(root, { projectId: 'p', locks: null });
  try {
    await store.writeThread({ schema: 1, id: 'a�', revision: 0, messages: [], runs: [] }, { expectedRevision: 0 });
    await assert.rejects(store.deleteThread('a\uD800', { expectedRevision: 1 }), /Invalid dialogue ID/);
    await assert.rejects(store.writeThread({ schema: 1, id: 'a\uD800', revision: 0, messages: [], runs: [] }, { expectedRevision: 1 }), /Invalid dialogue ID/);
    assert.deepEqual((await store.listThreads()).map(thread => [thread.id, thread.revision]), [['a�', 1]]);
  } finally { store.close(); }
});
