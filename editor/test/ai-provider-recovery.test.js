import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithAiProviderRecovery } from '../../packages/template-editor-shell/src/ai-provider-recovery.js';

const noWait = async () => {};

test('a request rejected before any output gets up to three retries with a status event for each wait', async () => {
  const events = [];
  let calls = 0;
  const result = await runWithAiProviderRecovery(async () => { if (++calls < 4) throw { statusCode: 503, message: 'Unavailable' }; return 'ok'; }, { sleep: noWait, random: () => 0.5, onProgress: event => events.push(event) });
  assert.equal(result, 'ok'); assert.equal(calls, 4);
  assert.deepEqual(events.map(event => [event.type, event.attempt, event.maxAttempts, event.delayMs, event.statusCode]), [
    ['provider-recovery', 1, 3, 1000, 503], ['provider-recovery', 2, 3, 3000, 503], ['provider-recovery', 3, 3, 7000, 503]]);
  calls = 0;
  await assert.rejects(runWithAiProviderRecovery(async () => { calls++; throw { statusCode: 529, message: 'Overloaded' }; }, { sleep: noWait }), /Overloaded/);
  assert.equal(calls, 4, 'the fourth failure is final');
});

test('the policy is per request: a later request in the same run gets its own retries', async () => {
  const retryState = { attempted: false };
  for (let index = 0; index < 2; index++) {
    let calls = 0;
    assert.equal(await runWithAiProviderRecovery(async () => { if (++calls === 1) throw { statusCode: 429, message: 'Slow down' }; return 'ok'; }, { retryState, sleep: noWait }), 'ok');
    assert.equal(calls, 2);
  }
});

test('never retries terminal errors, network errors without status, started output or an exhausted deadline', async () => {
  for (const options of [{ error: { statusCode: 402, message: 'No credits' } }, { error: new Error('fetch failed') }, { canRetry: () => false }, { deadline: Date.now() }]) {
    let calls = 0;
    await assert.rejects(runWithAiProviderRecovery(async () => { calls++; throw options.error || { statusCode: 502, message: 'Unavailable' }; }, { ...options, sleep: noWait }));
    assert.equal(calls, 1);
  }
});

test('cancellation interrupts the recovery delay without another request', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = runWithAiProviderRecovery(async () => { calls++; throw { statusCode: 429, message: 'Slow down' }; }, { signal: controller.signal, onProgress: () => controller.abort() });
  await assert.rejects(pending); assert.equal(calls, 1);
});

test('Retry-After is honored up to 20 seconds', async () => {
  const delays = [];
  let calls = 0;
  await assert.rejects(runWithAiProviderRecovery(async () => { calls++; throw { statusCode: 429, message: 'Slow down', responseHeaders: { 'retry-after': '120' } }; }, { sleep: async delay => { delays.push(delay); } }), /Retry after 120 seconds/);
  assert.deepEqual(delays, [20000, 20000, 20000]); assert.equal(calls, 4);
  delays.length = 0; calls = 0;
  await runWithAiProviderRecovery(async () => { if (++calls === 1) throw { statusCode: 503, message: 'Busy', responseHeaders: new Headers({ 'Retry-After': '2' }) }; return 'ok'; }, { sleep: async delay => { delays.push(delay); } });
  assert.deepEqual(delays, [2000]);
});
