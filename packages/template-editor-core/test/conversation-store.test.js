import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationStoreContract } from '../src/conversation-store-contract.js';
import { createMemoryConversationStore } from '../src/memory-conversation-store.js';

for (const contract of conversationStoreContract) test(`memory store: ${contract.name}`, () => contract.run(options => createMemoryConversationStore(options)));

test('memory store: refreshing a blob postpones its collection', async () => {
  let t = 0;
  const store = createMemoryConversationStore({ now: () => t, graceMs: 10, refreshMs: 5 }), data = new TextEncoder().encode('blob');
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  await store.putBlob(sha, data);
  t = 8; await store.putBlob(sha, data);
  t = 15; await store.collectGarbage(); await store.getBlob(sha);
  t = 30; await store.collectGarbage();
  await assert.rejects(store.getBlob(sha));
});
