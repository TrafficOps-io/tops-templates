import test from 'node:test';
import assert from 'node:assert/strict';
import { addFileMention, addSectionMention, matchingMentionPaths, matchingMentions, mentionAtCaret, mentionKey } from '../src/conversation-mentions.js';

test('mentions find the active token at the caret without treating email addresses as file references', () => {
  assert.equal(mentionAtCaret('mail@example.com'), null);
  assert.deepEqual(mentionAtCaret('Правь @styles.css дальше', 17), { start: 6, end: 17, query: 'styles.css' });
  assert.deepEqual(mentionAtCaret('Hello\n@img/'), { start: 6, end: 11, query: 'img/' });
  assert.equal(mentionAtCaret('Use @styles.css later'), null);
});

test('picker matches full relative paths and adding the same file keeps one structured reference', () => {
  const files = { 'css/styles.css': '', 'index.tpl': '', 'img/hero.png': new Uint8Array() };
  assert.deepEqual(matchingMentionPaths(files, 'STY'), ['css/styles.css']);
  assert.deepEqual(matchingMentionPaths(files, 'img/'), ['img/hero.png']);
  const references = addFileMention([], 'index.tpl');
  assert.deepEqual(references, [{ path: 'index.tpl' }]);
  assert.equal(addFileMention(references, 'index.tpl'), references);
  assert.deepEqual(addFileMention(['index.tpl'], 'css/styles.css'), ['index.tpl', { path: 'css/styles.css' }]);
});

test('section references distinguish instances and coexist with their source file', () => {
  const a = { kind: 'section', id: 'comment-1', page: 'index.html', locale: 'ru', label: 'Комментарий (1/2)', path: 'index.tpl', description: 'Комментарии · index.tpl' };
  const b = { ...a, id: 'comment-2', label: 'Комментарий (2/2)' };
  const first = addSectionMention([], a);
  assert.equal(addSectionMention(first, a), first);
  const both = addFileMention(addSectionMention(first, b), 'index.tpl');
  assert.equal(both.length, 3);
  assert.notEqual(mentionKey(both[0]), mentionKey(both[1]));
  assert.deepEqual(matchingMentions({ 'index.tpl': '' }, [a, b], 'КОММЕНТ').map(item => item.id), ['comment-1', 'comment-2']);
  assert.deepEqual(matchingMentions({ 'index.tpl': '' }, [a], 'index', 'file'), [{ kind: 'file', path: 'index.tpl' }]);
  assert.deepEqual(matchingMentions({ 'index.tpl': '' }, [a], 'index', 'section'), [a]);
});
