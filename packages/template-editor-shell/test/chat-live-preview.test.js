import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { liveDraftPreview } from '../src/chat-live-preview.js';

const checkpoint = { files: { 'index.tpl': '<h1>Live</h1>', 'second.html': '<h1>Second</h1>' }, values: { title: 'Live' } };

test('a working run previews its completed checkpoint; no checkpoint, no preview', () => {
  assert.deepEqual(liveDraftPreview({ id: 'r1', state: 'running', locale: 'en', checkpoint }, ''),
    { kind: 'show', runId: 'r1', draft: { ...checkpoint, locale: 'en', runId: 'r1' } });
  assert.deepEqual(liveDraftPreview({ id: 'r1', state: 'running', locale: 'en' }, ''), { kind: 'none' });
  assert.deepEqual(liveDraftPreview({ id: 'r1', state: 'queued', locale: 'en', checkpoint: { files: {} } }, '').draft.values, {});
  assert.deepEqual(liveDraftPreview(null, ''), { kind: 'none' });
});

test('a ready run keeps its final draft; a stopped, failed or other run returns the preview to the project', () => {
  const result = { files: { 'index.tpl': '<h1>Final</h1>' }, values: {} };
  assert.deepEqual(liveDraftPreview({ id: 'r1', state: 'ready', locale: 'en', checkpoint, result }, 'r1'),
    { kind: 'show', runId: 'r1', draft: { ...result, locale: 'en', runId: 'r1' } });
  for (const state of ['cancelled', 'failed', 'interrupted', 'discarded', 'applied'])
    assert.deepEqual(liveDraftPreview({ id: 'r1', state, checkpoint }, 'r1'), { kind: 'clear' }, state);
  assert.deepEqual(liveDraftPreview({ id: 'r2', state: 'ready', checkpoint }, 'r1'), { kind: 'clear' }, 'another conversation selected');
  assert.deepEqual(liveDraftPreview(null, 'r1'), { kind: 'clear' });
  assert.deepEqual(liveDraftPreview({ id: 'r1', state: 'ready', result }, ''), { kind: 'none' }, 'an untracked ready run is previewed only on request');
});

test('EditorShell wires the live preview and disables "Make entry page" while a conversation draft is previewed', async () => {
  const shell = await readFile(new URL('../src/EditorShell.jsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/PreviewPanel.jsx', import.meta.url), 'utf8');
  const ast = parse(shell, { sourceType: 'module', plugins: ['jsx'] });
  let entryDisabled;
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement' && node.name.name === 'PreviewPanel')
      entryDisabled = node.attributes.find(attribute => attribute.name?.name === 'entryDisabled');
    for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(walk) : walk(value);
  })(ast.program);
  assert.ok(entryDisabled, 'PreviewPanel receives entryDisabled');
  assert.equal(shell.slice(entryDisabled.value.expression.start, entryDisabled.value.expression.end), 'Boolean(editor.conversationDraft)');
  assert.match(shell, /liveDraftPreview\(latestRun, livePreviewRun\.current\)/);
  assert.match(panel, /disabled=\{locked \|\| entryDisabled \|\| !current \|\| current\.isEntry\}/);
});
