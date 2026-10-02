import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP_MESSAGES, retryNotice, stepCard, stepText } from '../src/agent-steps.js';
import { runToParts, runToState } from '../src/chat-cards.js';

const identity = text => text;

test('step cards carry human-readable Russian, Ukrainian and English labels', () => {
  assert.deepEqual(stepCard({ id: 'a', tool: 'read_file', path: 'index.tpl', status: 'done' }, { t: identity, language: 'ru' }), { type: 'step', label: 'Читаю index.tpl', status: 'done' });
  assert.deepEqual(stepCard({ id: 'b', tool: 'edit_file', path: 'styles.css', status: 'running' }, { language: 'ru' }), { type: 'step', label: 'Правлю styles.css', status: 'running' });
  assert.equal(stepCard({ id: 'c', tool: 'validate_draft', status: 'done' }, { language: 'ru' }).label, 'Проверяю черновик');
  assert.deepEqual(stepCard({ id: 'd', tool: 'review_draft', status: 'running' }, { language: 'ru' }), { type: 'step', label: 'Подагент review: проверка черновика', status: 'running', agent: 'reviewer' });
  assert.equal(stepCard({ id: 'e', tool: 'set_values', fields: 'title, cta', status: 'done' }, { language: 'uk' }).label, 'Змінюю поля: title, cta');
  assert.deepEqual(stepCard({ id: 'f', tool: 'patch_file', path: 'index.tpl', status: 'error', detail: 'Search must match exactly once.' }, { language: 'en' }),
    { type: 'step', label: 'Editing index.tpl', status: 'error', detail: 'Search must match exactly once.' });
  assert.equal(stepCard({ id: 'g', tool: 'unknown_tool', status: 'done' }).label, 'Using a tool');
});

test('a host translation wins over the shell dictionary; every key has both translations', () => {
  const t = (text, values = {}) => text === 'Reading {path}' ? `HOST ${values.path}` : text.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  assert.equal(stepText('Reading {path}', { path: 'a.css' }, { t, language: 'ru' }), 'HOST a.css');
  assert.equal(stepText('Checking the draft', {}, { t, language: 'ru' }), 'Проверяю черновик');
  for (const [key, [ru, uk]] of Object.entries(STEP_MESSAGES)) {
    assert.ok(ru && uk, key);
    assert.deepEqual(ru.match(/\{\w+\}/g) || [], key.match(/\{\w+\}/g) || [], key);
    assert.deepEqual(uk.match(/\{\w+\}/g) || [], key.match(/\{\w+\}/g) || [], key);
  }
});

test('runs expose persisted steps as step cards, and a retry wait as the status message', () => {
  const run = { id: 'r1', state: 'running', phase: 'generate', locale: 'en', base: { files: {}, translations: { en: {} } }, steps: [{ id: 'call-1', tool: 'read_file', path: 'index.tpl', status: 'done' }],
    notice: { kind: 'retry', statusCode: 429, attempt: 2, maxAttempts: 3, delayMs: 3000 } };
  assert.deepEqual(runToParts(run, identity, 'ru'), [{ type: 'tool-call', toolCallId: 'r1:step:call-1', toolName: 'step', result: { type: 'step', label: 'Читаю index.tpl', status: 'done' } }]);
  assert.deepEqual(runToState(run, identity, 'ru'), { id: 'r1', status: 'running', message: 'Провайдер перегружен (429), повтор 2 из 3 через 3 с' });
  assert.equal(retryNotice(run.notice), 'Provider is busy (429), retry 2 of 3 in 3 s');
  assert.equal(runToState({ ...run, notice: undefined }, identity).message, 'Working…');
  // While a run is active its text streams: no placeholder text hides the streamed segments.
  assert.equal(runToParts({ ...run, checkpoint: { files: { 'a.css': 'x' }, values: {} } }, identity).some(part => part.type === 'text'), false);
});
