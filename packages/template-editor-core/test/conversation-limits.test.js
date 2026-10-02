import test from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_LIMITS, LIMITS, clonePortablePayload, validateConversationDocument } from '../src/project.js';

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

test('history must be a JSON tree: circular references and non-JSON values are rejected', () => {
  const circular = { id: 'a', messages: [] };
  circular.self = circular;
  assert.throws(() => validateConversationDocument(doc([circular], [])), /circular/);
  for (const value of [() => {}, new Date(0), new Map(), Number.NaN, Infinity, undefined, 1n, Symbol('x')]) {
    assert.throws(() => validateConversationDocument(doc([{ id: 'a', messages: [], value }], [])), /JSON values or bytes/, String(typeof value));
  }
  // A shared (non-circular) reference is fine and is cloned apart.
  const shared = { text: 'same' }, cloned = validateConversationDocument(doc([{ id: 'a', messages: [], one: shared, two: shared }], []));
  assert.notEqual(cloned.threads[0].one, cloned.threads[0].two);
});

test('history holds at most 100 dialogues and bounds text to LIMITS.text', () => {
  const threads = count => Array.from({ length: count }, (_, index) => ({ id: `t${index}`, messages: [] }));
  assert.equal(validateConversationDocument(doc(threads(CONVERSATION_LIMITS.threads), [])).threads.length, 100);
  assert.throws(() => validateConversationDocument(doc(threads(CONVERSATION_LIMITS.threads + 1), [])), /at most 100 threads/);
  const text = 'a'.repeat(LIMITS.text);
  assert.equal(validateConversationDocument(doc([{ id: 'a', messages: [{ id: 'm', prompt: text }] }], [])).threads[0].messages[0].prompt.length, LIMITS.text);
  assert.throws(() => validateConversationDocument(doc([{ id: 'a', messages: [{ id: 'm', prompt: `${text}a` }] }], [])), /exceeds its size limit/);
});
