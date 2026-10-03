import test from 'node:test';
import assert from 'node:assert/strict';
import { addMention, groupTargets, inlineMentionTarget, insertMention, mentionAtCaret, mentionSegments, mentionsInText, textWithMentions } from '../src/chat/mentions.js';

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
  const target = { kind: 'track', id: 'music', label: 'Музыка' };
  assert.deepEqual(insertMention(text, query, target), { text: 'До\n@Музыка\nПосле', caret: 10 });
  assert.deepEqual(insertMention('До @муз после', { start: 3, end: 7 }, target), { text: 'До @Музыка после', caret: 11 });
  assert.deepEqual(insertMention('@муз', { start: 0, end: 4 }, target), { text: '@Музыка ', caret: 8 });
});

test('inline references follow edits, repeat in place, and disappear from metadata when deleted', () => {
  const scene = { kind: 'scene', id: 's1', label: 'Сцена 1' }, longer = { kind: 'scene', id: 's10', label: 'Сцена 10' };
  const text = 'Сравни @Сцена 1 с @Сцена 10 и @Сцена 1.';
  assert.deepEqual(mentionSegments(text, [scene, longer]).filter(part => part.target).map(part => part.target.id), ['s1', 's10', 's1']);
  assert.deepEqual(mentionsInText('Теперь @Сцена 10', [scene, longer]), [longer]);
  assert.deepEqual(mentionsInText('Теперь без ссылок', [scene, longer]), []);
  assert.equal(mentionAtCaret('Продли @Сцена 1 до 6 секунд', undefined, [scene]), null);
  assert.equal(mentionAtCaret('Продли @Сцена 1 и @', undefined, [scene]).query, '');
  assert.equal(mentionSegments('user@Сцена 1', [scene]).some(part => part.target), false);
  assert.equal(textWithMentions('Проверь', [scene]), 'Проверь @Сцена 1 ');
  assert.equal(textWithMentions('Проверь @Сцена 1', [scene]), 'Проверь @Сцена 1');
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


test('same-named references get distinct inline labels', () => {
  const a = { kind: 'scene', id: 'scene:a', label: 'Intro' }, b = { ...a, id: 'scene:b' };
  const targets = [a, b].map(target => inlineMentionTarget(target, [a, b]));
  assert.deepEqual(mentionsInText('Change @Intro (scene:b)', targets), [targets[1]]);
});
