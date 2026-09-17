'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { formatDocument } = require('../src/formatter');

async function format(source, options) {
  const result = await formatDocument(source, options);
  assert.equal(await formatDocument(result, options), result, 'formatting is idempotent');
  assert.ok(!result.includes('tplfmt'), 'no internal placeholders escape');
  return result;
}

function body(source, tag) {
  return source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`))[1];
}

test('indents author-defined types and sections without rewriting declaration values', async () => {
  const declaration = '@param body Text = "First\\n  Second\\tline" help=\'Keep  two spaces\' required=true';
  const result = await format(`@template "Example" version=1\n@type Comment\n${declaration}\n@endtype\n@section main "Main"\n@param items Comment[] min_items=1\n@endsection`);
  assert.equal(result, `@template "Example" version=1\n@type Comment\n  ${declaration}\n@endtype\n@section main "Main"\n  @param items Comment[] min_items=1\n@endsection\n`);
});

test('never formats HTML-looking values inside DSL declarations', async () => {
  const lines = [
    '@template "Example" description="<script>const x=1;</script>"',
    '@type Article',
    '@param body Text = "<script>const x=1;</script>"',
    '@param css Text = "<style>h1{color:red}</style>" help="<pre>  keep  </pre>"',
    '@endtype',
  ];
  const result = await format(lines.join('\n'));
  assert.deepEqual(result.trimEnd().split('\n').map(line => line.trimStart()), lines);
});

test('preserves AI instructions verbatim on fields, groups, lists and block declarations', async () => {
  const field = '@param body Text aiInstructions="Keep  two spaces, \\"quotes\\", \\n and <script>const x=1;</script>."';
  const group = '@param article Article aiInstructions=\'Use {{body}} as a placeholder.\'';
  const list = '@param items Article[] aiInstructions="Vary the entries."';
  const block = '@block item(value: Article) aiInstructions="Explain (briefly), fake: String."';
  const result = await format(`@type Article\n${field}\n@endtype\n${group}\n${list}\n${block}\n<p>{{value.body}}</p>\n@endblock`, { printWidth: 40 });
  for (const declaration of [field, group, list, block]) {
    assert.ok(result.split('\n').some(line => line.trimStart() === declaration));
  }
});

test('formats HTML and nested own-line control directives together', async () => {
  const result = await format('@block comments(items: Comment[])\n<div>\n@if items\n@each comment in items:\n<article><h2>{{comment.name}}</h2><p>{{comment.body}}</p></article>\n@render avatar(comment)\n@endeach\n@endif\n</div>\n@endblock');
  assert.match(result, /@block comments\(items: Comment\[\]\)\n  <div>\n    @if items\n      @each comment in items:\n        <article>\n          <h2>\{\{comment.name\}\}<\/h2>/);
  assert.match(result, /        @render avatar\(comment\)\n      @endeach\n    @endif\n  <\/div>\n@endblock/);
});

test('formats a full layout with actual CSS at-rules and JavaScript', async () => {
  const result = await format('@layout\n<!doctype html><html><head><style>:root{--primary:{{ primary }};--size:{{fontSize}}px}@media(max-width:600px){.card{color:var(--primary);padding:12px}}</style></head><body><section><h1>{{title}}</h1></section><script>const values=[1,2].map((value)=>({value:value*2}));</script></body></html>\n@endlayout');
  assert.match(result, /@layout\n  <!doctype html>\n  <html>/);
  assert.match(result, /--primary: \{\{ primary \}\};\n +--size: \{\{fontSize\}\}px;/);
  assert.match(result, /@media \(max-width: 600px\) \{\n +\.card \{\n +color: var\(--primary\);/);
  assert.match(result, /const values = \[1, 2\]\.map\(\(value\) => \(\{ value: value \* 2 \}\)\);/);
  assert.match(result, /<section>\n +<h1>\{\{title\}\}<\/h1>\n +<\/section>/);
});

test('keeps inline spans and interpolations including raw interpolation syntax', async () => {
  const result = await format('@layout\n<p><span>one</span> <span>{{ two }}</span> {{{trusted}}}</p>\n<a href="{{ link.url }}" title="{{ link.title }}">{{link.label}}</a>\n@endlayout');
  assert.match(result, /<span>one<\/span> <span>\{\{ two \}\}<\/span> \{\{\{trusted\}\}\}/);
  assert.match(result, /href="\{\{ link.url \}\}" title="\{\{ link.title \}\}"/);
});

test('preserves every byte of pre and textarea content including edge newlines', async () => {
  const pre = '\n  first\n    <b> second </b>\n\n last  \n';
  const textarea = '\n  {{body}}\n  more\t text  ';
  const source = `@layout\n<div><pre>${pre}</pre><textarea>${textarea}</textarea></div>\n@endlayout`;
  const result = await format(source);
  assert.equal(body(result, 'pre'), pre);
  assert.equal(body(result, 'textarea'), textarea);
  assert.match(result, /@layout\n  <div>/);
});

test('preserves explicit whitespace-sensitive style bodies including nested elements', async () => {
  for (const mode of ['pre', 'pre-wrap', 'pre-line', 'break-spaces']) {
    const content = '  a   b\n <div> c  d </div>\n e  ';
    const source = `@layout\n<div style="white-space: ${mode}">${content}</div>\n@endlayout`;
    const result = await format(source);
    assert.ok(result.includes(`>${content}</div>`), mode);
  }
});

test('formats code without changing strings, multiline template literals or tagged templates', async () => {
  const code = `const quoted='a\\n\\t"b';const value=2;const template=\`first\n  second \${value+1}\n    third  \`;const raw=String.raw\`\\n  \\t literal\`;globalThis.result={quoted,template,raw};`;
  const result = await format(`@layout\n<div><script>${code}</script></div>\n@endlayout`);
  assert.match(result, /const value = 2;/);
  assert.ok(result.includes("'a\\n\\t\"b'"));
  assert.ok(result.includes('`first\n  second ${value+1}\n    third  `'));
  assert.ok(result.includes('String.raw`\\n  \\t literal`'));
  const before = {}; const after = {};
  vm.runInNewContext(code, before);
  vm.runInNewContext(body(result, 'script'), after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result));
});

