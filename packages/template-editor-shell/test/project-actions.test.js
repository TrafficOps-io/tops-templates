import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProjectDraft, moveProjectEntry, removeProjectEntry, renameProjectFile } from '../src/project.js';

const source = '@layout<html><body>Page</body></html>@endlayout';

test('deleting a folder recursively removes its files and explicit empty folders, preserving neighboring paths', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const state = {
    files: { 'index.tpl': source, 'assets/logo.svg': '<svg/>', 'assets/nested/photo.png': bytes, 'assets-old/keep.txt': 'keep' },
    folders: ['assets', 'assets/nested', 'assets/nested/empty', 'assets-old', 'empty'], entrypoint: 'index.html',
  };
  const next = removeProjectEntry(state, { type: 'folder', path: 'assets' }, 'assets/nested/photo.png');
  assert.deepEqual(next.files, { 'index.tpl': source, 'assets-old/keep.txt': 'keep' });
  assert.deepEqual(next.folders, ['assets-old', 'empty']);
  assert.equal(next.active, 'index.tpl');
  assert.equal(next.entrypoint, 'index.html');
  assert.equal(state.files['assets/nested/photo.png'], bytes);
  assert.ok(state.folders.includes('assets/nested/empty'));
});

test('deleting an empty or inferred folder preserves the active file and unrelated entry page', () => {
  const state = { files: { 'index.tpl': source, 'assets/nested/icon.svg': '<svg/>' }, folders: ['empty'], entrypoint: 'index.html' };
  const empty = removeProjectEntry(state, { type: 'folder', path: 'empty' }, 'index.tpl');
  assert.deepEqual(empty.files, state.files);
  assert.deepEqual(empty.folders, []);
  assert.equal(empty.active, 'index.tpl');
  const inferred = removeProjectEntry(state, { type: 'folder', path: 'assets/nested' }, 'index.tpl');
  assert.deepEqual(inferred.files, { 'index.tpl': source });
  assert.equal(inferred.active, 'index.tpl');
  assert.equal(inferred.entrypoint, 'index.html');
});

test('removing the entry source clears its selection so analysis can choose a surviving page', () => {
  for (const entrySource of ['pages/start.tpl', 'pages/start.tpl.html', 'pages/start.tpl.php', 'pages/start.html']) {
    const state = { files: { 'logo.svg': '<svg/>', [entrySource]: source, 'index.tpl': source }, folders: ['pages'], entrypoint: 'pages/start.html' };
    for (const entry of [{ type: 'file', path: entrySource }, { type: 'folder', path: 'pages' }]) {
      const next = removeProjectEntry(state, entry, entrySource);
      assert.equal(next.entrypoint, null);
      assert.equal(next.active, 'index.tpl');
    }
  }
});

test('folder deletion rejects invalid paths, stale targets and deleting the last file without changing state', () => {
  const state = { files: { 'pages/start.tpl': source }, folders: ['pages'], entrypoint: 'pages/start.html' };
  for (const entry of [{ type: 'folder', path: '../pages' }, { type: 'folder', path: 'missing' }, { type: 'file', path: 'missing.tpl' }, { type: 'folder', path: 'pages' }]) {
    assert.throws(() => removeProjectEntry(state, entry, 'pages/start.tpl'));
    assert.deepEqual(state.files, { 'pages/start.tpl': source });
    assert.deepEqual(state.folders, ['pages']);
    assert.equal(state.entrypoint, 'pages/start.html');
  }
});

test('renaming and moving the entry page keep the preview entrypoint and selected source in sync', () => {
  const state = { files: { 'index.tpl': source, 'pages/start.tpl.php': source }, folders: ['pages', 'pages/empty'], entrypoint: 'pages/start.html' };
  const renamed = renameProjectFile(state, 'pages/start.tpl.php', 'pages/renamed.tpl.php');
  assert.equal(renamed.entrypoint, 'pages/renamed.html');
  assert.ok(Object.hasOwn(renamed.files, 'pages/renamed.tpl.php'));
  const moved = moveProjectEntry(state, { type: 'folder', path: 'pages' }, 'archive', 'pages/start.tpl.php');
  assert.equal(moved.entrypoint, 'archive/pages/start.html');
  assert.equal(moved.active, 'archive/pages/start.tpl.php');
  assert.ok(moved.folders.includes('archive/pages/empty'));
  const movedFile = moveProjectEntry(state, { type: 'file', path: 'pages/start.tpl.php' }, '', 'pages/start.tpl.php');
  assert.equal(movedFile.entrypoint, 'start.html');
  assert.equal(movedFile.active, 'start.tpl.php');
  assert.equal(renameProjectFile(state, 'index.tpl', 'other.tpl').entrypoint, state.entrypoint);
  assert.equal(renameProjectFile(state, 'pages/start.tpl.php', 'pages/start.txt').entrypoint, null);
});

test('applying AI edits preserves empty folders, the chosen page and other languages; creating a project resets layout metadata', () => {
  const state = { files: { 'index.tpl': source, 'landing.tpl': source }, folders: ['uploads/empty'], entrypoint: 'landing.html', translations: { en: { title: 'before' }, uk: { title: 'before in Ukrainian' } } };
  const files = { ...state.files, 'styles.css': 'body{}' }, values = { title: 'after' };
  const edited = applyProjectDraft(state, files, values, 'en', { mode: 'edit' });
  assert.equal(edited.entrypoint, 'landing.html');
  assert.deepEqual(edited.folders, ['uploads', 'uploads/empty']);
  assert.deepEqual(edited.translations.uk, state.translations.uk);
  assert.deepEqual(edited.translations.en, values);
  assert.equal(applyProjectDraft(state, { 'index.tpl': source }, values, 'en', { mode: 'edit' }).entrypoint, null);
  assert.deepEqual(applyProjectDraft(state, { ...files, uploads: 'new file' }, values, 'en', { mode: 'edit' }).folders, []);
  const created = applyProjectDraft(state, files, values, 'en', { mode: 'create' });
  assert.equal(created.entrypoint, null);
  assert.deepEqual(created.folders, []);
});
