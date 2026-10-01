import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationChangedFiles, conversationReferenceLabel } from '../src/conversation-diff.js';

test('review lists removed files alongside additions and binary modifications', () => {
  const original = { 'old.tpl': 'removed', 'styles.css': 'same', 'photo.png': new Uint8Array([1]) };
  const proposed = { 'new.tpl': 'added', 'styles.css': 'same', 'photo.png': new Uint8Array([2]) };
  assert.deepEqual(conversationChangedFiles(original, proposed), { 'new.tpl': 'added', 'photo.png': 'modified', 'old.tpl': 'deleted' });
  assert.deepEqual(conversationChangedFiles(original, {}), { 'old.tpl': 'deleted', 'styles.css': 'deleted', 'photo.png': 'deleted' });
  assert.deepEqual(Object.keys(original), ['old.tpl', 'styles.css', 'photo.png']);
});

test('conflict review labels value-set references without returning an object to React', () => {
  assert.equal(conversationReferenceLabel({ kind: 'values', path: '' }), 'Content values');
  assert.equal(conversationReferenceLabel({ kind: 'file', path: 'index.tpl' }), 'index.tpl');
  assert.equal(conversationReferenceLabel({ kind: 'files', path: '' }), 'Project files');
  assert.equal(conversationReferenceLabel('styles.css'), 'styles.css');
});
