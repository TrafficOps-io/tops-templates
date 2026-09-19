import assert from 'node:assert/strict';
import test from 'node:test';
import { completedFileInput } from '../../packages/template-editor-shell/src/completed-file-input.js';

test('recovery distinguishes complete strings from repaired prefixes, including escapes and nested-looking code', () => {
  const file = {path: 'index.tpl', content: 'Привет \\ " } ] , {"path":"wrong","content":"nested"}\n'};
  const text = '{"files":[' + JSON.stringify(file) + ',{"path":"unfinished.css","content":"body{';
  assert.deepEqual(completedFileInput('set_files', text), [file]);
  assert.deepEqual(completedFileInput('set_files', text.slice(0, text.indexOf('Привет') + 3)), []);
  assert.deepEqual(completedFileInput('set_file', JSON.stringify(file)), [file]);
  assert.deepEqual(completedFileInput('set_file', JSON.stringify(file).slice(0, -1)), []);
  assert.deepEqual(completedFileInput('edit_file', JSON.stringify(file)), []);
});

test('malformed or unexpected file objects are not salvaged as writes', () => {
  for (const value of [{path: 'index.tpl'}, {path: 'index.tpl', content: null}, {path: 'index.tpl', content: 'x', extra: true}]) {
    assert.deepEqual(completedFileInput('set_files', JSON.stringify({files:[value]})), []);
  }
  assert.deepEqual(completedFileInput('set_files', '{"files":[{"path":"x","content":"x",}]'), []);
});
