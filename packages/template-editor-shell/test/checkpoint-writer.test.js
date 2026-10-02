import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointWriter } from '../src/checkpoint-writer.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('one write in flight; changes during it coalesce into the next write (latest wins)', async () => {
  const writes = [], gate = deferred();
  const writer = createCheckpointWriter(async batch => { writes.push(batch); if (writes.length === 1) await gate.promise; },
    { merge: (previous, next) => ({ ...previous, ...next, events: [...previous.events, ...next.events] }) });
  writer.push({ checkpoint: 'a', events: [1] });
  writer.push({ checkpoint: 'b', events: [2] });
  writer.push({ checkpoint: 'c', phase: 'review', events: [3] });
  await Promise.resolve();
  assert.deepEqual(writes, [{ checkpoint: 'a', events: [1] }]);
  gate.resolve(); await writer.idle();
  assert.deepEqual(writes, [{ checkpoint: 'a', events: [1] }, { checkpoint: 'c', phase: 'review', events: [2, 3] }]);
});

test('close waits for the write in flight and hands back the unwritten batch', async () => {
  const gate = deferred(), writes = [];
  const writer = createCheckpointWriter(async batch => { writes.push(batch); await gate.promise; });
  writer.push({ checkpoint: 'a' }); writer.push({ checkpoint: 'b' });
  let closed = false;
  const closing = writer.close().then(rest => { closed = true; return rest; });
  await Promise.resolve(); assert.equal(closed, false);
  gate.resolve();
  assert.deepEqual(await closing, { checkpoint: 'b' });
  writer.push({ checkpoint: 'late' }); await writer.idle();
  assert.deepEqual(writes, [{ checkpoint: 'a' }]);
});

test('a failed write reports once and stops further background writes', async () => {
  const errors = [], writes = [];
  const writer = createCheckpointWriter(async batch => { writes.push(batch); throw new Error('Quota'); }, { onError: error => errors.push(error.message) });
  writer.push({ checkpoint: 'a' }); await writer.idle();
  writer.push({ checkpoint: 'b' }); await writer.idle();
  assert.deepEqual(errors, ['Quota']); assert.equal(writes.length, 1);
});
