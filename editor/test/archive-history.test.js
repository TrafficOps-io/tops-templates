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
const archive = async () => createZip({ 'index.tpl': 'x' }, { metadata, conversationFiles: await conversationFilesFromDocument(document) });

test('readArchive passes the history option through (no worker)', async () => {
  const bytes = await archive();
  assert.equal((await readArchive(bytes, { history: true })).conversationFiles.threads[0].id, 'thread-1');
  await assert.rejects(readArchive(bytes), error => error.code === 'validation' && /history/i.test(error.message));
  await assert.rejects(readArchive(bytes, { signal: AbortSignal.abort() }), error => error.code === 'abort');
});

test('readArchive posts { bytes, history } to the worker and scales its timeout with the archive size', async t => {
  const posted = [];
  globalThis.Worker = class { postMessage(data) { posted.push(data); queueMicrotask(() => this.onmessage({ data: { files: {}, folders: [], settings: {} } })); } terminate() {} };
  t.after(() => { delete globalThis.Worker; });
  const bytes = new Uint8Array([1, 2, 3]);
  await readArchive(bytes, { history: true });
  await readArchive(bytes);
  assert.deepEqual(posted, [{ bytes, history: true }, { bytes, history: false }]);
  assert.equal(archiveReadTimeout(1024), 15000);
  assert.equal(archiveReadTimeout(100 * 1024 * 1024), 50000);
});

test('archive.worker reads { bytes, history } and still accepts bare bytes', async t => {
  const messages = [];
  globalThis.self = { postMessage: data => messages.push(data) };
  t.after(() => { delete globalThis.self; });
  await import('../src/archive.worker.js');
  const bytes = await archive();
  globalThis.self.onmessage({ data: { bytes, history: true } });
  globalThis.self.onmessage({ data: bytes });
  globalThis.self.onmessage({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  assert.equal(messages[0].conversationFiles.threads[0].id, 'thread-1');
  assert.match(messages[1].error, /history/i);
  assert.match(messages[2].error, /history/i);
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
