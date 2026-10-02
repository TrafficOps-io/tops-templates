import test from 'node:test';
import assert from 'node:assert/strict';
import { runToParts, runToState, conflictToParts, toDataUrl } from '../src/chat-cards.js';

const base = { files: { 'index.tpl': 'a\nb\nc', 'logo.png': new Uint8Array([1, 2, 3]), 'doc.pdf': new Uint8Array([9]) }, translations: { en: { title: 'Old' } } };
const draft = { files: { 'index.tpl': 'a\nB\nc', 'logo.png': new Uint8Array([4, 5, 6]), 'new.css': 'body{}' }, values: { title: 'New' }, valid: true, summary: 'Changed the headline.' };
const t = (text, values = {}) => text.replace(/\{([A-Za-z]+)\}/g, (match, key) => values[key] ?? match);

test('a ready run becomes summary text plus diff, image, values and file cards', () => {
  const parts = runToParts({ id: 'r1', state: 'ready', locale: 'en', base, result: draft }, t);
  assert.equal(parts[0].type, 'text'); assert.equal(parts[0].text, 'Changed the headline.');
  const cards = parts.slice(1).map(part => part.result);
  assert.deepEqual(cards.map(card => card.type).sort(), ['diff', 'diff', 'file', 'image', 'values']);
  const diff = cards.find(card => card.type === 'diff' && card.path === 'index.tpl');
  assert.deepEqual([diff.added, diff.removed, diff.before, diff.after], [1, 1, 'a\nb\nc', 'a\nB\nc']);
  assert.equal('change' in diff, false, 'no fields outside port.d.ts');
  const image = cards.find(card => card.type === 'image'); assert.equal(image.name, 'logo.png'); assert.ok(image.before && image.after && image.before !== image.after);
  const values = cards.find(card => card.type === 'values'); assert.deepEqual(values.changes, [{ path: 'title', before: 'Old', after: 'New' }]);
  const removed = cards.find(card => card.type === 'file'); assert.equal(removed.name, 'doc.pdf (removed)'); assert.equal('raw' in removed, false);
  assert.ok(parts.slice(1).every(part => part.toolCallId.startsWith('r1:')), 'toolCallId is stable per run');
  assert.equal(new Set(parts.slice(1).map(part => part.toolCallId)).size, parts.length - 1, 'toolCallId is unique within the message');
});

test('a running run exposes checkpoint cards and a status with phase text; applicability is encoded in the status', () => {
  const run = { id: 'r2', state: 'running', phase: 'plan', locale: 'en', base, checkpoint: { files: draft.files, values: base.translations.en } };
  assert.deepEqual(runToState(run, t), { id: 'r2', status: 'running', message: 'Plan' });
  assert.ok(runToParts(run, t).some(part => part.type === 'tool-call' && part.result.type === 'diff'));
  assert.equal(runToState({ id: 'q', state: 'queued', phase: 'queued' }, t).message, 'Queued');
  assert.equal(runToState({ id: 'r3', state: 'ready', result: { ...draft, discussion: true } }, t).status, 'completed', 'discussion runs are not applicable');
  assert.equal(runToState({ id: 'r4', state: 'ready', result: { ...draft, valid: false } }, t).status, 'completed', 'invalid drafts are not applicable');
  assert.equal(runToState({ id: 'r5', state: 'ready', result: draft, recoveredConflict: true }, t).status, 'completed');
  assert.equal(runToState({ id: 'r6', state: 'ready', result: draft }, t).status, 'ready');
});

test('a failed run carries the error as text and status message, and no cards without a draft', () => {
  const run = { id: 'r7', state: 'failed', error: 'Provider unavailable', locale: 'en', base };
  assert.deepEqual(runToParts(run, t), [{ type: 'text', text: 'Provider unavailable' }]);
  assert.equal(runToState(run, t).message, 'Provider unavailable');
});

test('a valid recovered interrupted draft is ready; stopped and stale runs explain themselves', () => {
  const recovered = { id: 'r8', state: 'interrupted', result: draft, error: 'Recovered draft. Generation has not restarted.' };
  assert.deepEqual(runToState(recovered, t), { id: 'r8', status: 'ready', message: 'Recovered draft. Generation has not restarted.' });
  const stale = { id: 'r9', state: 'interrupted', result: { ...draft, valid: false }, recoveredConflict: true, error: 'This recovered draft belongs to an older project revision.' };
  assert.deepEqual(runToState(stale, t), { id: 'r9', status: 'interrupted', message: 'This recovered draft belongs to an older project revision.' });
  assert.equal(runToState({ id: 'r10', state: 'interrupted', checkpoint: { ...draft, valid: false } }, t).status, 'interrupted');
  assert.equal(runToState({ id: 'r11', state: 'cancelled', error: 'Stopped by the user.' }, t).message, 'Stopped by the user.');
  assert.deepEqual(runToParts({ id: 'r11', state: 'cancelled', error: 'Stopped by the user.' }, t), [], 'the reason is not repeated as message text');
});

test('an apply conflict with a candidate becomes a question card with review options and candidate diffs', () => {
  const conflict = { code: 'conflict', requiresContextReview: true, conflicts: [], staleReadSet: [{ kind: 'file', path: 'index.tpl' }], candidate: { files: { 'index.tpl': 'a\nB\nc\nd' }, translations: { en: { title: 'New' } } } };
  const parts = conflictToParts('r1', conflict, { files: { 'index.tpl': 'a\nb\nc\nd' }, translations: { en: { title: 'Old' } } }, 'en', t);
  const question = parts.find(part => part.result.type === 'question').result;
  assert.equal(question.kind, 'conflict'); assert.equal(question.questionId, 'conflict:r1'); assert.deepEqual(question.options, ['reviewed', 'rebase']); assert.equal(question.references.length, 1);
  assert.ok(parts.some(part => part.result.type === 'diff' && part.result.path === 'index.tpl'));
});

test('overlapping conflicts have no candidate and offer only rebase', () => {
  // conversation-changes.js:126 — при пересечениях merged.state === null
  const conflict = { code: 'conflict', conflicts: [{ kind: 'file', path: 'index.tpl' }], staleReadSet: [], candidate: null };
  const parts = conflictToParts('r1', conflict, { files: { 'index.tpl': 'x' }, translations: { en: {} } }, 'en', t);
  assert.equal(parts.length, 1); assert.deepEqual(parts[0].result.options, ['rebase']);
});

test('toDataUrl encodes large binaries without blowing the call stack', () => {
  const bytes = new Uint8Array(4 * 1024 * 1024); bytes[0] = 137;
  assert.match(toDataUrl('big.png', bytes), /^data:image\/png;base64,iQ/);
});
