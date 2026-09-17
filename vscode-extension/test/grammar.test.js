'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Registry, INITIAL, parseRawGrammar } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');

const root = path.resolve(__dirname, '..');
const scope = 'text.html.fast-landings-tpl';
let grammar;

before(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const grammars = {
    [scope]: 'syntaxes/fast-landings-tpl.tmLanguage.json',
    'fast-landings-tpl.injection': 'syntaxes/injections.json',
    'text.html.basic': 'test/fixtures/html.tmLanguage.json',
    'source.css': 'test/fixtures/css.tmLanguage.json',
    'source.js': 'test/fixtures/javascript.tmLanguage.json',
  };
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (value) => new OnigString(value),
    }),
    loadGrammar: async (name) => {
      const filename = grammars[name] && path.join(root, grammars[name]);
      return filename ? parseRawGrammar(fs.readFileSync(filename, 'utf8'), filename) : null;
    },
    getInjections: (name) => name === scope ? ['fast-landings-tpl.injection'] : [],
  });
  grammar = await registry.loadGrammar(scope);
  assert.ok(grammar);
});

function tokenize(source) {
  let state = INITIAL;
  return source.split(/\r?\n/).map((line) => {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    return { line, tokens: result.tokens };
  });
}

function scopesAt(line, text, occurrence = 0) {
  let index = -1;
  for (let i = 0; i <= occurrence; i++) index = line.line.indexOf(text, index + 1);
  assert.ok(index >= 0, `Missing ${JSON.stringify(text)} in ${JSON.stringify(line.line)}`);
  const token = line.tokens.find((entry) => entry.startIndex <= index && entry.endIndex > index);
  assert.ok(token, `No token at ${index}`);
  return token.scopes;
}

function hasScope(line, text, expected, occurrence = 0) {
  const actual = scopesAt(line, text, occurrence);
  assert.ok(actual.includes(expected), `${JSON.stringify(text)} should have ${expected}: ${actual.join(', ')}`);
}

