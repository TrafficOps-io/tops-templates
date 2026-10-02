import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODEL_FILTERS, RECENT_LIMIT, availableFilters, buildModelSections, developerName, filterModels, formatContextLength, matchesQuery, modelGroup, modelRows, showsInherit, stepRow } from '../src/primitives/model-picker.js';

const models = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', contextLength: 128000, badges: ['tools', 'vision'] },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1048576, badges: ['tools', 'vision', 'audio', 'reasoning'], description: 'Fast multimodal' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', badges: ['tools', 'free'] },
  { id: 'openai/o3', name: 'o3', badges: ['tools', 'reasoning'] },
  { id: 'mistralai/mistral-7b', name: 'Mistral 7B', badges: [], disabledReason: 'Does not support tools' },
  { id: 'local-model', name: 'Local', provider: 'Ollama' },
];

test('formatContextLength: K under a million, M with one decimal unless whole', () => {
  assert.equal(formatContextLength(950), '950');
  assert.equal(formatContextLength(8192), '8K');
  assert.equal(formatContextLength(32768), '33K');
  assert.equal(formatContextLength(128000), '128K');
  assert.equal(formatContextLength(131072), '131K');
  assert.equal(formatContextLength(999_600), '1M', 'rounding into a million');
  assert.equal(formatContextLength(1_000_000), '1M');
  assert.equal(formatContextLength(1_048_576), '1M');
  assert.equal(formatContextLength(1_500_000), '1.5M');
  assert.equal(formatContextLength(2_097_152), '2M');
  assert.equal(formatContextLength(10_000_000), '10M');
  for (const value of [0, -1, undefined, null, NaN, '128000']) assert.equal(formatContextLength(value), '', String(value));
});

test('developer names come from the id prefix; group falls back to provider and Other', () => {
  assert.equal(developerName('openai/gpt-4o'), 'OpenAI');
  assert.equal(developerName('meta-llama/llama'), 'Meta');
  assert.equal(developerName('x-ai/grok'), 'xAI');
  assert.equal(developerName('acme-labs/model'), 'Acme Labs', 'unknown prefixes are capitalised');
  assert.equal(developerName('local-model'), '');
  assert.equal(modelGroup({ id: 'openai/gpt', group: 'Custom' }), 'Custom', 'group wins');
  assert.equal(modelGroup({ id: 'local-model', provider: 'Ollama' }), 'Ollama');
  assert.equal(modelGroup({ id: 'local-model' }), 'Other');
});

test('search matches every word across name, id, developer and description', () => {
  assert.equal(matchesQuery(models[1], 'gemini flash'), true);
  assert.equal(matchesQuery(models[1], 'GOOGLE multimodal'), true, 'case-insensitive, description');
  assert.equal(matchesQuery(models[0], 'openai mini'), true, 'developer name');
  assert.equal(matchesQuery(models[0], 'gemini'), false);
  assert.equal(matchesQuery(models[0], '  '), true, 'empty query');
  assert.deepEqual(filterModels(models, { query: 'openai' }).map(model => model.id), ['openai/gpt-4o-mini', 'openai/o3']);
});

test('filters require every badge; chips only for badges some option has', () => {
  assert.deepEqual(filterModels(models, { filters: ['free'] }).map(model => model.id), ['meta-llama/llama-3.3-70b-instruct:free']);
  assert.deepEqual(filterModels(models, { filters: ['tools', 'vision'] }).map(model => model.id), ['openai/gpt-4o-mini', 'google/gemini-2.5-flash']);
  assert.deepEqual(filterModels(models, { query: 'llama', filters: ['vision'] }), []);
  assert.deepEqual(MODEL_FILTERS, ['tools', 'vision', 'audio', 'free']);
  assert.deepEqual(availableFilters(models), ['tools', 'vision', 'audio', 'free']);
  assert.deepEqual(availableFilters([models[0]]), ['tools', 'vision']);
  assert.deepEqual(availableFilters(undefined), []);
});

