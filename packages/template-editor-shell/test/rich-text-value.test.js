import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWysiwygValue, prepareRichTextValues, isEditorImageSource } from '../src/rich-text-value.js';
import { parseTemplate, renderTemplate, validateValues } from '@trafficops/template-runtime';

test('legacy multiline Wysiwyg values render real paragraphs and preserve literal text', () => {
  const value = prepareWysiwygValue('First < second & third.\r\nAnother line.\r\n\r\nLast paragraph.');
  const definition = parseTemplate('@param body Wysiwyg\n@layout\n<article>{{& body}}</article>\n@endlayout');
  assert.equal(renderTemplate(definition, { body: value }).trim(), '<article><p>First &lt; second &amp; third.<br />Another line.</p><p>Last paragraph.</p></article>');
});

test('HTML copied from a TPL default restores valid image attributes without changing authored text', () => {
  const html = '<p>Keep \\"quoted text\\".</p><figure><img src="img/a.png" alt="A"><figcaption>Caption.</figcaption></figure>';
  assert.equal(prepareWysiwygValue(html), html);
  const pasted = html.replace('src="img/a.png"', 'src=\\"img/a.png\\"').replace('alt="A"', 'alt=\\"A\\"');
  assert.equal(prepareWysiwygValue(pasted), html);
  assert.equal(prepareWysiwygValue(JSON.stringify(html)), html);
  const definition = parseTemplate('@param body Wysiwyg\n@layout\n{{& body}}\n@endlayout');
  assert.doesNotThrow(() => validateValues(definition, { body: prepareWysiwygValue(pasted) }));
});

test('image insertion accepts actual project assets and HTTP(S), rejecting executable and invented sources', () => {
  assert.equal(isEditorImageSource('img/a.png', ['img/a.png']), true);
  assert.equal(isEditorImageSource('https://example.com/a.png'), true);
  for (const source of ['javascript:alert(1)', 'data:image/svg+xml,bad', 'file:///etc/passwd', '//example.com/a.png', 'img/missing.png', 'https://user:pass@example.com/a.png']) assert.equal(isEditorImageSource(source, ['img/a.png']), false, source);
});

test('legacy recovery batches sibling fields and nested rows without overwriting other values', () => {
  const fields = [{name:'one',type:'wysiwyg'},{name:'two',type:'wysiwyg'},{name:'rows',type:'repeater',fields:[{name:'body',type:'wysiwyg'}]}];
  const values = { one: 'First.\n\nSecond.', two: 'Other article.', rows: [{body:'Nested.\n\nParagraph.',title:'Keep'}], markdown: '**Unchanged**', image:'img/a.png' };
  const next = prepareRichTextValues(fields, values);
  assert.equal(next.one, '<p>First.</p><p>Second.</p>');
  assert.equal(next.two, '<p>Other article.</p>');
  assert.equal(next.rows[0].body, '<p>Nested.</p><p>Paragraph.</p>');
  assert.equal(next.rows[0].title, 'Keep');
  assert.equal(next.markdown, values.markdown);
  assert.equal(next.image, values.image);
  assert.equal(values.one, 'First.\n\nSecond.');
  assert.equal(prepareRichTextValues(fields, next), next);
});
