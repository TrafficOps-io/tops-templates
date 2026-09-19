import test from 'node:test';
import assert from 'node:assert/strict';
import { localeActions } from '../src/locale-actions.js';
import { versionsModel } from '../src/versions-model.js';
import { createAiDraftValidator } from '../src/validate-ai-draft.js';

test('language mutations respect the primary language, ten-language limit and lock', () => {
  const primary = localeActions({ locales: ['en', 'uk'], value: 'en', defaultLocale: 'en' });
  assert.equal(primary.showRemove, false); assert.equal(primary.showMakeDefault, false); assert.equal(primary.canAdd, true);
  const locked = localeActions({ locales: ['en', 'uk'], value: 'uk', defaultLocale: 'en', disabled: true });
  assert.equal(locked.showRemove, true); assert.equal(locked.canMutate, false); assert.equal(locked.canAdd, false);
  assert.equal(localeActions({ locales: Array(10).fill('en'), value: 'en', defaultLocale: 'en' }).canAdd, false);
});

test('version segments preserve counts, host labels, current badges and empty states', () => {
  const empty = { title: 'No publications', description: 'Publish to start' };
  const groups = [{ id: 'published', label: 'Publications', count: 0, rows: [], empty }, { id: 'drafts', label: 'Drafts', count: 1, rows: [{ id: 'r7', title: 'Draft 7', badge: 'Current', meta: ['today'] }], empty }];
  assert.deepEqual(versionsModel(groups, 'published').empty, empty);
  assert.equal(versionsModel(groups, 'missing').selected.id, 'drafts');
  assert.equal(versionsModel(groups, '').selected.id, 'drafts');
  const draft = versionsModel(groups, 'drafts'); assert.equal(draft.rows[0].badge, 'Current'); assert.equal(draft.segments[1].count, 1); assert.equal(draft.empty, null);
  assert.equal(versionsModel([], '').selected, null);
});

test('AI validation follows the supplied host and never bypasses host policy with a local compiler', async () => {
  const state = { locale: 'uk', entrypoint: 'custom.html', translations: { uk: {} } }, calls = [];
  const analyzer = { async analyze(value, options) { calls.push({ value, options }); return { definition: null, entrypoint: 'custom.html', sourceDiagnostics: [{ file: 'custom.tpl.php', line: 1, message: 'Host policy rejected this source.' }], diagnostics: [] }; }, async render() { assert.fail('Rejected source must never render'); } };
  const controller = new AbortController(), validate = createAiDraftValidator(analyzer, () => state);
  await assert.rejects(validate({ files: { 'custom.tpl.php': '<?php echo 1;' }, signal: controller.signal }), error => error.code === 'validation' && error.sourceDiagnostics[0].file === 'custom.tpl.php');
  assert.equal(calls[0].options.signal, controller.signal); assert.equal(calls[0].value.locale, 'uk');
});