test('highlights editor types and the formatted operator without leaking into values or HTML', () => {
  const lines = tokenize([
    '@param body Wysiwyg = "<p>A & B</p>"',
    '@param notes Markdown = "![Photo](assets/photo.jpg)"',
    '@block content(body: Wysiwyg, notes: Markdown)',
    '<article>{{&body}}</article>',
    '<section>{{ & item.notes }} &amp; more</section>',
    '<aside>{{notes}}</aside>',
  ].join('\n'));
  const operator = 'keyword.operator.formatted.fast-landings-tpl';
  hasScope(lines[0], 'Wysiwyg', 'support.type.fast-landings-tpl');
  hasScope(lines[1], 'Markdown', 'support.type.fast-landings-tpl');
  hasScope(lines[2], 'Wysiwyg', 'support.type.fast-landings-tpl');
  hasScope(lines[2], 'Markdown', 'support.type.fast-landings-tpl');
  hasScope(lines[3], '&', operator);
  hasScope(lines[4], '&', operator);
  hasScope(lines[4], 'notes', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(lines[4], '.', 'punctuation.accessor.fast-landings-tpl');
  hasScope(lines[3], '{{', 'punctuation.section.interpolation.begin.fast-landings-tpl');
  hasScope(lines[3], '}}', 'punctuation.section.interpolation.end.fast-landings-tpl');
  assert.ok(!scopesAt(lines[0], '&').includes(operator));
  assert.ok(!scopesAt(lines[4], '&amp;').includes(operator));
  assert.ok(!scopesAt(lines[4], 'more').includes('meta.interpolation.fast-landings-tpl'));
  hasScope(lines[5], 'notes', 'variable.other.readwrite.fast-landings-tpl');
});

test('tokenizes author-defined declarations, typed arguments, options and escaped defaults', () => {
  const lines = tokenize([
    '@template "Editorial" description="A landing" version=1',
    '@type Review',
    '@param text Text = "Say \\"hello\\"\\nNext line" label="Text" required=true',
    '@param rating Range = -1.5 min=-2 max=10 step=.5',
    '@param reviews Review[] label="Reviews" min_items=1',
    '@block reviewItem(review: Review, heading: String)',
    '@each review in reviews:',
    '@render reviewItem(review, title)',
  ].join('\n'));
  hasScope(lines[0], '@template', 'keyword.control.directive.fast-landings-tpl');
  hasScope(lines[0], 'description', 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[0], '1', 'constant.numeric.fast-landings-tpl');
  hasScope(lines[1], 'Review', 'entity.name.type.fast-landings-tpl');
  hasScope(lines[2], 'text', 'variable.other.definition.fast-landings-tpl');
  hasScope(lines[2], 'Text', 'support.type.fast-landings-tpl');
  hasScope(lines[2], '\\"', 'constant.character.escape.fast-landings-tpl');
  hasScope(lines[2], '\\n', 'constant.character.escape.fast-landings-tpl');
  hasScope(lines[2], 'true', 'constant.language.boolean.fast-landings-tpl');
  hasScope(lines[3], '-1.5', 'constant.numeric.fast-landings-tpl');
  hasScope(lines[3], '.5', 'constant.numeric.fast-landings-tpl', 1);
  hasScope(lines[4], 'Review', 'support.type.fast-landings-tpl');
  hasScope(lines[4], '[]', 'punctuation.definition.array.fast-landings-tpl');
  hasScope(lines[5], 'reviewItem', 'entity.name.function.fast-landings-tpl');
  hasScope(lines[5], 'review:', 'variable.parameter.fast-landings-tpl');
  hasScope(lines[5], 'Review', 'support.type.fast-landings-tpl');
  hasScope(lines[6], 'review ', 'variable.other.definition.fast-landings-tpl');
  hasScope(lines[6], 'in ', 'keyword.operator.word.fast-landings-tpl');
  hasScope(lines[7], 'reviewItem', 'entity.name.function.fast-landings-tpl');
  hasScope(lines[7], 'title', 'variable.other.readwrite.fast-landings-tpl');
});

test('highlights AI instructions on fields and blocks as options with literal quoted text', () => {
  for (const declaration of ['@param title String', '@param items Comment[]', '@block item(value: Comment)', '@block empty()']) {
    const [line] = tokenize(`${declaration} aiInstructions="Keep (this), fake: Type, {{title}} and \\"quotes\\".\\nNext line"`);
    hasScope(line, 'aiInstructions', 'entity.other.attribute-name.fast-landings-tpl');
    hasScope(line, '=', 'keyword.operator.assignment.fast-landings-tpl');
    for (const literal of ['(this)', 'fake', 'Type', '{{title}}']) {
      hasScope(line, literal, 'string.quoted.double.fast-landings-tpl');
      assert.ok(!scopesAt(line, literal).includes('support.type.fast-landings-tpl'));
    }
    hasScope(line, '\\n', 'constant.character.escape.fast-landings-tpl');
  }
  const [single] = tokenize("@block item() aiInstructions='Use a friendly tone.'");
  hasScope(single, 'friendly', 'string.quoted.single.fast-landings-tpl');
  const [argument] = tokenize('@block item(required: Boolean) aiInstructions="Keep it brief."');
  hasScope(argument, 'required', 'variable.parameter.fast-landings-tpl');
});

test('highlights every DSL v1 directive without treating unknown directives as valid syntax', () => {
  const directives = [
    '@template "Example"', '@section content "Content"', '@endsection',
    '@param title String', '@type Header', '@endtype', '@block header()', '@endblock',
    '@each item in items:', '@endeach', '@render header()', '@if enabled', '@endif',
    '@include "blocks/header.tpl"', '@layout', '@endlayout',
  ];
  tokenize(directives.join('\n')).forEach((line) => {
    hasScope(line, '@', 'keyword.control.directive.fast-landings-tpl');
  });
  for (const line of tokenize('@else\n@unknown\n<p>@param title String</p>')) {
    assert.ok(!scopesAt(line, '@').includes('keyword.control.directive.fast-landings-tpl'));
  }
});

test('highlights preview metadata as literal JSON and restores markup after the block', () => {
  const lines = tokenize([
    '@template "Demo" previewUrl="https://example.com/demo" previewData=\'{"title":"Demo"}\'',
    '@previewData',
    '{ "title": "{{title}}", "body": "<b>literal</b>", "enabled": true, "items": [{"count": 2}] }',
    '@endpreviewData',
    '@layout',
    '<h1>{{title}}</h1>',
    '@endlayout',
  ].join('\n'));
  for (const option of ['previewUrl', 'previewData']) hasScope(lines[0], option, 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[1], '@previewData', 'keyword.control.directive.fast-landings-tpl');
  hasScope(lines[2], '{{title}}', 'string.quoted.double.fast-landings-tpl');
  hasScope(lines[2], 'true', 'constant.language.json');
  hasScope(lines[2], '2', 'constant.numeric.json');
  assert.ok(!scopesAt(lines[2], '{{title}}').includes('meta.interpolation.fast-landings-tpl'));
  hasScope(lines[3], '@endpreviewData', 'keyword.control.directive.fast-landings-tpl');
  hasScope(lines[5], 'h1', 'entity.name.tag.html');
  hasScope(lines[5], 'title', 'variable.other.readwrite.fast-landings-tpl');
});

test('preserves HTML while injecting paths into text and both quoted attribute forms', () => {
  const [line] = tokenize('<img src="{{header.logo}}" alt=\'{{header.title}}\'><span>{{ header.title }}</span>');
  hasScope(line, 'img', 'entity.name.tag.html');
  hasScope(line, 'src', 'entity.other.attribute-name.html');
  hasScope(line, '{{', 'punctuation.section.interpolation.begin.fast-landings-tpl');
  hasScope(line, 'header', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(line, 'logo', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(line, '.', 'punctuation.accessor.fast-landings-tpl');
  hasScope(line, 'title', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(line, 'title', 'variable.other.readwrite.fast-landings-tpl', 1);
  hasScope(line, 'span', 'entity.name.tag.html');
});

test('preserves CSS rules and at-rules while injecting template fields', () => {
  const lines = tokenize([
    '<style>',
    ':root { --brand: {{primary}}; color: {{secondary}}; }',
    '@media (max-width: 600px) { body { display: none; } }',
    '@font-face { font-family: "Example"; src: url("font.woff2"); }',
    '</style>',
    '<p style="color: {{primary}}">Text</p>',
  ].join('\n'));
  hasScope(lines[1], 'primary', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(lines[1], 'secondary', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(lines[1], 'color', 'support.type.property-name.css');
  for (const i of [2, 3]) {
    hasScope(lines[i], '@', 'source.css');
    assert.ok(!scopesAt(lines[i], '@').includes('keyword.control.directive.fast-landings-tpl'));
  }
  hasScope(lines[5], 'primary', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(lines[5], 'p ', 'entity.name.tag.html');
});

test('preserves JavaScript and injects fields into script strings', () => {
  const lines = tokenize([
    '<script>',
    'const heading = "Title: {{title}}";',
    'document.body.dataset.heading = heading;',
    '</script>',
    '<p>{{title}}</p>',
  ].join('\n'));
  hasScope(lines[1], 'const', 'storage.type.js');
  hasScope(lines[1], 'title', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(lines[2], 'document', 'source.js');
  hasScope(lines[4], 'p>', 'entity.name.tag.html');
});

test('recovers from incomplete strings and interpolation on the next line', () => {
  const lines = tokenize([
    '@param title String = "unfinished',
    '@layout',
    '<h1>{{title',
    '<p>Recovered</p>',
    '@endlayout',
  ].join('\n'));
  hasScope(lines[1], '@layout', 'keyword.control.directive.fast-landings-tpl');
  hasScope(lines[2], 'title', 'variable.other.readwrite.fast-landings-tpl');
  hasScope(lines[3], 'p>', 'entity.name.tag.html');
  assert.ok(!scopesAt(lines[3], 'Recovered').includes('meta.interpolation.fast-landings-tpl'));
});

test('does not interpret escaped directive lines or quoted declaration values as directives/interpolation', () => {
  const lines = tokenize([
    '@@param literal String',
    '  @@render literal()',
    '@param title String = "{{literal}} and @render literal()"',
    '@param text Text = \'A \\\'quote\\\'\' required=false',
  ].join('\n'));
  for (const i of [0, 1]) {
    hasScope(lines[i], '@@', 'constant.character.escape.fast-landings-tpl');
    assert.ok(!scopesAt(lines[i], '@@').includes('keyword.control.directive.fast-landings-tpl'));
  }
  hasScope(lines[2], 'literal', 'string.quoted.double.fast-landings-tpl');
  assert.ok(!scopesAt(lines[2], 'literal').includes('meta.interpolation.fast-landings-tpl'));
  hasScope(lines[3], '\\\'', 'constant.character.escape.fast-landings-tpl');
  hasScope(lines[3], 'false', 'constant.language.boolean.fast-landings-tpl');
});

test('tokenizes the real article example, including all interpolations and embedded assets', () => {
  const filename = path.resolve(root, 'test/fixtures/article-template.html');
  const source = fs.readFileSync(filename, 'utf8');
  const lines = tokenize(source);
  let interpolationCount = 0;
  for (const line of lines) {
    let occurrence = 0;
    for (const _ of line.line.matchAll(/\{\{/g)) {
      hasScope(line, '{{', 'punctuation.section.interpolation.begin.fast-landings-tpl', occurrence++);
      interpolationCount++;
    }
  }
  assert.ok(interpolationCount > 20, 'Exercise the full example, including its CSS variables');
  hasScope(lines.find((line) => line.line.startsWith('@media')), '@media', 'source.css');
  hasScope(lines.find((line) => line.line.startsWith('document.querySelectorAll')), 'document', 'source.js');
});

test('highlights image crop options, ratio strings, numeric ratios and size lists', () => {
  const lines = tokenize('@param cover Image aspect_ratio="16:9"\n@param avatar Image sizes="128x128|256x256"\n@param banner Image aspect_ratio=1.5');
  hasScope(lines[0], 'Image', 'support.type.fast-landings-tpl');
  hasScope(lines[0], 'aspect_ratio', 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[0], '16:9', 'string.quoted.double.fast-landings-tpl');
  hasScope(lines[1], 'sizes', 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[1], '128x128|256x256', 'string.quoted.double.fast-landings-tpl');
  hasScope(lines[2], '1.5', 'constant.numeric.fast-landings-tpl');
});

test('highlights request validations and runtime macros without confusing template interpolation', () => {
  const lines = tokenize([
    '@validation body fallback="/error"',
    '@param user.first-name String min=4 required mask="..."',
    '@param pixel String lenght=10',
    '@endvalidation',
    '<h1>{body.user.first-name}</h1>',
    '<a href="?id={query.subid}">{headers.user-agent} {body.*}</a>',
    '@param thanks String = "Thanks {body.user.first-name}"',
    '<p>{{title}}</p>',
  ].join('\n'));
  hasScope(lines[0], '@validation', 'keyword.control.directive.fast-landings-tpl');
  hasScope(lines[0], 'body', 'variable.language.runtime-source.fast-landings-tpl');
  hasScope(lines[0], 'fallback', 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[1], 'user.first-name', 'variable.other.definition.fast-landings-tpl');
  hasScope(lines[1], 'String', 'support.type.fast-landings-tpl');
  hasScope(lines[1], 'required', 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[2], 'lenght', 'entity.other.attribute-name.fast-landings-tpl');
  hasScope(lines[3], '@endvalidation', 'keyword.control.directive.fast-landings-tpl');
  hasScope(lines[4], 'first-name', 'variable.other.runtime.fast-landings-tpl');
  hasScope(lines[5], 'subid', 'variable.other.runtime.fast-landings-tpl');
  hasScope(lines[5], 'user-agent', 'variable.other.runtime.fast-landings-tpl');
  hasScope(lines[5], '*', 'variable.other.runtime.fast-landings-tpl');
  hasScope(lines[6], 'first-name', 'variable.other.runtime.fast-landings-tpl');
  hasScope(lines[7], 'title', 'variable.other.readwrite.fast-landings-tpl');
});

test('runtime macros inject into script strings but never PHP or preview JSON', () => {
  const lines = tokenize([
    '<script>const value="{body.name}";</script>',
    '<?php',
    '$text = "?> {body.name}";',
    '/* ?> @validation body fallback="/fake" */',
    "$value = <<<'TEXT'",
    '@param fake String',
    '{body.fake}',
    'TEXT;',
    '?>',
    '@previewData',
    '{"text":"{body.name}"}',
    '@endpreviewData',
    '<p>{body.name}</p>',
  ].join('\n'));
  hasScope(lines[0], 'name', 'variable.other.runtime.fast-landings-tpl');
  for (const [index, text] of [[2, 'body'], [3, '@validation'], [5, '@param'], [6, 'body']]) {
    hasScope(lines[index], text, 'source.php');
    assert.ok(!scopesAt(lines[index], text).includes('variable.other.runtime.fast-landings-tpl'));
    assert.ok(!scopesAt(lines[index], text).includes('keyword.control.directive.fast-landings-tpl'));
  }
  assert.ok(!scopesAt(lines[10], 'body').includes('meta.runtime-macro.fast-landings-tpl'));
  hasScope(lines[12], 'name', 'variable.other.runtime.fast-landings-tpl');
});

test('escaped runtime macros remain literal in markup, attributes and setting defaults', () => {
  const lines = tokenize('<p title="\\{query.subid}">\\{body.name}</p>\n@param thanks String = "Hello \\{body.name}"');
  for (const [index, value] of [[0, 'query'], [0, 'body'], [1, 'body']]) {
    assert.ok(!scopesAt(lines[index], value).includes('meta.runtime-macro.fast-landings-tpl'));
    hasScope(lines[index], value, 'constant.character.escape.fast-landings-tpl');
  }
});