test('quoted object property names remain restorable while surrounding JS is formatted', async () => {
  const result = await format('@layout\n<script>const data={"foo":1,\'bar\':2};globalThis.value=data.foo+data.bar;</script>\n@endlayout');
  assert.match(result, /const data = \{ "foo": 1, 'bar': 2 \};/);
  assert.match(result, /globalThis.value = data.foo \+ data.bar;/);
});

test('formats nested DSL control lines inside JavaScript and CSS', async () => {
  const result = await format('@layout\n<style>\n.card{\n@if enabled\ncolor:red;\n@endif\n}\n</style>\n<script>\n@if enabled\nconst x={a:1};\n@endif\n</script>\n@endlayout');
  assert.match(result, /\.card \{\n +@if enabled\n +color: red;\n +@endif\n +\}/);
  assert.match(result, /<script>\n    @if enabled\n      const x = \{ a: 1 \};\n    @endif\n  <\/script>/);
});

test('formats escaped CSS at-rules and protects newly own-line unknown at-rules', async () => {
  const result = await format('@layout\n<style>\n@@media (max-width:600px){.card{color:red}}\n.card{@custom foo{color:blue}}\n</style>\n@endlayout');
  assert.match(result, /@@media \(max-width: 600px\) \{\n +\.card \{\n +color: red;/);
  assert.match(result, /@@custom foo \{\n +color: blue;/);
  assert.ok(!/^\s*@custom\b/m.test(result));
});

test('data-type and attribute values mentioning type do not disable JavaScript formatting', async () => {
  const result = await format('@layout\n<script data-type="text/x-template" title=" type=unknown">const value={a:1};</script>\n@endlayout');
  assert.match(result, /const value = \{ a: 1 \};/);
  const html = await format('@layout\n<div data-style="white-space: pre"><h1>Hello</h1></div>\n@endlayout');
  assert.match(html, /<div data-style="white-space: pre">\n +<h1>Hello<\/h1>/);
});

test('DSL inside a JS literal remains exact while neighboring fragments format', async () => {
  const code = '\nconst value=`hello\n@if enabled\nworld\n@endif\n`;\n';
  const result = await format(`@layout\n<script>${code}</script>\n<style>h1{color:red}</style>\n@endlayout`);
  assert.equal(body(result, 'script'), code);
  assert.match(result, /h1 \{\n +color: red;/);
});

test('an incomplete embedded fragment is preserved while other fragments format', async () => {
  const broken = '\n  const value = {\n';
  const result = await format(`@layout\n<div><h1>Hello</h1><p>World</p></div>\n<script>${broken}</script>\n<style>h1{color:red}</style>\n@endlayout`);
  assert.equal(body(result, 'script'), broken);
  assert.match(result, /<div>\n    <h1>Hello<\/h1>\n    <p>World<\/p>/);
  assert.match(result, /h1 \{\n +color: red;/);
});

test('malformed HTML in one block does not prevent formatting independent blocks', async () => {
  const result = await format('@type A\n@param name String\n@endtype\n@block broken()\n<div><span></div>\n@endblock\n@layout\n<section><h1>Hello</h1></section>\n@endlayout');
  assert.match(result, /@type A\n  @param name String/);
  assert.ok(result.includes('<div><span></div>'));
  assert.match(result, /@layout\n  <section>\n    <h1>Hello<\/h1>\n  <\/section>/);
});

test('incomplete DSL receives indentation without inventing closing directives', async () => {
  const result = await format('@type Comment\n@param name String');
  assert.equal(result, '@type Comment\n  @param name String\n');
  const layout = await format('@layout\n<div>\n@if enabled\n<p>Hello</p>\n</div>');
  assert.ok(!layout.includes('@endif'));
  assert.ok(!layout.includes('@endlayout'));
});

test('supports standalone HTML include fragments and empty inputs', async () => {
  assert.equal(await formatDocument(''), '');
  assert.equal(await format('<section><h1>{{title}}</h1><p>Hello</p></section>'), '<section>\n  <h1>{{title}}</h1>\n  <p>Hello</p>\n</section>\n');
});

test('honors tabs, custom indentation, CRLF and a BOM', async () => {
  const source = '\uFEFF@type Entry\r\n@param title String\r\n@endtype\r\n@layout\r\n<div><h1>Hello</h1></div>\r\n@endlayout\r\n';
  const tabs = await format(source, { tabSize: 4, insertSpaces: false });
  assert.ok(tabs.startsWith('\uFEFF@type Entry\r\n\t@param'));
  assert.ok(tabs.includes('\r\n\t<div>\r\n\t\t<h1>'));
  assert.ok(!/(?<!\r)\n/.test(tabs));
  const spaces = await format(source, { tabSize: 4, insertSpaces: true });
  assert.ok(spaces.includes('\r\n    @param'));
  assert.ok(spaces.includes('\r\n        <h1>'));
});

test('inline at-signs never become own-line runtime directives when HTML wraps', async () => {
  const result = await format('@layout\n<p class="long-paragraph">@reader This is a fairly long paragraph that will wrap across more than one physical line when it gets formatted.</p>\n<p>Contact a@example.com for information.</p>\n<div>\n@@literal Keep this escaped at sign.\n</div>\n@endlayout', { printWidth: 40 });
  assert.ok(!/^\s*@reader\b/m.test(result));
  assert.ok(result.includes('@reader'));
  assert.ok(result.includes('a@example.com'));
  assert.match(result, /^\s*@@literal Keep this escaped at sign\.$/m);
});

test('a tag-looking attribute, comment or JavaScript string is not treated as another raw element', async () => {
  const source = '@layout\n<!-- <script>const x=1;</script> -->\n<div title="<style>h1{color:red}</style>">Text</div>\n<script>const text="<pre>  keep </pre>";const data={a:1};</script>\n@endlayout';
  const result = await format(source);
  assert.ok(result.includes('<!-- <script>const x=1;</script> -->'));
  assert.ok(result.includes('title="<style>h1{color:red}</style>"'));
  assert.ok(result.includes('"<pre>  keep </pre>"'));
  assert.ok(result.includes('const data = { a: 1 };'));
});

test('unknown script types and prettier-ignore fragments retain their content', async () => {
  const raw = '<div>  {{some.value}}\n   more </div>';
  const ignored = '\nconst values=[1,2];\n';
  const result = await format(`@layout\n<script type="text/x-template">${raw}</script>\n<!-- prettier-ignore -->\n<script>${ignored}</script>\n<!-- prettier-ignore -->\n<div class="preserve">  two   spaces\n   three </div>\n<style>p{color:red}</style>\n@endlayout`);
  assert.ok(result.includes(raw));
  assert.ok(result.includes(`<script>${ignored}</script>`));
  assert.ok(result.includes('<div class="preserve">  two   spaces\n   three </div>'));
  assert.match(result, /p \{\n +color: red;/);
});

test('placeholder-looking user text is preserved with collision-free markers', async () => {
  const source = '@type Example\n@param title String = "tplfmtx0z tplfmtxx1z"\n@endtype\n@layout\n<p>tplfmtx0z tplfmtxx1z {{title}}</p>\n@endlayout';
  const result = await formatDocument(source);
  assert.ok(result.includes('"tplfmtx0z tplfmtxx1z"'));
  assert.ok(result.includes('<p>tplfmtx0z tplfmtxx1z {{title}}</p>'));
  assert.equal(await formatDocument(result), result);
});

test('preserves image crop metadata inside nested type declarations', async () => {
  const declarations = ['@param cover Image aspect_ratio="16:9" label="Cover image"', '@param avatar Image sizes="128x128|256x256"', '@param banner Image aspect_ratio=1.5'];
  const formatted = await format(`@type Card\n${declarations.join('\n')}\n@endtype\n@param cards Card[] min_items=1`, { printWidth: 40 });
  for (const declaration of declarations) assert.ok(formatted.split('\n').includes(`  ${declaration}`));
});

test('formats validation blocks and protects runtime macros in HTML, CSS and scripts', async () => {
  const source = '@validation query fallback="/error"\n@param pixel String lenght=10 required\n@endvalidation\n@layout\n<main><h1>{body.user.first-name}</h1><a href="?subid={query.subid}">{headers.user-agent}</a></main>\n<script>const payload="{body.*}";const name="{body.name}";</script>\n<style>.item{content:"{query.subid}"}</style>\n@endlayout';
  const result = await format(source);
  assert.match(result, /@validation query fallback="\/error"\n  @param pixel String lenght=10 required\n@endvalidation/);
  for (const macro of ['{body.user.first-name}', '{query.subid}', '{headers.user-agent}', '{body.*}', '{body.name}']) assert.ok(result.includes(macro));
  assert.match(result, /const payload = "\{body\.\*\}";/);
});

test('formatting keeps PHP code opaque including closing tags inside strings and heredocs', async () => {
  const php = `<?php
$value="?> {body.name}";
/* ?> @param fake String */
$text = <<<'TEXT'
@validation body fallback="/fake"
@param fake String
@endvalidation
TEXT;
echo $value;
?>`;
  const result = await format(`@layout\n${php}\n<div><p>{body.name}</p></div>\n<span><?= $value ?></span>\n@endlayout`);
  assert.ok(result.includes(php));
  assert.ok(result.includes('<?= $value ?>'));
  assert.match(result, /<div>\n\s+<p>\{body.name\}<\/p>\n\s+<\/div>/);
});

test('preserves safe-dialect locale/actions tokens even where JavaScript would reinterpret braces', async () => {
  const source = '@layout\n<html lang="{locale}"><body><form action="{actions.submit}"><a href="/search?q={query.q}">{locale}</a></form><script>const value={locale};const action={actions.submit};</script><style>.card{background:url({actions.open});content:"{locale}"}</style></body></html>\n@endlayout';
  const result = await format(source);
  for (const token of ['{locale}', '{actions.submit}', '{actions.open}', '{query.q}']) {
    assert.equal(result.split(token).length, source.split(token).length, token);
  }
  assert.match(result, /const value = \{locale\};/);
  assert.match(result, /const action = \{actions\.submit\};/);
  assert.ok(!result.includes('{ locale }'));
});

test('preserves multiline HTML comment contents containing directives, tags and runtime tokens', async () => {
  const comment = '<!-- Keep  two spaces\n  literal {{title}} {locale}\n @not_a_directive\n  <script>let x=1;</script>\n-->';
  const result = await format(`@layout\n${comment}\n<div><h1>{{title}}</h1></div>\n@endlayout`);
  assert.ok(result.includes(comment));
  assert.match(result, /<div>\n    <h1>/);
});
