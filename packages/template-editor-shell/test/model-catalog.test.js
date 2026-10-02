import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_MODEL, OPENROUTER_MODELS_URL, cachedOpenRouterCatalog, catalogOptions, compactModel, loadOpenRouterCatalog, pricePerMillion, recentModels, rememberModel, resetOpenRouterCatalog } from '../src/model-catalog.js';

const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values }; };
const catalog = { data: [
  { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', context_length: 400000, pricing: { prompt: '0.00000025', completion: '0.000002' }, architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] }, supported_parameters: ['tools', 'tool_choice', 'reasoning'] },
  { id: 'meta-llama/llama-3-8b:free', name: 'Meta: Llama 3 8B (free)', context_length: 8192, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['temperature'] },
  { id: 'google/gemini-2.5-flash-image', name: 'Google: Nano Banana', context_length: 32768, pricing: { prompt: '0.0000003', completion: '0.0000025' }, architecture: { input_modalities: ['image', 'text'], output_modalities: ['image', 'text'] }, supported_parameters: ['temperature'] },
  { id: 'openai/gpt-4o-audio', name: 'GPT-4o Audio', top_provider: { context_length: 128000 }, pricing: { prompt: '-1', completion: 'x' }, architecture: { input_modalities: ['text', 'audio'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
  { name: 'no id' },
] };
const text = { t: value => value, language: 'ru' };

test('catalog entries map to ModelOption: names, prices per 1M, context, badges and the no-tools reason', () => {
  const models = catalog.data.map(compactModel).filter(Boolean);
  assert.equal(models.length, 4);
  const options = catalogOptions(models, 'text', text), byId = Object.fromEntries(options.map(option => [option.id, option]));
  assert.deepEqual(byId['openai/gpt-5-mini'], { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', contextLength: 400000, price: { input: '$0.25', output: '$2', unit: '/ 1M' }, badges: ['tools', 'vision', 'reasoning'] });
  assert.deepEqual(byId['meta-llama/llama-3-8b:free'].badges, ['free']);
  assert.equal(byId['meta-llama/llama-3-8b:free'].disabledReason, 'Не поддерживает инструменты — агент не сможет менять проект');
  assert.equal(byId['openai/gpt-4o-audio'].contextLength, 128000); assert.deepEqual(byId['openai/gpt-4o-audio'].badges, ['tools', 'audio']); assert.equal(byId['openai/gpt-4o-audio'].price, undefined, 'unknown or negative prices are omitted');
  assert.ok(byId['google/gemini-2.5-flash-image'], 'image models that also answer with text are text options');
  assert.equal(options[0].id, AUTO_MODEL, 'openrouter/auto stays an option'); assert.equal(options[0].disabledReason, undefined); assert.equal(options[0].group, 'OpenRouter');
  assert.deepEqual(catalogOptions(models, 'image', text).map(option => option.id), ['google/gemini-2.5-flash-image']);
  assert.equal(catalogOptions(models, 'image', text)[0].disabledReason, undefined, 'image models need no tools');
  const kept = catalogOptions(models, 'text', { ...text, current: 'private/model' });
  assert.deepEqual(kept[0], { id: 'private/model', name: 'private/model', description: 'Нет в каталоге OpenRouter' }, 'the saved value stays visible');
  assert.equal(catalogOptions(models, 'text', { t: value => value === 'Does not support tools — the agent cannot change the project' ? 'HOST' : value, language: 'uk' }).find(option => option.id === 'meta-llama/llama-3-8b:free').disabledReason, 'HOST', 'the host translator wins');
  assert.equal(pricePerMillion('0.000003'), '$3'); assert.equal(pricePerMillion('0.0000000375'), '$0.0375'); assert.equal(pricePerMillion(''), ''); assert.equal(pricePerMillion('0'), '$0');
});

test('the catalog is fetched once per session without credentials, cached for ten minutes, and failures are retried', async () => {
  resetOpenRouterCatalog();
  const storage = memory(), requests = []; let time = 1000, fail = true;
  const fetchImpl = async (url, init) => { requests.push([url, init]); if (fail) throw new TypeError('offline'); return new Response(JSON.stringify(catalog)); };
  await assert.rejects(loadOpenRouterCatalog({ fetchImpl, storage, now: () => time }), /offline/);
  fail = false;
  const [first, second] = await Promise.all([loadOpenRouterCatalog({ fetchImpl, storage, now: () => time }), loadOpenRouterCatalog({ fetchImpl, storage, now: () => time })]);
  assert.equal(requests.length, 2, 'concurrent callers share one request after the failed one'); assert.equal(first, second);
  assert.equal(requests[1][0], OPENROUTER_MODELS_URL); assert.equal(requests[1][1].credentials, 'omit'); assert.equal(requests[1][1].headers, undefined, 'no key is sent');
  resetOpenRouterCatalog();
  assert.equal((await loadOpenRouterCatalog({ fetchImpl, storage, now: () => time + 1000 })).length, 4); assert.equal(requests.length, 2, 'sessionStorage serves a new page within the TTL');
  assert.equal(cachedOpenRouterCatalog({ storage, now: () => time + 1000 }).length, 4);
  time += 11 * 60 * 1000; resetOpenRouterCatalog();
  assert.equal(cachedOpenRouterCatalog({ storage, now: () => time }), null);
  await loadOpenRouterCatalog({ fetchImpl, storage, now: () => time }); assert.equal(requests.length, 3, 'expired cache refetches');
  resetOpenRouterCatalog();
  await assert.rejects(loadOpenRouterCatalog({ fetchImpl: async () => new Response('{"data":{}}'), storage: memory(), now: () => time }), /empty/);
  await assert.rejects(loadOpenRouterCatalog({ fetchImpl: async () => new Response('no', { status: 503 }), storage: memory(), now: () => time }), /HTTP 503/);
  resetOpenRouterCatalog();
});

test('recent model ids are kept per kind, newest first, at most five', () => {
  const storage = memory();
  assert.deepEqual(recentModels('text', storage), []);
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) rememberModel('text', id, storage);
  rememberModel('image', 'img', storage); rememberModel('text', '', storage);
  assert.deepEqual(recentModels('text', storage), ['b', 'f', 'e', 'd', 'c']); assert.deepEqual(recentModels('image', storage), ['img']);
  storage.setItem('trafficops-ai-recent-models', '{broken'); assert.deepEqual(recentModels('text', storage), []);
});
