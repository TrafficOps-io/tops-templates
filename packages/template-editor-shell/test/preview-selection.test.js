import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSectionOptions, previewSelectionMatches, selectedPreviewBlocks } from '../src/preview-selection.js';

test('selection is tied to displayed bytes, effective values and locale, not saved revision', () => {
  const files = { 'index.tpl': 'source', 'image.png': new Uint8Array([1, 2]) }, values = { title: 'Hello' };
  const frame = { selection: {}, sourceSnapshot: { files, values, locale: 'en' } };
  assert.equal(previewSelectionMatches(frame, { files: structuredClone(files), values: { ...values }, locale: 'en' }), true);
  assert.equal(previewSelectionMatches(frame, { files: { ...files, 'index.tpl': 'changed' }, values, locale: 'en' }), false);
  assert.equal(previewSelectionMatches(frame, { files, values: { title: 'New' }, locale: 'en' }), false);
  assert.equal(previewSelectionMatches(frame, { files, values, locale: 'ru' }), false);
});

test('selection rejects unknown and other-page ids, normalizes ancestors, retains repeat instances', () => {
  const frame = { selection: { blockInstances: [
    { id: 'parent', sourceId: 'p', page: 'index.html' },
    { id: 'child1', sourceId: 'c', page: 'index.html', parentId: 'parent' },
    { id: 'child2', sourceId: 'c', page: 'index.html', parentId: 'parent' },
    { id: 'other', sourceId: 'o', page: 'other.html' },
  ] } };
  assert.deepEqual(selectedPreviewBlocks(frame, ['unknown', 'child1', 'other', 'child2', 'child1'], 'index.html').map(item => item.id), ['child1', 'child2']);
  assert.deepEqual(selectedPreviewBlocks(frame, ['child1', 'parent'], 'index.html').map(item => item.id), ['parent']);
});

test('section choices are page-specific and repeated labels identify individual instances', () => {
  const frame = { sourceSnapshot: { locale: 'ru' }, selection: { blockSources: [{ id: 'c', path: 'index.tpl' }], blockInstances: [
    { id: 'parent', label: 'Комментарии', page: 'index.html' },
    { id: 'a', label: 'Комментарий', sourceId: 'c', page: 'index.html', parentId: 'parent' },
    { id: 'b', label: 'Комментарий', sourceId: 'c', page: 'index.html', parentId: 'parent' },
    { id: 'other', label: 'Комментарий', sourceId: 'c', page: 'next.html' },
  ] } };
  const sections = previewSectionOptions(frame, 'index.html');
  assert.deepEqual(sections.map(item => item.label), ['Комментарии', 'Комментарий (1/2)', 'Комментарий (2/2)']);
  assert.equal(sections[1].description, 'Комментарии · index.tpl · index.html');
  assert.equal(sections[1].locale, 'ru');
  assert.equal(previewSectionOptions(frame, 'next.html')[0].label, 'Комментарий');
  assert.equal(previewSectionOptions(null).length, 0);
});
