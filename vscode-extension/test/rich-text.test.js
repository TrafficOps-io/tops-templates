'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildProject, getCompletions, getDefinition, getHover, getSignatureHelp } = require('../src/language');
const { formatDocument } = require('../src/formatter');

const URI = 'file:///templates/template.tpl';
const declarations = `@type Article
@param title String
@param body Wysiwyg label="Article body" help="Supports images"
@param notes Markdown
@param children Article[]
@endtype
@param article Article
@param articles Article[]
@param title String
@param image Image
@param body Wysiwyg
@param notes Markdown
`;
function fixture(source, documents = [], options = {}) {
  const offset = source.indexOf('§');
  assert.notEqual(offset, -1, 'fixture needs a cursor');
  const text = source.replace('§', '');
  const project = buildProject([{ uri: URI, text }, ...documents], options);
  const items = getCompletions(project, URI, offset);
  return { project, text, offset, items, labels: items.map(item => item.label) };
}
const layout = expression => `${declarations}@layout\n<article>${expression}</article>\n@endlayout`;

test('both editors are built-in scalar types in parameters and block arguments', () => {
  for (const declaration of ['@param body §', '@block content(body: §)']) {
    const { items, labels } = fixture(declaration);
    for (const type of ['Wysiwyg', 'Markdown']) {
      assert.ok(labels.includes(type));
      assert.ok(!labels.includes(`${type}[]`), 'Only custom records can be repeated');
      assert.match(items.find(item => item.label === type).documentation, /images/);
    }
  }
  for (const type of ['Wysiwyg', 'Markdown']) {
    const result = fixture(`@param content ${type.slice(0, 2)}§${type.slice(2)}`);
    assert.match(getHover(result.project, URI, result.offset).contents, /sanitized HTML/);
    assert.match(getHover(result.project, URI, result.offset).contents, /\{\{& path\}\}/);
    const { labels } = fixture(`@param content ${type} §`);
    for (const option of ['label', 'help', 'required', 'default']) assert.ok(labels.includes(option));
    for (const option of ['sizes', 'aspect_ratio', 'min_items', 'options']) assert.ok(!labels.includes(option));
  }
});

test('formatted completions select editor paths and preserve the operator when replacing a name', () => {
  for (const expression of ['{{&§}}', '{{ & § }}', '{{&bo§dy}}', '{{\t&\t§}}']) {
    const result = fixture(layout(expression));
    assert.deepEqual(result.labels, ['article', 'body', 'notes'], expression);
    const replacement = result.items.find(item => item.label === 'body').range;
    assert.equal(result.text.slice(replacement.start, replacement.end), expression.includes('bo§dy') ? 'body' : '');
    assert.ok(result.text.slice(0, replacement.start).endsWith(expression.includes('bo§dy') ? '{{&' : expression.split('§')[0]));
  }
  assert.deepEqual(fixture(layout('{{& article.§}}')).labels, ['body', 'notes']);
  assert.deepEqual(fixture(layout('{{& articles.§}}')).labels, []);
  assert.ok(fixture(layout('{{§}}')).labels.includes('title'), 'Ordinary interpolation remains unrestricted');
});

test('formatted paths respect block arguments and nested loop scopes', () => {
  const block = fixture(`${declarations}@block content(body: Article, intro: Markdown)\n{{&body.§}}\n@endblock`);
  assert.deepEqual(block.labels, ['body', 'notes']);
  const nested = fixture(`${declarations}@layout\n@each article in articles:\n@each child in article.children:\n{{&child.no§tes}}\n@endeach\n@endeach\n@endlayout`);
  assert.deepEqual(nested.labels, ['body', 'notes']);
  const definition = getDefinition(nested.project, URI, nested.offset);
  assert.equal(definition.start, nested.text.indexOf('notes Markdown'));
  assert.match(getHover(nested.project, URI, nested.offset).contents, /notes: Markdown/);
  const shadow = fixture(`${declarations}@block content(body: String)\n{{&§}}\n@endblock`);
  assert.ok(!shadow.labels.includes('body'));
  const ended = fixture(`${declarations}@layout\n@each child in articles:\n@endeach\n{{&§}}\n@endlayout`);
  assert.ok(!ended.labels.includes('child'));
});

