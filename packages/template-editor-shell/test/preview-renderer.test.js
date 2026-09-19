import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRenderer } from '../src/preview-renderer.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('continuous source deltas render on time and coalesce behind one slow host request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [], results = [];
  let complete;
  const renderer = createPreviewRenderer({ delay: 400,
    render: request => { calls.push(request); return new Promise(resolve => { complete = resolve; }); },
    onSuccess: value => results.push(value), onError: error => { throw error; },
  });
  t.after(() => renderer.dispose());
  for (let version = 1; version <= 4; version++) { renderer.enqueue({ version, partial: true }); t.mock.timers.tick(100); }
  assert.equal(calls.length, 1, 'frequent input must not keep restarting the preview timer');
  assert.equal(calls[0].version, 4);
  renderer.enqueue({ version: 5, partial: true }); renderer.enqueue({ version: 6, partial: false });
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 1, 'only one host render may be in flight');
  complete('preview 4'); await settle();
  assert.deepEqual(results, ['preview 4']);
  t.mock.timers.tick(400);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].version, 6, 'intermediate queued drafts should be coalesced');
  complete('preview 6'); await settle();
  assert.deepEqual(results, ['preview 4', 'preview 6']);
});

test('incomplete TPL keeps the last preview, completed invalid TPL is diagnosed, and valid input recovers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previews = [], errors = [];
  const renderer = createPreviewRenderer({ delay: 1,
    render: async request => { if (request.invalid) throw new Error('Incomplete layout'); return request.html; },
    onSuccess: html => previews.push(html), onError: error => errors.push(error.message),
  });
  t.after(() => renderer.dispose());
  for (const request of [{ html: 'original' }, { invalid: true, partial: true }, { invalid: true, partial: false }, { html: 'updated', partial: true }]) {
    renderer.enqueue(request); t.mock.timers.tick(1); await settle();
  }
  assert.deepEqual(previews, ['original', 'updated']);
  assert.deepEqual(errors, ['Incomplete layout']);
});

test('disposing the preview aborts the in-flight request and discards all queued callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const callbacks = [];
  let signal, complete;
  const renderer = createPreviewRenderer({ delay: 1,
    render: (_request, abortSignal) => { signal = abortSignal; return new Promise(resolve => { complete = resolve; }); },
    onSuccess: result => callbacks.push(result), onError: error => callbacks.push(error),
  });
  renderer.enqueue({}); t.mock.timers.tick(1);
  renderer.enqueue({}); renderer.dispose();
  assert.equal(signal.aborted, true);
  complete('stale preview'); await settle(); t.mock.timers.tick(1000);
  assert.deepEqual(callbacks, []);
});
