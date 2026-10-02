import test from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_LIMITS, clonePortablePayload, validateConversationDocument } from '../src/project.js';

const doc = (threads, runs) => ({ schema: 1, projectId: 'p', revision: 0, threads, runs });

test('history limits count runs per dialogue, not per project', () => {
  const runs = Array.from({ length: 150 }, (_, index) => ({ id: `r${index}`, threadId: index < 100 ? 'a' : 'b' }));
  validateConversationDocument(doc([{ id: 'a', messages: [] }, { id: 'b', messages: [] }], runs));
  assert.throws(() => validateConversationDocument(doc([{ id: 'a', messages: [] }], [...runs.slice(0, 100), { id: 'extra', threadId: 'a' }])), /at most 100 runs/);
});

test('history assets may reach 24 MiB and the in-memory document 512 MiB', () => {
  assert.equal(CONVERSATION_LIMITS.blob, 24 * 1024 * 1024);
  assert.equal(CONVERSATION_LIMITS.total, 512 * 1024 * 1024);
  assert.equal(CONVERSATION_LIMITS.threadEncoded, 16 * 1024 * 1024);
  assert.equal(clonePortablePayload({ asset: new Uint8Array(20 * 1024 * 1024) }).asset.byteLength, 20 * 1024 * 1024);
  assert.throws(() => clonePortablePayload({ asset: new Uint8Array(25 * 1024 * 1024) }), /24 MiB/);
});

test('the document-wide run cap still applies', () => {
  const runs = Array.from({ length: 10001 }, (_, index) => ({ id: `r${index}` }));
  assert.throws(() => validateConversationDocument(doc([], runs)), /at most 10000 runs/);
});
