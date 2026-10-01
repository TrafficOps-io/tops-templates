import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationContentHash, createChangeSet, mergeChangeSet, retainRawDraftValues } from '../src/conversation-changes.js';

const base = () => ({ revision: 3, name: 'Landing', files: { 'index.html': '<h1>Original</h1>', 'style.css': 'red', 'img.png': new Uint8Array([1, 2, 3]) }, folders: ['empty'], entrypoint: 'index.html', locale: 'en', translations: { en: { hero: { title: 'Old', color: 'red' }, reviews: ['A'] }, de: { title: 'Deutsch' } } });
const proposal = state => ({ files: structuredClone(state.files), values: structuredClone(state.translations.en) });

test('independent file and nested value operations preserve manual edits and another locale', () => {
  const original = base(), result = proposal(original), current = base();
  result.files['style.css'] = 'blue'; result.values.hero.title = 'New';
  current.files['index.html'] = '<h1>Manual</h1>'; current.translations.en.hero.color = 'green'; current.revision = 4;
  const merged = mergeChangeSet({ base: original, proposal: result, current });
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.state.files['style.css'], 'blue'); assert.equal(merged.state.files['index.html'], '<h1>Manual</h1>');
  assert.deepEqual(merged.state.translations.en.hero, { title: 'New', color: 'green' });
  assert.deepEqual(merged.state.translations.de, current.translations.de); assert.equal(merged.state.revision, 4);
  assert.equal(current.files['style.css'], 'red'); assert.equal(original.translations.en.hero.title, 'Old');
});

test('conflicting files, arrays, delete/edit and binary replacements never overwrite current state', () => {
  const original = base(), result = proposal(original), current = base();
  delete result.files['index.html']; result.files['img.png'] = new Uint8Array([4]); result.values.reviews = ['B'];
  current.files['index.html'] = '<h1>Manual</h1>'; current.files['img.png'] = new Uint8Array([5]); current.translations.en.reviews.push('Manual');
  const merged = mergeChangeSet({ base: original, proposal: result, current });
  assert.equal(merged.state, null); assert.deepEqual(merged.conflicts.map(item => item.path).sort(), ['/reviews', 'img.png', 'index.html']);
  assert.equal(current.files['index.html'], '<h1>Manual</h1>'); assert.deepEqual(current.translations.en.reviews, ['A', 'Manual']);
});

test('already applied operations are idempotent and source/value read dependencies require review', () => {
  const original = base(), result = proposal(original), current = base(); result.files['style.css'] = 'blue'; current.files['style.css'] = 'blue';
  result.readSet = [{ kind: 'file', path: 'index.html', hash: conversationContentHash(original.files['index.html']) }, { kind: 'values', path: '', hash: conversationContentHash(original.translations.en) }];
  current.translations.en.hero.title = 'Manual';
  const merged = mergeChangeSet({ base: original, proposal: result, current });
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.requiresContextReview, true); assert.deepEqual(merged.staleReadSet, [{ kind: 'values', path: '' }]);
  assert.equal(mergeChangeSet({ base: original, proposal: result, current, allowStaleContext: true }).requiresContextReview, false);
});

test('replacing a parent field blocks stale child updates and values support deletions', () => {
  const original = base(), result = proposal(original), current = base(); result.values.hero.title = 'New'; current.translations.en.hero = 'Manual scalar';
  assert.equal(mergeChangeSet({ base: original, proposal: result, current }).state, null);
  delete result.values.hero; const merged = mergeChangeSet({ base: original, proposal: result, current: original });
  assert.equal(Object.hasOwn(merged.state.translations.en, 'hero'), false);
});

test('change operations reject prototype paths and invalid project paths', () => {
  const original = base(), result = proposal(original); result.values = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => createChangeSet({ base: original, proposal: result }), /Unsafe/);
  result.values = {}; result.files['../escape.html'] = 'bad'; assert.throws(() => createChangeSet({ base: original, proposal: result }), /path|Invalid/i);
  assert.equal({}.polluted, undefined);
});

test('effective defaults do not become saved value operations; nested changes and arrays remain intentional', () => {
  const raw = { hero: { color: 'red' } }, visible = { hero: { color: 'red', title: 'Default' }, group: { untouched: 5 }, rows: [{ text: 'Default' }] };
  assert.deepEqual(retainRawDraftValues(raw, visible, visible), raw);
  const proposed = structuredClone(visible); proposed.hero.title = 'Changed'; proposed.rows[0].text = 'New';
  assert.deepEqual(retainRawDraftValues(raw, visible, proposed), { hero: { color: 'red', title: 'Changed' }, rows: [{ text: 'New' }] });
});
