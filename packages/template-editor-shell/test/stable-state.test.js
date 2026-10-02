import assert from 'node:assert/strict';
import test from 'node:test';
import { stableSavedState } from '../src/stable-state.js';

const state = () => ({ revision: 1, name: 'Launch', files: { 'index.tpl': 'x', 'a.png': new Uint8Array([1, 2]) }, folders: ['images'], translations: { en: { title: 'Hi', items: [{ a: 1, b: 2 }] }, de: { title: 'Hallo' } } });

test('an autosave result with unchanged contents keeps the editor state objects (the preview does not re-render)', () => {
  const previous = state(), saved = { ...state(), revision: 2, status: 'Saved to folder' };
  const next = stableSavedState(previous, saved);
  assert.equal(next.revision, 2);
  assert.equal(next.status, 'Saved to folder');
  assert.equal(next.files, previous.files);
  assert.equal(next.folders, previous.folders);
  assert.equal(next.translations, previous.translations);
});

test('changed contents take the saved objects; unchanged locales keep theirs', () => {
  const previous = state(), saved = { ...state(), revision: 2 };
  saved.files['index.tpl'] = 'y'; saved.translations.de.title = 'Servus';
  const next = stableSavedState(previous, saved);
  assert.equal(next.files, saved.files);
  assert.equal(next.translations, saved.translations);
  assert.equal(next.translations.en, saved.translations.en, 'a new translations object is used whole');
  const bytes = { ...state(), files: { ...state().files, 'a.png': new Uint8Array([1, 3]) } };
  assert.equal(stableSavedState(previous, bytes).files, bytes.files);
  const added = { ...state(), files: { ...state().files, 'b.css': '' } };
  assert.equal(stableSavedState(previous, added).files, added.files);
  const reordered = { ...state(), translations: { en: { items: [{ b: 2, a: 1 }], title: 'Hi' }, de: { title: 'Hallo' } } };
  assert.equal(stableSavedState(previous, reordered).translations, previous.translations, 'key order is not a change');
  assert.equal(stableSavedState(null, saved), saved);
  assert.notEqual(stableSavedState(previous, { ...state(), folders: [] }).folders, previous.folders);
});
