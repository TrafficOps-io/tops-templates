import { validateDraft } from './support/ai-validator.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { parseStructuredContent, projectFromAiResponse, requestOpenRouter, valuesFromAiResponse, valuesSchema } from '@trafficops/template-editor-shell/openrouter-ai';
import { normalizeOpenRouterSettings } from '../src/openrouter-settings.js';
import { starterProject } from '../src/starter.js';

test('structured AI content accepts JSON and a defensive fenced fallback', () => {
  assert.deepEqual(parseStructuredContent('{"value":1}'), { value: 1 });
  assert.deepEqual(parseStructuredContent('```json\n{"value":2}\n```'), { value: 2 });
  assert.throws(() => parseStructuredContent('not json'), /invalid structured JSON/);
  assert.throws(() => parseStructuredContent('[]'), /JSON object/);
});

test('generated AI projects cross the ordinary path, parser and renderer boundaries', async () => {
  const original = starterProject(true);
  const files = await projectFromAiResponse({ files: Object.entries(original).map(([path, content]) => ({ path, content })) }, validateDraft);
  const parsed = parseProject(files);
  assert.match(generateProject(files, getDefaults(parsed.definition))['index.html'], /Your next idea/);
  await assert.rejects(() => projectFromAiResponse({ files: [{ path: '../escape.tpl', content: 'x' }] }, validateDraft), /Unsafe/);
  await assert.rejects(() => projectFromAiResponse({ files: [{ path: 'index.png', content: 'fake' }] }, validateDraft), /non-text/);
  await assert.rejects(() => projectFromAiResponse({ files: [{ path: 'notes.md', content: 'No template' }] }, validateDraft), /\.tpl/);
});

test('content schema mirrors field types and generated values are runtime-validated', async () => {
  const files = starterProject();
  const { definition } = parseProject(files);
  const schema = valuesSchema(definition);
  assert.equal(schema.properties.values.properties.showNote.type, 'boolean');
  assert.equal(schema.properties.values.properties.accent.type, 'string');
  const values = { ...getDefaults(definition), headline: 'A generated headline', showNote: false };
  assert.equal((await valuesFromAiResponse({ values }, definition, files, validateDraft)).headline, 'A generated headline');
  await assert.rejects(() => valuesFromAiResponse({ values: { ...values, showNote: 'no' } }, definition, files, validateDraft), /boolean/);
});

test('OpenRouter requests use BYOK, strict JSON schema and privacy-aware routing', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content: '{"answer":"ok"}' } }], usage: { total_tokens: 12 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await requestOpenRouter({
    apiKey: 'sk-or-test-secret', model: 'test/model', messages: [{ role: 'user', content: 'hello' }],
    schemaName: 'answer', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
    maxTokens: 100, fetchImpl,
  });
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-or-test-secret');
  assert.equal(request.body.response_format.type, 'json_schema');
  assert.equal(request.body.response_format.json_schema.strict, true);
  assert.deepEqual(request.body.provider, { require_parameters: true, data_collection: 'deny' });
  assert.equal(result.data.answer, 'ok');
  assert.equal(result.model, 'test/model');

  await assert.rejects(() => requestOpenRouter({
    apiKey: 'sk-or-test-secret', model: 'test/model', messages: [], schemaName: 'answer', schema: {}, maxTokens: 1,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Rejected sk-or-test-secret' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
  }), error => error.message.includes('[redacted]') && !error.message.includes('sk-or-test-secret'));
});

test('OpenRouter retries locally validated JSON when an endpoint rejects strict schema parameters', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) return new Response(JSON.stringify({ error: { message: 'No endpoints found that can handle the requested parameters.' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content: '```json\n{"answer":"ok"}\n```' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await requestOpenRouter({
    apiKey: 'sk-or-test-secret', model: 'test/model', messages: [{ role: 'user', content: 'hello' }],
    schemaName: 'answer', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
    maxTokens: 100, fetchImpl,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, 'json_schema');
  assert.equal('response_format' in requests[1], false);
  assert.deepEqual(requests[1].provider, { data_collection: 'deny' });
  assert.equal(result.compatibilityFallback, true);
  assert.equal(result.data.answer, 'ok');
});

test('OpenRouter settings normalize to a stable local model default', () => {
  assert.deepEqual(normalizeOpenRouterSettings(), { apiKey: '', model: 'openrouter/auto', imageModel: '' });
  assert.deepEqual(normalizeOpenRouterSettings({ apiKey: '  secret  ', model: '  vendor/model  ' }), { apiKey: 'secret', model: 'vendor/model', imageModel: '' });
});