test('hover and definition resolve formatted fields through included records with exact ranges', () => {
  const fragment = { uri: 'file:///templates/blocks/article.tpl', text: declarations };
  const result = fixture('@include "blocks/article.tpl"\r\n@layout\r\n<article>Привет {{ & article.bo§dy }}</article>\r\n@endlayout', [fragment]);
  const hover = getHover(result.project, URI, result.offset);
  assert.equal(result.text.slice(hover.range.start, hover.range.end), 'body');
  assert.match(hover.contents, /body: Wysiwyg/);
  assert.match(hover.contents, /Article body/);
  assert.match(hover.contents, /Supports images/);
  assert.match(hover.contents, /sanitized HTML/);
  assert.deepEqual(getDefinition(result.project, URI, result.offset), {
    uri: fragment.uri, start: fragment.text.indexOf('body Wysiwyg'), end: fragment.text.indexOf('body Wysiwyg') + 4,
  });
  const render = fixture(`${declarations}@block content(html: Wysiwyg, markdown: Markdown)\n{{&html}}\n@endblock\n@layout\n@render content(body, §)\n@endlayout`);
  assert.deepEqual(render.labels, ['article', 'notes']);
  assert.equal(getSignatureHelp(render.project, URI, render.offset).label, 'content(html: Wysiwyg, markdown: Markdown)');
});

test('configured primitive aliases remain available while cyclic records terminate', () => {
  const source = `@type Empty
@param self Empty
@endtype
@type Recursive
@param self Recursive
@param content RichContent
@endtype
@param empty Empty
@param recursive Recursive
@param alias RichContent
@layout
{{&§}}
@endlayout`;
  assert.deepEqual(fixture(source, [], { customTypes: ['RichContent'] }).labels, ['recursive', 'alias']);
  assert.deepEqual(fixture(source).labels, []);
});

test('malformed operators, triple braces and declaration strings do not create expression suggestions', () => {
  for (const expression of ['{{&&§}}', '{{body & §}}', '{{{&§}}}', '{{&body}} §', '{{&body + §}}']) {
    assert.deepEqual(fixture(layout(expression)).labels, [], expression);
  }
  assert.deepEqual(fixture(`${declarations}@param literal Markdown = "{{&bo§dy}}"`).labels, []);
});

test('the application rich-text template resolves every formatted field', () => {
  const text = fs.readFileSync(path.resolve(__dirname, 'fixtures/rich-text-template.tpl'), 'utf8');
  const project = buildProject([{ uri: URI, text }]);
  const expressions = [...text.matchAll(/\{\{&([A-Za-z.]+)\}\}/g)];
  assert.ok(expressions.length >= 3);
  for (const expression of expressions) {
    const offset = expression.index + 3 + expression[1].length;
    assert.ok(getDefinition(project, URI, offset), expression[0]);
    assert.match(getHover(project, URI, offset).contents, /Wysiwyg|Markdown/);
    assert.ok(getCompletions(project, URI, offset).some(item => item.label === expression[1].split('.').at(-1)), expression[0]);
  }
});

test('formatting preserves rich defaults, image markup and formatted references byte for byte', async () => {
  const defaults = [
    String.raw`@param body Wysiwyg = "<p>Hello  <strong>world</strong></p><img src=\"assets/photo.jpg\" alt=\"A photo\">"`,
    String.raw`@param notes Markdown = "## Details\n\n![A photo](assets/photo.jpg)\n\n**Bold** and [a link](https://example.com)."`,
  ];
  const expressions = ['{{&body}}', '{{ & notes }}', '{{& item.body}}'];
  const source = `${defaults.join('\n')}\n@block content(item: Article)\n<article>${expressions.join('</article><article>')}</article>\n@endblock`;
  const formatted = await formatDocument(source);
  assert.notEqual(formatted, source);
  for (const value of [...defaults, ...expressions]) assert.ok(formatted.includes(value), value);
  assert.equal(await formatDocument(formatted), formatted);
});
