import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';
import { createAiDiagnosticFetch } from '../../packages/template-editor-shell/src/ai-request-diagnostics.js';
import { normalizeAiProviderError } from '../../packages/template-editor-shell/src/ai-provider-errors.js';

const encoder = new TextEncoder();
const request = { method: 'POST', headers: { Authorization: 'Bearer sk-or-v1-diagnostic-private' }, body: JSON.stringify({ model: 'google/gemini-3.8-flash', messages: [{ role: 'user', content: 'PRIVATE PROMPT' }] }) };
function fragmentedResponse(text, size = 1, headers = {}) {
  const bytes = typeof text === 'string' ? encoder.encode(text) : text;
  let position = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position === bytes.length) { controller.close(); return; }
    const end = Math.min(position + size, bytes.length);
    controller.enqueue(bytes.subarray(position, end)); position = end;
  } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/event-stream', ...headers } });
}

test('fragmented SSE preserves signed reasoning and framing exactly while reporting safe usage', async () => {
  const text = '\uFEFF: OPENROUTER PROCESSING\r\n\r\n' + String.raw`event: message
id: 7
data: { "id": "gen-success", "choices": [{"index":0,"delta":{"reasoning_details":[{"type":"reasoning.encrypted","data":"SIGNED+/==\\\"\u0142","format":"google-gemini-v1"}],"content":"Zażółć"}}] }

` + 'data: {"usage":{"prompt_tokens":123,"completion_tokens":45,"total_tokens":168,"private":"PRIVATE USAGE"},"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n' + 'data: [DONE]\n\n';
  const events = [], native = fragmentedResponse(text, 1, { 'X-Generation-Id': 'gen-header', 'X-Other': 'kept' });
  Object.defineProperty(native, 'url', { value: 'https://openrouter.ai/api/v1/chat/completions' });
  const fetch = createAiDiagnosticFetch(async (input, options) => { assert.equal(input, native.url); assert.equal(options, request); return native; }, { onProgress: event => events.push(event), apiKey: 'sk-or-v1-diagnostic-private' });
  const response = await fetch(native.url, request);
  assert.equal(events.length, 1, 'the wrapper does not eagerly consume the response');
  assert.equal(response.url, native.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Other'), 'kept');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), encoder.encode(text));
  assert.equal(events[0].type, 'request-start');
  assert.equal(events[0].requestId, 1);
  assert.equal(events[0].request, 1);
  assert.equal(events[0].model, 'google/gemini-3.8-flash');
  assert.equal(events[0].requestBytes, encoder.encode(request.body).byteLength);
  assert.deepEqual(events[1].usage, { inputTokens: 123, outputTokens: 45, totalTokens: 168 });
  assert.equal(events[1].generationId, 'gen-header');
  assert.equal(events[1].outcome, 'complete');
  assert.ok(events[1].seconds >= 0);
  for (const secret of ['PRIVATE PROMPT', 'PRIVATE USAGE', 'Authorization', 'sk-or-v1-diagnostic-private', 'SIGNED']) assert.ok(!JSON.stringify(events).includes(secret));
});

test('nested Google SSE errors are normalized before adapter consumption without changing other JSON fields', async () => {
  const apiKey = 'sk-or-v1-diagnostic-private', outer = 'JSON error injected into SSE stream';
  const payload = { id: 'gen-google-error', choices: [{ index: 0, delta: { content: outer, reasoning_details: [{ type: 'reasoning.encrypted', data: 'keep-signed-bytes\\/==', format: 'google-gemini-v1' }] }, finish_reason: 'error' }], error: { code: 502, message: outer, metadata: { provider_name: 'Google AI Studio', raw: JSON.stringify({ error: { code: 503, message: `Provider overloaded ${apiKey}` } }) } } };
  const text = 'event: message\r\n' + `data: ${JSON.stringify(payload).replace(',"error":', ',\r\ndata: "error":')}\r\n\r\n` + 'data: [DONE]\r\n\r\n';
  const events = [], fetch = createAiDiagnosticFetch(async () => fragmentedResponse(text, 1), { apiKey, onProgress: event => events.push(event) });
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', request);
  const actual = await response.text(), failure = normalizeAiProviderError(payload, { apiKey, status: 200, generationId: payload.id });
  const needle = `"message":${JSON.stringify(outer)}`;
  assert.equal(actual, text.replace(needle, `"message":${JSON.stringify(failure.message)}`), 'only the error.message token changes');
  assert.equal(events[1].generationId, 'gen-google-error');
  assert.equal(events[1].status, 200);
  assert.equal(events[1].statusCode, 503);
  assert.equal(events[1].provider, 'Google AI Studio');
  assert.equal(events[1].retryable, true);
  assert.match(events[1].error, /Provider overloaded \[redacted\]/);
  assert.ok(!JSON.stringify(events).includes(apiKey));
});

test('the actual OpenRouter adapter receives the nested provider reason after diagnostic rewriting', async () => {
  const events = [];
  const payload = { error: { code: 503, message: 'JSON error injected into SSE stream', metadata: { provider_name: 'Google', raw: { error: { message: 'Google temporarily overloaded' } } } }, choices: [{ index: 0, delta: {}, finish_reason: 'error' }] };
  const provider = createOpenRouter({ apiKey: 'test-key', fetch: createAiDiagnosticFetch(async () => fragmentedResponse(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, 3), { apiKey: 'test-key', onProgress: event => events.push(event) }) });
  const result = streamText({ model: provider.chat('google/gemini-3.8-flash'), prompt: 'Test', maxRetries: 0, onError() {} });
  const streamEvents = [];
  for await (const event of result.fullStream) streamEvents.push(event);
  const failure = streamEvents.find(event => event.type === 'error');
  assert.match(failure.error.message, /\[Google\] Google temporarily overloaded/);
  assert.equal(events.find(event => event.type === 'request-finished').retryable, true);
});

test('SSE passthrough preserves invalid UTF-8 comments and final events without a delimiter', async () => {
  const prefix = new Uint8Array([58, 32, 255, 13, 10, 13, 10]), final = encoder.encode('data: {"choices":[{"delta":{"content":"Done"}}]}');
  const bytes = new Uint8Array(prefix.length + final.length); bytes.set(prefix); bytes.set(final, prefix.length);
  const fetch = createAiDiagnosticFetch(async () => fragmentedResponse(bytes, 1));
  assert.deepEqual(new Uint8Array(await (await fetch('https://openrouter.ai/api/v1/chat/completions', request)).arrayBuffer()), bytes);
});

test('stream cancellation propagates to the upstream reader and reports a single cancelled request', async () => {
  let reads = 0, cancelled;
  const events = [];
  const native = new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"chunk ${reads}"}}]}\n\n`)); },
    cancel(reason) { cancelled = reason; },
  }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/event-stream' } });
  const fetch = createAiDiagnosticFetch(async () => native, { onProgress: event => events.push(event) });
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', request);
  assert.equal(reads, 0, 'fetch wrapper itself does not pull the upstream stream');
  const reader = response.body.getReader();
  await reader.read();
  assert.equal(reads, 1, 'consuming one event does not drain subsequent events');
  await reader.cancel('user cancelled');
  assert.equal(cancelled, 'user cancelled');
  assert.equal(events.filter(event => event.type === 'request-finished').length, 1);
  assert.equal(events.at(-1).outcome, 'cancelled');
});

test('HTTP JSON responses retain their bytes and rejected fetches report safe errors', async () => {
  const events = [], text = '{ "error": {"code":429,"message":"Rate limited"} }';
  const fetch = createAiDiagnosticFetch(async () => new Response(text, { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } }), { onProgress: event => events.push(event) });
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', request);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '2');
  assert.equal(await response.text(), text);
  assert.equal(events[1].outcome, 'error');
  assert.equal(events[1].retryable, true);
  assert.equal(events[1].error, 'Rate limited');
  const error = new TypeError('Failed to fetch sk-or-v1-diagnostic-private');
  const rejected = createAiDiagnosticFetch(async () => { throw error; }, { apiKey: 'sk-or-v1-diagnostic-private', onProgress: event => events.push(event) });
  await assert.rejects(rejected('https://openrouter.ai/api/v1/chat/completions', request), failure => failure === error);
  assert.equal(events.at(-1).retryable, true);
  assert.ok(!JSON.stringify(events).includes('sk-or-v1-diagnostic-private'));
});

test('SSE and bounded JSON diagnostics report reasoning tokens but do not inspect successful image payloads', async () => {
  const events = [], usage = { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33, completion_tokens_details: { reasoning_tokens: 7 } };
  const fetch = createAiDiagnosticFetch(async () => Response.json({ choices: [], usage }), { onProgress: event => events.push(event) });
  await (await fetch('https://openrouter.ai/api/v1/chat/completions', request)).text();
  assert.deepEqual(events[1].usage, { inputTokens: 11, outputTokens: 22, totalTokens: 33, reasoningTokens: 7 });
  const sse = createAiDiagnosticFetch(async () => fragmentedResponse(`data: ${JSON.stringify({ usage })}\n\n`), { onProgress: event => events.push(event) });
  await (await sse('https://openrouter.ai/api/v1/chat/completions', request)).text();
  assert.equal(events.at(-1).usage.reasoningTokens, 7);
  const image = createAiDiagnosticFetch(async () => Response.json({ data: [{ b64_json: 'BASE64 PRIVATE IMAGE'.repeat(10000) }], usage }), { onProgress: event => events.push(event) });
  const imageResponse = await image('https://openrouter.ai/api/v1/images', request);
  const payload = await imageResponse.json();
  assert.equal(payload.data[0].b64_json.length, 200000);
  assert.equal(events.at(-1).usage, undefined, 'image bytes are not copied or parsed for diagnostics');
  assert.ok(!JSON.stringify(events).includes('BASE64'));
});
