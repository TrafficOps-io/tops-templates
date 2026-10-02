import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { normalizeGeneratedImagePng } from '../../packages/template-editor-shell/src/generated-image-png.js';
import { AiProviderError } from '../../packages/template-editor-shell/src/ai-provider-errors.js';
import { runStudioAiWorkflow } from '../../packages/template-editor-shell/src/studio-ai-workflow.js';
import { parseProject, getDefaults } from '@trafficops/template-runtime';
import { starterProject } from '../src/starter.js';
import { validateDraft } from './support/ai-validator.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
const call = (name, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: name, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] });
const done = () => ({ content: [{ type: 'text', text: 'Done.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
const plan = () => call('submit_plan', { summary: 'Generate one article image.', tasks: ['Generate one image', 'Update the headline'], imageRequests: ['Generate one article image'] });
const review = () => call('submit_review', { approved: true, summary: 'Reviewed the draft.', issues: [] });
const setup = () => { const files = starterProject(); const { definition } = parseProject(files); return { files, definition, values: getDefaults(definition) }; };

test('valid PNG provider output passes through without changing bytes or file identity', async () => {
  const file = new File([bytes], 'generated.png', { type: 'image/png' });
  assert.equal(await normalizeGeneratedImagePng(file), file);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test('unsupported, mismatched, empty and oversized images are permanent local failures', async () => {
  for (const file of [
    new File([bytes], 'vector.svg', { type: 'image/svg+xml' }),
    new File([bytes], 'wrong.jpeg', { type: 'image/jpeg' }),
    new File([], 'empty.png', { type: 'image/png' }),
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
  ]) await assert.rejects(normalizeGeneratedImagePng(file), error => error instanceof AiProviderError && error.code === 'image_conversion_failed' && error.terminalImage === true && error.retryable === false);
});

test('PNG passthrough requires complete chunk framing and bounded dimensions without a native decoder', async () => {
  const oversized = bytes.slice(), view = new DataView(oversized.buffer);
  view.setUint32(16, 4097); view.setUint32(20, 4097);
  const zeroWidth = bytes.slice(); new DataView(zeroWidth.buffer).setUint32(16, 0);
  for (const content of [bytes.slice(0, 8), bytes.slice(0, 32), bytes.slice(0, -1), oversized, zeroWidth]) {
    await assert.rejects(normalizeGeneratedImagePng(new File([content], 'invalid.png', { type: 'image/png' })), error => error instanceof AiProviderError && error.terminalImage === true && error.retryable === false);
  }
});

test('local abort remains an abort before conversion and after image header reading', async () => {
  const first = new AbortController(); first.abort();
  await assert.rejects(normalizeGeneratedImagePng(new File([bytes], 'image.png', { type: 'image/png' }), { signal: first.signal }), { name: 'AbortError' });
  const second = new AbortController(), file = new File([bytes], 'image.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => { second.abort(); return bytes.buffer; } });
  await assert.rejects(normalizeGeneratedImagePng(file, { signal: second.signal }), { name: 'AbortError' });
});

for (const [name, payload, code] of [
  ['conversion', { data: [{ media_type: 'image/png', b64_json: btoa('not valid image bytes') }] }, 'image_conversion_failed'],
  ['API format', { data: [{ media_type: 'image/svg+xml', b64_json: btoa('<svg></svg>') }] }, 'image_format_failed'],
]) test(`permanent ${name} failure prevents repeated paid image calls in the real ToolLoop workflow`, async () => {
  const initial = setup(), events = [];
  let requests = 0;
  const model = new MockLanguageModelV4({ doGenerate: [plan(),
    ...['images/article.png', 'images/retry.png', 'images/third.png'].map(path => call('generate_image', { path, prompt: 'One article image', referenceIds: [] })),
    call('set_values', { values: { headline: 'Completed content is retained' } }), done(), review(),
  ] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Generate exactly one article image and update the headline.', generateImages: true, apiKey: 'fake', imageModel: 'test/image', languageModel: model, validateDraft, onProgress: event => events.push(event), fetchImpl: async () => { requests++; return Response.json(payload); } });
  assert.equal(requests, 1, 'retry tool calls cannot repeat a permanently failed paid image request');
  assert.equal(result.valid, false);
  assert.equal(result.imageFailure.code, code);
  assert.equal(result.imageFailure.terminal, true);
  assert.equal(result.values.headline, 'Completed content is retained');
  assert.equal(Object.keys(result.files).some(path => /^images\/(?:article|retry|third)\.png$/.test(path)), false);
  assert.equal(events.filter(event => event.type === 'image-error').length, 3);
  assert.notEqual(initial.values.headline, result.values.headline);
});

test('a transient image provider error still permits the next image tool call', async () => {
  const initial = setup(); let requests = 0;
  const model = new MockLanguageModelV4({ doGenerate: [plan(),
    call('generate_image', { path: 'images/article.png', prompt: 'Article image', referenceIds: [] }),
    call('generate_image', { path: 'images/article.png', prompt: 'Article image', referenceIds: [] }),
    call('set_values', { values: { image: 'images/article.png', headline: 'Updated content' } }), done(), review(),
  ] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Generate one image.', generateImages: true, apiKey: 'fake', imageModel: 'test/image', languageModel: model, validateDraft, fetchImpl: async () => ++requests === 1 ? Response.json({ error: { code: 503, message: 'Temporarily unavailable' } }, { status: 503 }) : Response.json({ data: [{ media_type: 'image/png', b64_json: png }] }) });
  assert.equal(requests, 2);
  assert.equal(result.valid, true);
  assert.equal(result.imageFailure, undefined);
  assert.deepEqual(result.files['images/article.png'], bytes);
});