test('sections: Recent (up to five) and Recommended without a query, All grouped by developer', () => {
  const { sections, total, hidden } = buildModelSections(models, { recentIds: ['openai/o3', 'missing', 'openai/o3'], recommendedIds: ['google/gemini-2.5-flash'] });
  assert.deepEqual(sections.map(section => section.key), ['recent', 'recommended', 'all']);
  assert.deepEqual(sections[0].groups[0].items.map(model => model.id), ['openai/o3'], 'unknown and repeated ids are skipped');
  assert.deepEqual(sections[2].groups.map(group => group.label), ['OpenAI', 'Google', 'Meta', 'Mistral', 'Ollama'], 'groups in order of first appearance');
  assert.deepEqual(sections[2].groups[0].items.map(model => model.id), ['openai/gpt-4o-mini', 'openai/o3']);
  assert.equal(total, models.length); assert.equal(hidden, 0);
  const many = Array.from({ length: 9 }, (_, index) => ({ id: `openai/m${index}`, name: `M${index}` }));
  assert.equal(buildModelSections(many, { recentIds: many.map(model => model.id) }).sections[0].groups[0].items.length, RECENT_LIMIT);
});

test('a query hides Recent and Recommended; filters apply to every section; limit caps All', () => {
  const searched = buildModelSections(models, { query: 'gemini', recentIds: ['google/gemini-2.5-flash'], recommendedIds: ['google/gemini-2.5-flash'] });
  assert.deepEqual(searched.sections.map(section => section.key), ['all']);
  const filtered = buildModelSections(models, { filters: ['free'], recentIds: ['openai/o3'], recommendedIds: ['meta-llama/llama-3.3-70b-instruct:free'] });
  assert.deepEqual(filtered.sections.map(section => section.key), ['recommended', 'all'], 'a recent model without the badge is filtered out');
  const big = Array.from({ length: 450 }, (_, index) => ({ id: `qwen/m${index}`, name: `Q${index}` }));
  const capped = buildModelSections(big, { limit: 200 });
  assert.equal(capped.sections[0].groups[0].items.length, 200);
  assert.equal(capped.total, 450); assert.equal(capped.hidden, 250);
  assert.deepEqual(buildModelSections([], {}).sections, []);
  assert.deepEqual(buildModelSections(models, { query: 'nothing-like-this' }), { sections: [], total: 0, hidden: 0 });
});

test('rows: inherit first, then every rendered option keyed by section; disabled rows marked; ↑↓ wrap', () => {
  const { sections } = buildModelSections(models, { recentIds: ['openai/o3'] });
  const rows = modelRows(sections, true);
  assert.equal(rows[0].key, 'inherit'); assert.equal(rows[0].option, null);
  assert.equal(rows[1].key, 'recent:openai/o3');
  assert.ok(rows.some(row => row.key === 'all:openai/o3'), 'an option may appear in Recent and in All');
  assert.equal(rows.find(row => row.option?.id === 'mistralai/mistral-7b').disabled, true);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length, 'keys are unique');
  assert.equal(stepRow(rows, 0, 1), 1);
  assert.equal(stepRow(rows, rows.length - 1, 1), 0, 'wraps forward');
  assert.equal(stepRow(rows, 0, -1), rows.length - 1, 'wraps back');
  assert.equal(stepRow(rows, -1, 1), 0, 'from nothing down to the first');
  assert.equal(stepRow(rows, -1, -1), rows.length - 1, 'from nothing up to the last');
  assert.equal(stepRow([], 0, 1), -1);
});

test('the inherit row hides only for a query that matches neither its label nor its detail', () => {
  const inherit = { label: 'As in global settings', detail: 'Gemini Flash' };
  assert.equal(showsInherit(inherit, ''), true);
  assert.equal(showsInherit(inherit, 'gemini'), true);
  assert.equal(showsInherit(inherit, 'global'), true);
  assert.equal(showsInherit(inherit, 'gpt'), false);
  assert.equal(showsInherit(undefined, ''), false);
});

test('ModelPicker is an accessible combobox + listbox exported from primitives', () => {
  const source = readFileSync(new URL('../src/primitives/ModelPicker.jsx', import.meta.url), 'utf8');
  for (const token of ['role="listbox"', 'role="option"', 'aria-selected', 'aria-disabled', 'aria-activedescendant', 'role="combobox"', 'aria-haspopup="listbox"', 'aria-expanded', 'autoFocus', "'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'", 'createPortal', 'portalContainer', 'aria-pressed']) assert.ok(source.includes(token), token);
  assert.match(readFileSync(new URL('../src/primitives/index.js', import.meta.url), 'utf8'), /\bModelPicker\b/);
});
