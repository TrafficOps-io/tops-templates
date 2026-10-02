import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROVIDER_RETRIES, RETRYABLE_STATUSES, retryAfterMs, retryDecision } from '../src/ai-retry-policy.js';

test('only pre-output provider rejections with a retryable status are retried, at most three times', () => {
  assert.deepEqual(RETRYABLE_STATUSES, [408, 429, 500, 502, 503, 504, 529]);
  for (const status of RETRYABLE_STATUSES) assert.equal(retryDecision({ status, attempt: 0, random: () => 0.5 }).retry, true, String(status));
  for (const status of [undefined, 400, 401, 402, 403, 404, 422, 501]) assert.deepEqual(retryDecision({ status, attempt: 0 }), { retry: false, delayMs: 0 }, String(status));
  assert.deepEqual(retryDecision({ status: 503, sawOutput: true, attempt: 0 }), { retry: false, delayMs: 0 }, 'output already started: the outcome is unknown');
  assert.equal(MAX_PROVIDER_RETRIES, 3);
  assert.equal(retryDecision({ status: 503, attempt: 2, random: () => 0.5 }).retry, true);
  assert.deepEqual(retryDecision({ status: 503, attempt: 3 }), { retry: false, delayMs: 0 });
});

test('backoff is 1 s, 3 s, 7 s with ±20 % jitter', () => {
  assert.deepEqual([0, 1, 2].map(attempt => retryDecision({ status: 429, attempt, random: () => 0.5 }).delayMs), [1000, 3000, 7000]);
  assert.deepEqual([0, 1, 2].map(attempt => retryDecision({ status: 429, attempt, random: () => 0 }).delayMs), [800, 2400, 5600]);
  assert.deepEqual([0, 1, 2].map(attempt => retryDecision({ status: 429, attempt, random: () => 0.999999 }).delayMs), [1200, 3600, 8400]);
  for (let index = 0; index < 50; index++) { const { delayMs } = retryDecision({ status: 502, attempt: 1 }); assert.ok(delayMs >= 2400 && delayMs <= 3600, String(delayMs)); }
});

test('Retry-After wins over backoff and is capped at 20 s', () => {
  assert.deepEqual(retryDecision({ status: 429, attempt: 0, retryAfterMs: 2500 }), { retry: true, delayMs: 2500 });
  assert.deepEqual(retryDecision({ status: 429, attempt: 1, retryAfterMs: 120000 }), { retry: true, delayMs: 20000 });
  assert.deepEqual(retryDecision({ status: 429, attempt: 0, retryAfterMs: 0 }), { retry: true, delayMs: 0 });
  assert.equal(retryAfterMs({ 'retry-after': '3' }), 3000);
  assert.equal(retryAfterMs(new Headers({ 'Retry-After': '1.5' })), 1500);
  assert.equal(retryAfterMs({ 'retry-after': new Date(10000 + 4000).toUTCString() }, 10000), 4000);
  assert.equal(retryAfterMs({ 'retry-after': 'soon' }), undefined);
  assert.equal(retryAfterMs(undefined), undefined);
});
