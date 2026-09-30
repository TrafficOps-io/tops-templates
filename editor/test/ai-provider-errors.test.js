import test from 'node:test';
import assert from 'node:assert/strict';
import { AiProviderError, normalizeAiProviderError, isRetryableAiProviderError, isTerminalImageError } from '../../packages/template-editor-shell/src/ai-provider-errors.js';
import { generateImageWithOpenRouter } from '../../packages/template-editor-shell/src/openrouter-images.js';
import { draftImageTool } from '../../packages/template-editor-shell/src/ai-image-tool.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';

test('SSE diagnostics preserve nested provider reasons and redact credentials without retaining payloads', () => {
  const key = 'sk-or-v1-test-sensitive-credential';
  const failure = normalizeAiProviderError({ error: {
    code: 502, message: 'JSON error injected into SSE stream',
    metadata: { provider_name: 'Google', raw: JSON.stringify({ error: { code: 503, message: `Upstream unavailable for ${key}` }, request: { Authorization: `Bearer ${key}`, prompt: 'PRIVATE PROMPT' } }) },
  }, id: 'gen-check-123' }, { apiKey: key });
  assert.ok(failure instanceof AiProviderError);
  assert.match(failure.message, /\[Google\].*Upstream unavailable for \[redacted\]/);
  assert.match(failure.message, /JSON error injected/);
  assert.equal(failure.statusCode, 503);
  assert.equal(failure.code, '503');
  assert.equal(failure.provider, 'Google');
  assert.equal(failure.generationId, 'gen-check-123');
  assert.equal(failure.retryable, true);
  assert.equal(normalizeAiProviderError(failure).message, failure.message);
  assert.ok(!JSON.stringify(failure).includes(key));
  assert.ok(!JSON.stringify(failure).includes('PRIVATE PROMPT'));
});

test('HTTP diagnostics preserve status and generation id through re-normalization', () => {
  const original = normalizeAiProviderError({ error: { message: 'Permission denied', code: 403 } }, { status: 403, generationId: 'gen-image-denied' });
  const failure = normalizeAiProviderError(original);
  assert.equal(failure.message, original.message);
  assert.equal(failure.statusCode, 403);
  assert.equal(failure.code, '403');
  assert.equal(failure.generationId, 'gen-image-denied');
  assert.equal(failure.retryable, false);
  assert.equal(failure.terminalImage, true);
});

test('only typed local image failures retain a terminal marker through normalization', () => {
  const local = new AiProviderError('Failed to fetch decoded image data', { code: 'image_conversion_failed', terminalImage: true, retryable: false });
  for (const failure of [normalizeAiProviderError(local), normalizeAiProviderError(normalizeAiProviderError(local))]) {
    assert.equal(failure.code, 'image_conversion_failed');
    assert.equal(failure.terminalImage, true);
    assert.equal(failure.retryable, false);
    assert.equal(failure.cancelled, false);
  }
  const transient = normalizeAiProviderError({ code: 503, message: 'Temporarily unavailable', terminalImage: true });
  assert.equal(transient.terminalImage, false, 'arbitrary provider payload flags are not local terminal markers');
  assert.equal(transient.retryable, true);
});

test('provider timeout wording is not local cancellation and survives re-normalization', () => {
  const failure = normalizeAiProviderError({ id: 'gen-google-timeout', error: {
    code: 504, message: 'JSON error injected into SSE stream',
    metadata: { provider_name: 'Google', raw: JSON.stringify({ error: { code: 504, message: 'The operation was aborted' } }) },
  } }, { status: 200 });
  for (const normalized of [failure, normalizeAiProviderError(failure)]) {
    assert.match(normalized.message, /\[Google\] The operation was aborted/);
    assert.equal(normalized.statusCode, 504);
    assert.equal(normalized.code, '504');
    assert.equal(normalized.provider, 'Google');
    assert.equal(normalized.generationId, 'gen-google-timeout');
    assert.equal(normalized.cancelled, false);
    assert.equal(normalized.retryable, true);
    assert.equal(normalized.terminalImage, false);
  }
  for (const status of [429, 502, 503, 504]) {
    const normalized = normalizeAiProviderError({ code: status, message: 'Provider cancelled the operation' });
    assert.equal(normalized.cancelled, false, String(status));
    assert.equal(normalized.retryable, true, String(status));
  }
});

