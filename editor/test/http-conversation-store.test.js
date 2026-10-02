import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '@trafficops/template-editor-core';
import { conversationStoreContract } from '@trafficops/template-editor-core/conversation-store-contract';
import { createHttpConversationStore } from '../embedded/src/http-conversation-store.js';
import { httpServer } from './support/http-server.js';

const endpoint = 'https://app.test/project';
const open = (server = httpServer({ aiEnabled: true, conversationsEnabled: true })) => ({ server, store: createHttpConversationStore({ endpoint, csrf: 'csrf', fetchImpl: server.fetchImpl }) });

// openPeer stays the identity: an HTTP store has no watch, so the watch case is skipped by the contract itself.
for (const contract of conversationStoreContract) test(`HTTP conversation store contract: ${contract.name}`, () => contract.run(async () => open().store));

test('HTTP conversation store sends credentials, CSRF, If-Match and encoded ids', async () => {
  const { server, store } = open(), id = 'a/b c?', bytes = new TextEncoder().encode('blob'), sha = await sha256Hex(bytes);
  await store.putBlob(sha, bytes);
  await store.writeThread({ schema: 1, id, revision: 0, title: 'T', messages: [], runs: [] }, { expectedRevision: 0 });
  await store.deleteThread(id, { expectedRevision: 1 });
  const [blob, put, remove] = server.calls.slice(-3);
  assert.equal(blob.url, `${endpoint}/conversation-blobs/${sha}`); assert.equal(blob.init.headers['Content-Type'], 'application/octet-stream');
  assert.equal(put.url, `${endpoint}/conversations/${encodeURIComponent(id)}`); assert.equal(put.init.method, 'PUT'); assert.equal(put.init.headers['If-Match'], '"0"');
  assert.equal(remove.init.method, 'DELETE'); assert.equal(remove.init.headers['If-Match'], '"1"');
  for (const call of [blob, put, remove]) { assert.equal(call.init.credentials, 'same-origin'); assert.equal(call.init.headers['X-CSRF-TOKEN'], 'csrf'); }
  assert.equal('watch' in store, false); assert.equal('collectGarbage' in store, false);
});

test('HTTP conversation store maps status codes', async () => {
  const { server, store } = open(), sha = 'f'.repeat(64);
  await assert.rejects(store.getBlob(sha), error => error.message === 'A conversation attachment is missing on the server.');
  server.fail({ status: 413, body: {} });
  await assert.rejects(store.listThreads(), error => error.message === 'The dialogue exceeds the server limit.' && error.code !== 'conflict');
  server.fail({ status: 413, body: { message: 'Too large for this team.' } });
  await assert.rejects(store.putBlob(sha, new Uint8Array(1)), /Too large for this team/);
  server.fail({ status: 409 }); await assert.rejects(store.listThreads(), error => error.code === 'conflict');
  server.fail({ status: 422 }); await assert.rejects(store.listThreads(), error => error.code === 'validation');
  server.fail({ status: 404 }); await store.deleteThread('gone', { expectedRevision: 3 });
  server.fail({ status: 403 }); await assert.rejects(store.listThreads(), error => error.code === 'policy');
  server.fail(new TypeError('Network failed')); await assert.rejects(store.listThreads(), error => error.code === 'transport');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(store.listThreads({ signal: controller.signal }), error => error.code === 'abort');
});
