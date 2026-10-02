import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseInline, parseMarkdown } from '../src/chat/markdown.js';

const text = value => ({ type: 'text', text: value });

test('paragraphs split on blank lines; single newlines become breaks', () => {
  assert.deepEqual(parseMarkdown('One\ntwo\n\nThree'), [
    { type: 'paragraph', children: [text('One'), { type: 'break' }, text('two')] },
    { type: 'paragraph', children: [text('Three')] },
  ]);
});

test('bold, italic and inline code', () => {
  assert.deepEqual(parseInline('a **b** c'), [text('a '), { type: 'strong', children: [text('b')] }, text(' c')]);
  assert.deepEqual(parseInline('*it*'), [{ type: 'em', children: [text('it')] }]);
  assert.deepEqual(parseInline('use `x **y**`'), [text('use '), { type: 'code', text: 'x **y**' }]);
  assert.deepEqual(parseInline('**a *b* c**'), [{ type: 'strong', children: [text('a '), { type: 'em', children: [text('b')] }, text(' c')] }]);
  assert.deepEqual(parseInline('*a **b** c*'), [{ type: 'em', children: [text('a '), { type: 'strong', children: [text('b')] }, text(' c')] }]);
});

test('unmatched markers stay literal', () => {
  assert.deepEqual(parseInline('2 * 3 = 6'), [text('2 * 3 = 6')]);
  assert.deepEqual(parseInline('**open'), [text('**open')]);
  assert.deepEqual(parseInline('`tick'), [text('`tick')]);
  assert.deepEqual(parseInline('** spaced **'), [text('** spaced **')]);
});

test('bullet and ordered lists', () => {
  assert.deepEqual(parseMarkdown('- one\n- **two**\n* three'), [
    { type: 'list', ordered: false, start: 1, items: [[text('one')], [{ type: 'strong', children: [text('two')] }], [text('three')]] },
  ]);
  assert.deepEqual(parseMarkdown('Steps:\n3. a\n4. b'), [
    { type: 'paragraph', children: [text('Steps:')] },
    { type: 'list', ordered: true, start: 3, items: [[text('a')], [text('b')]] },
  ]);
  assert.deepEqual(parseMarkdown('- one\n  more'), [{ type: 'list', ordered: false, start: 1, items: [[text('one'), { type: 'break' }, text('more')]] }]);
});

test('fenced code blocks keep their text verbatim; an unterminated fence runs to the end', () => {
  assert.deepEqual(parseMarkdown('Before\n```js\nconst a = **1**;\n\n<b>x</b>\n```\nAfter'), [
    { type: 'paragraph', children: [text('Before')] },
    { type: 'code', lang: 'js', text: 'const a = **1**;\n\n<b>x</b>' },
    { type: 'paragraph', children: [text('After')] },
  ]);
  assert.deepEqual(parseMarkdown('```\nstreaming'), [{ type: 'code', lang: '', text: 'streaming' }]);
});

test('headings', () => {
  assert.deepEqual(parseMarkdown('## Plan ##\nText'), [
    { type: 'heading', level: 2, children: [text('Plan')] },
    { type: 'paragraph', children: [text('Text')] },
  ]);
});

test('HTML is plain text in the tree and Markdown.jsx never inserts HTML', () => {
  assert.deepEqual(parseMarkdown('<script>alert(1)</script>'), [{ type: 'paragraph', children: [text('<script>alert(1)</script>')] }]);
  const source = readFileSync(new URL('../src/chat/Markdown.jsx', import.meta.url), 'utf8');
  assert.ok(!/innerHTML/i.test(source), 'no HTML insertion');
});