test('explicit local aborts and cancellation without provider statuses remain cancelled', () => {
  for (const error of [
    new DOMException('The operation was aborted', 'AbortError'),
    new Error('Generation cancelled'),
    { name: 'AbortError', code: 504, message: 'The operation was aborted' },
    { cancelled: true, statusCode: 503, message: 'Cancelled locally' },
  ]) {
    const failure = normalizeAiProviderError(error);
    assert.equal(failure.cancelled, true);
    assert.equal(failure.retryable, false);
    assert.equal(failure.terminalImage, true);
    assert.equal(normalizeAiProviderError(failure).cancelled, true);
  }
});

test('only transient statuses and transport failures are retryable', () => {
  for (const status of [429, 502, 503, 504]) assert.equal(isRetryableAiProviderError({ code: status, message: 'Request failed' }), true, String(status));
  for (const status of [400, 401, 402, 403, 404, 422, 500]) assert.equal(isRetryableAiProviderError({ code: status, message: 'Request failed' }), false, String(status));
  assert.equal(isRetryableAiProviderError(new TypeError('Failed to fetch')), true);
  assert.equal(isRetryableAiProviderError(new TypeError('NetworkError when attempting to fetch resource.')), true);
  assert.equal(isRetryableAiProviderError(new Error('Upstream idle timeout exceeded')), true);
  assert.equal(isRetryableAiProviderError(new Error('The model returned malformed tool input')), false);
  assert.equal(isRetryableAiProviderError({ code: 502, message: 'Content policy moderation blocked the request' }), false);
  assert.equal(isTerminalImageError({ code: 502, message: 'Content policy moderation blocked the request' }), true);
  assert.equal(isRetryableAiProviderError({ code: 503, name: 'AbortError', message: 'Cancelled' }), false);
  assert.equal(isRetryableAiProviderError({ code: 502, message: 'Provider error', metadata: { raw: { error: { code: 403, message: 'Permission denied' } } } }), false);
  assert.equal(isRetryableAiProviderError({ code: 502, message: 'Permission denied' }), false);
  assert.equal(isTerminalImageError(new Error('Permission denied')), true);
  assert.equal(isRetryableAiProviderError({ code: 'content_policy_violation', message: 'Request blocked', statusCode: 502 }), false);
  assert.equal(isTerminalImageError({ code: 'content_filter', message: 'Request blocked' }), true);
  assert.equal(normalizeAiProviderError({ message: 'Request failed', responseHeaders: { 'x-generation-id': 'gen-header-id', authorization: 'PRIVATE KEY' } }).generationId, 'gen-header-id');
});

test('diagnostic extraction handles circular, huge and string-only errors within a fixed bound', () => {
  const circular = { message: 'A'.repeat(30000), metadata: { provider_name: 'P'.repeat(1000), raw: 'B'.repeat(30000) } };
  circular.cause = circular;
  const failure = normalizeAiProviderError(circular);
  assert.ok(failure.message.length <= 700);
  assert.ok(failure.provider.length <= 100);
  assert.equal(normalizeAiProviderError('Error from provider').message, 'Error from provider');
  assert.equal(normalizeAiProviderError(undefined).message, 'The AI provider request failed.');
  assert.ok(!normalizeAiProviderError('Bearer abc.def.token sk-or-v1-other-sensitive-secret').message.includes('abc.def.token'));
  assert.ok(!normalizeAiProviderError('Bearer abc.def.token sk-or-v1-other-sensitive-secret').message.includes('sk-or-v1'));
  const largePayload = { message: 'Provider failed', metadata: { raw: JSON.stringify({ request: { prompt: 'PRIVATE PROMPT'.repeat(3000) } }) } };
  assert.equal(normalizeAiProviderError(largePayload).message, 'Provider failed');
});

