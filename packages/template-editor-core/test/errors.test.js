import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeError, runOperation, EditorError, ConflictError, ValidationError } from '../src/index.js';

test('HTTP and native errors normalize without losing diagnostics or cause', () => {
  const diagnostic = { path: 'items.0.title', locale: 'uk', section: 'main', label: 'Title', message: 'Required' };
  const failure = Object.assign(new Error('Invalid'), { status: 422, payload: { diagnostics: [diagnostic] } });
  const value = normalizeError(failure);
  assert.ok(value instanceof ValidationError); assert.equal(value.code, 'validation');
  assert.deepEqual(value.diagnostics, [diagnostic]); assert.equal(value.cause, failure);
  for (const [failure, expected] of [[{status:409},'conflict'], [{status:403},'policy'], [new DOMException('Cancelled','AbortError'),'abort'], [new DOMException('Denied','NotAllowedError'),'policy'], [new TypeError('Network'),'transport']]) {
    assert.equal(normalizeError(failure).code, expected);
  }
  const conflict = new ConflictError(); assert.equal(normalizeError(conflict), conflict);
});

test('cancellation is checked before execution and after asynchronous resolution', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(runOperation(before.signal, () => assert.fail('cancelled operation ran')), e => e instanceof EditorError && e.code === 'abort');
  const after = new AbortController(); let complete;
  const pending = runOperation(after.signal, () => new Promise(resolve => { complete = resolve; }));
  after.abort(); complete('stale');
  await assert.rejects(pending, e => e.code === 'abort');
  await assert.rejects(runOperation(undefined, () => { throw new TypeError('Invalid ZIP'); }, 'validation'), e => e.code === 'validation');
});
