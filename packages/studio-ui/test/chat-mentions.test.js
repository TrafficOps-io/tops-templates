import test from 'node:test';
import assert from 'node:assert/strict';
import { addMention, groupTargets, mentionAtCaret, removeMentionQuery } from '../src/chat/mentions.js';

test('mention queries follow the caret, allow names with spaces and do not activate on email addresses', () => {
  assert.equal(mentionAtCaret('Пишите на user@example.com'), null);
  assert.equal(mentionAtCaret('Обычный текст'), null);
  assert.equal(mentionAtCaret('@Монтаж\nСледующая строка'), null);
  assert.equal(mentionAtCaret('Проверь\n@Сценарий и звук')?.query, 'Сценарий и звук');
  assert.equal(mentionAtCaret('Проверь @мон и продолжи', 'Проверь @мон'.length)?.query, 'мон');
  assert.equal(mentionAtCaret('Проверь @Монтаж', 'Проверь '.length), null);
  assert.deepEqual(mentionAtCaret('@'), { start: 0, end: 1, query: '' });
});

test('selecting a mention in the middle of a message preserves surrounding text, line breaks and caret position', () => {
  const text = 'До\n@муз\nПосле';
  const query = mentionAtCaret(text, 'До\n@муз'.length);
  assert.deepEqual(removeMentionQuery(text, query), { text: 'До\n\nПосле', caret: 3 });
  assert.deepEqual(removeMentionQuery('Текст без @'), { text: 'Текст без @', caret: 11 });
});

test('targets are grouped by kind in the fixed order and empty groups are dropped', () => {
  const targets = [
    { kind: 'asset', id: 'a1', label: 'logo.png' },
    { kind: 'scene', id: 's1', label: 'Scene 1' },
    { kind: 'field', id: 'f1', label: 'Title' },
    { kind: 'section', id: 'x1', label: 'Script' },
    { kind: 'scene', id: 's2', label: 'Scene 2' },
  ];
  assert.deepEqual(groupTargets(targets).map(group => [group.kind, group.items.map(item => item.id)]), [
    ['section', ['x1']], ['scene', ['s1', 's2']], ['asset', ['a1']], ['field', ['f1']],
  ]);
  assert.deepEqual(groupTargets([]), []);
});

test('a mention is added once', () => {
  const target = { kind: 'scene', id: 's1', label: 'Scene 1' };
  const once = addMention([], target);
  assert.equal(addMention(once, { ...target }), once);
  assert.equal(addMention(once, { kind: 'track', id: 's1', label: 'Track' }).length, 2);
});