test('image API errors retain HTTP metadata and nested provider cause', async () => {
  await assert.rejects(generateImageWithOpenRouter({ apiKey: 'mock-secret', imageModel: 'google/gemini-3.1-flash-lite-image', prompt: 'Hero',
    fetchImpl: async () => Response.json({ error: { code: 403, message: 'Provider error', metadata: { provider_name: 'Google AI Studio', raw: { error: { message: 'Permission denied for mock-secret' } } } } }, { status: 403, headers: { 'X-Generation-Id': 'gen-image-403' } }),
  }), error => error instanceof AiProviderError && error.statusCode === 403 && error.provider === 'Google AI Studio' && error.generationId === 'gen-image-403' && error.message.includes('Permission denied for [redacted]') && !error.message.includes('mock-secret') && error.retryable === false);
});

test('a provider error inside a successful HTTP image response is still a failure', async () => {
  await assert.rejects(generateImageWithOpenRouter({ apiKey: 'mock-secret', imageModel: 'test/image', prompt: 'Hero',
    fetchImpl: async () => Response.json({ error: { code: 503, message: 'Temporarily unavailable' } }),
  }), error => error.statusCode === 503 && error.retryable === true && /Temporarily unavailable/.test(error.message));
});

test('terminal image failures are visible, block repeat paid requests across writer passes and retain completed assets', async () => {
  let files = { 'index.tpl': '@layout\n<h1>Page</h1>\n@endlayout' }, requests = 0;
  const events = [], bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
  const generateImage = async () => {
    if (++requests === 1) return bytes;
    throw normalizeAiProviderError({ error: { code: 403, message: 'Image endpoint permission denied' } }, { generationId: 'gen-denied' });
  };
  const makeTool = () => draftImageTool({ generateImage, getFiles: () => files, commit(next) { files = next; }, onProgress: event => events.push(event) });
  const first = makeTool();
  assert.equal((await first.execute({ path: 'images/completed.png', prompt: 'Completed', referenceIds: [] })).ok, true);
  assert.equal((await first.execute({ path: 'images/denied.png', prompt: 'Denied', referenceIds: [] })).ok, false);
  const second = makeTool();
  const repeat = await second.execute({ path: 'images/retry.png', prompt: 'Repeat denied request', referenceIds: [] });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.terminal, true);
  assert.equal(repeat.statusCode, 403);
  assert.equal(requests, 2, 'the revision cannot repeat a denied API call');
  assert.deepEqual(files['images/completed.png'], bytes);
  assert.equal(files['images/denied.png'], undefined);
  assert.equal(files['images/retry.png'], undefined);
  assert.equal(events.filter(event => event.type === 'image-error').length, 2);
  assert.equal(events.find(event => event.type === 'image-error').generationId, 'gen-denied');
  const nextRun = draftImageTool({ generateImage: async () => { requests++; return bytes; }, getFiles: () => files, commit(next) { files = next; } });
  assert.equal((await nextRun.execute({ path: 'images/next-run.png', prompt: 'New run', referenceIds: [] })).ok, true);
  assert.equal(requests, 3, 'the circuit only applies to the previous workflow run');
});

test('image transient failures do not open the terminal circuit, and cancellation never commits an image', async () => {
  let calls = 0, files = { 'index.tpl': '@layout\n<h1>Page</h1>\n@endlayout' };
  const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
  const tool = draftImageTool({ generateImage: async () => { if (++calls === 1) throw normalizeAiProviderError({ code: 503, message: 'Unavailable' }); return bytes; }, getFiles: () => files, commit(next) { files = next; } });
  const failed = await tool.execute({ path: 'images/hero.png', prompt: 'Hero', referenceIds: [] });
  assert.equal(failed.retryable, true);
  assert.equal(failed.terminal, false);
  assert.equal((await tool.execute({ path: 'images/hero.png', prompt: 'Hero', referenceIds: [] })).ok, true);
  const controller = new AbortController(), events = [];
  const cancelled = draftImageTool({ generateImage: async () => { controller.abort(); return bytes; }, signal: controller.signal, getFiles: () => files, commit(next) { files = next; }, onProgress: event => events.push(event) });
  await assert.rejects(cancelled.execute({ path: 'images/cancelled.png', prompt: 'Cancelled', referenceIds: [] }), error => error.cancelled === true && error.retryable === false);
  assert.equal(files['images/cancelled.png'], undefined);
  assert.equal(events.find(event => event.type === 'image-error').terminal, true);
});
