import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithAiProviderRecovery } from '../../packages/template-editor-shell/src/ai-provider-recovery.js';

test('a transient failure gets one recovery shared across all stages', async () => {
  const retryState = { attempted: false }, events = [];
  let calls = 0;
  const result = await runWithAiProviderRecovery(async () => { if (++calls === 1) throw { statusCode: 503, message: 'Unavailable' }; return 'ok'; }, { retryState, delayMs: 0, onProgress: event => events.push(event) });
  assert.equal(result, 'ok'); assert.equal(calls, 2); assert.equal(retryState.attempted, true);
  assert.equal(events[0].type, 'provider-recovery');
  await assert.rejects(runWithAiProviderRecovery(async () => { calls++; throw { statusCode: 503, message: 'Unavailable' }; }, { retryState, delayMs: 0 }), /Unavailable/);
  assert.equal(calls, 3);
});

test('never retries terminal errors, started tool operations, or an exhausted deadline', async () => {
  for (const options of [{ error: { statusCode: 402, message: 'No credits' } }, { canRetry: () => false }, { deadline: Date.now() }]) {
    let calls = 0;
    await assert.rejects(runWithAiProviderRecovery(async () => { calls++; throw options.error || { statusCode: 502, message: 'Unavailable' }; }, { ...options, delayMs: 0 }));
    assert.equal(calls, 1);
  }
});

test('cancellation interrupts the recovery delay without another request', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = runWithAiProviderRecovery(async () => { calls++; throw { statusCode: 429, message: 'Slow down' }; }, { signal: controller.signal, onProgress: () => controller.abort() });
  await assert.rejects(pending); assert.equal(calls, 1);
});

test('a Retry-After longer than the recovery window never gets retried early', async () => {
  let calls = 0;
  await assert.rejects(runWithAiProviderRecovery(async () => { calls++; throw { statusCode: 429, message: 'Slow down', responseHeaders: { 'retry-after': '120' } }; }, { delayMs: 0 }), /Retry after 120 seconds/);
  assert.equal(calls, 1);
});
