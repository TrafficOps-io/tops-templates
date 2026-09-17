'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDocument, buildProject, getCompletions, getHover, getDefinition } = require('../src/language');
const { formatDocument } = require('../src/formatter');

const uri = 'file:///templates/template.tpl';
const parse = text => parseDocument(uri, text);
const project = text => buildProject([{ uri, text }]);
const completions = text => getCompletions(project(text), uri, text.length);

test('parses optional preview metadata without changing parameter defaults', () => {
  const data = { title: 'Preview title', items: [{ name: 'Demo' }] };
  for (const metadata of [
    `@template "Demo" previewData='${JSON.stringify(data)}'`,
    `@template "Demo"\n@previewData\n${JSON.stringify(data)}\n@endpreviewData`,
  ]) {
    const document = parse(`${metadata}\n@param title String default="Real default"`);
    assert.deepEqual(document.metadata.previewData, data);
    assert.equal(document.params[0].options.default, 'Real default');
    assert.deepEqual(document.diagnostics, []);
  }
  assert.deepEqual(parse('@template "Demo"').metadata, {});
  assert.equal(parse('@template "Demo" previewUrl="https://example.com/demo"').metadata.previewUrl, 'https://example.com/demo');
  assert.deepEqual(parse('@template "Demo" previewUrl="https://example.com/demo"\n@previewData\n{}\n@endpreviewData').diagnostics, []);
});

test('reports malformed, non-object, duplicate and incomplete preview data', () => {
  for (const json of ['[]', 'null', '"string"', '10', 'true', '{"title":}']) {
    assert.match(parse(`@previewData\n${json}\n@endpreviewData`).diagnostics[0].message, /valid JSON object/);
    assert.match(parse(`@template "Demo" previewData='${json}'`).diagnostics[0].message, /valid JSON object/);
  }
  assert.match(parse('@previewData\n{}').diagnostics[0].message, /Close @previewData/);
  assert.match(parse('@endpreviewData').diagnostics[0].message, /no matching/);
  assert.match(parse('@template "Demo" previewData=\'{}\'\n@previewData\n{}\n@endpreviewData').diagnostics[0].message, /only once/);
  assert.match(parse('@previewData\n{}\n@endpreviewData\n@previewData\n{}\n@endpreviewData').diagnostics[0].message, /only once/);
  assert.match(parse('@template "Demo" previewData=\'{}\' previewData=\'{}\'').diagnostics[0].message, /only once/);
  assert.match(parse('@section main "Main"\n@previewData\n{}\n@endpreviewData\n@endsection').diagnostics[0].message, /top level/);
  for (const url of ['demo.html', 'ftp://example.com/demo', 'https://user:pass@example.com/demo', 'https://example.com:8080/demo']) {
    assert.match(parse(`@template "Demo" previewUrl="${url}"`).diagnostics[0].message, /HTTP\(S\) URL/);
  }
});

test('preview data is literal JSON rather than template expressions or includes', () => {
  const text = '@param title String\n@previewData\n{ "body": "{{title}}" }\n@include "not-a-template.tpl"\n@param fake String\n@endpreviewData';
  const document = parse(text);
  assert.deepEqual(document.includes, []);
  assert.deepEqual(document.params.map(param => param.name), ['title']);
  const compiled = project(text);
  const offset = text.indexOf('{{title}}') + 5;
  assert.deepEqual(getCompletions(compiled, uri, offset), []);
  assert.equal(getHover(compiled, uri, offset), null);
  assert.equal(getDefinition(compiled, uri, offset), null);
  assert.deepEqual(completions('@previewData\n{\n'), []);
});

test('offers preview options and snippets only in template metadata contexts', () => {
  const items = completions('@template "Demo" ');
  assert.ok(items.find(item => item.label === 'previewUrl').insertText.includes('https://'));
  assert.ok(items.find(item => item.label === 'previewData').insertText.includes('Demo'));
  assert.ok(completions('@preview').find(item => item.label === '@previewData').insertText.includes('@endpreviewData'));
  assert.ok(!completions('@param title String ').some(item => item.label === 'previewUrl'));
  assert.ok(!completions('@template "Demo" previewUrl="https://example.com" ').some(item => item.label === 'previewUrl'));
  const editing = '@template "Demo" previewUrl="https://example.com"';
  const edit = getCompletions(project(editing), uri, editing.indexOf('previewUrl') + 4).find(item => item.label === 'previewUrl');
  assert.equal(edit.insertText, 'previewUrl');
  assert.equal(edit.snippet, false);
  assert.match(getHover(project(editing), uri, editing.indexOf('previewUrl') + 4).contents, /Takes precedence/);
});

test('formats JSON independently of HTML and preserves preview values and header strings', async () => {
  const data = { title: '{{title}}', body: '<script>const x=1;</script>  <pre> spaces </pre>', items: [{ name: 'Demo' }], escaped: 'line\nnext "quote"' };
  const header = '@template "Demo" previewUrl="https://example.com/demo"';
  const source = `${header}\n@previewData\n${JSON.stringify(data)}\n@endpreviewData\n@param title String = "Default"\n@layout\n<article><h1>{{title}}</h1></article>\n@endlayout`;
  const result = await formatDocument(source);
  assert.equal(await formatDocument(result), result);
  assert.deepEqual(parse(result).metadata.previewData, data);
  assert.ok(result.startsWith(header));
  assert.match(result, /@previewData\n\{\n  "title"/);
  assert.match(result, /@layout\n  <article>\n    <h1>/);
  for (const json of ['{"title":', '[]', 'null']) {
    const invalid = `@previewData\n${json}\n@endpreviewData\n`;
    assert.equal(await formatDocument(invalid), invalid);
  }
  const incomplete = '@previewData\n{ "title": "<p> literal </p>"\n';
  assert.equal(await formatDocument(incomplete), incomplete);
  const inline = `@template "Demo" previewData='${JSON.stringify(data).replaceAll('\\', '\\\\')}'\n`;
  assert.equal(await formatDocument(inline), inline);
});
