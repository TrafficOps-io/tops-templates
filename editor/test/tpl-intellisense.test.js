import test from 'node:test';
import assert from 'node:assert/strict';
import { URI } from 'monaco-editor/base/common/uri.js';
import language from '@trafficops/template-language';
import { registerTplIntelliSense, completionItem, modelRange } from '@trafficops/template-editor-monaco/intellisense';

const safeDialect = () => ({ schema: 1, id: 'safe-html-v1' });
const itemKinds = { Keyword: 17, Variable: 4, Field: 3, Property: 9, Struct: 6, Function: 1, File: 20, Text: 18 };
function harness(readFiles = () => ({}), getDialect = safeDialect) {
  const providers = {}, calls = [], disposed = [];
  const languages = { CompletionItemKind: itemKinds, CompletionItemInsertTextRule: { InsertAsSnippet: 4 } };
  for (const name of ['CompletionItem', 'Hover', 'SignatureHelp', 'Definition']) {
    languages[`register${name}Provider`] = (id, provider) => {
      assert.ok(['trafficops-tpl', 'trafficops-tpl-trusted'].includes(id)); providers[name] = provider; calls.push(name);
      return { dispose: () => disposed.push(name) };
    };
  }
  const monaco = { languages, Uri: URI };
  const registration = registerTplIntelliSense(monaco, { getDialect, getProjectFiles: readFiles });
  return { monaco, providers, calls, disposed, registration };
}
function model(source, path = 'index.tpl') {
  let text = source.replace('§', ''), version = 1;
  let cursor = Math.max(0, source.indexOf('§'));
  const api = {
    uri: URI.from({ scheme: 'trafficops-template', authority: 'project', path: `/${path}` }),
    getVersionId: () => version,
    getValue: () => text,
    isDisposed: () => false,
    getPositionAt(offset) {
      const preceding = text.slice(0, offset).split(/\r\n|\r|\n/);
      return { lineNumber: preceding.length, column: preceding.at(-1).length + 1 };
    },
    getOffsetAt(position) {
      const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)];
      return (lines[position.lineNumber - 1]?.index || 0) + position.column - 1;
    },
    getLineContent(lineNumber) { return text.split(/\r\n|\r|\n/)[lineNumber - 1] || ''; },
    setSource(next) { cursor = Math.max(0, next.indexOf('§')); text = next.replace('§', ''); version++; },
    position: () => api.getPositionAt(cursor),
  };
  return api;
}
const suggestions = (h, m, token = {}) => h.providers.CompletionItem.provideCompletionItems(m, m.position(), {}, token).suggestions;
const labels = items => items.map(item => item.label);
const declarations = '@type Card\n@param heading String help="Card heading"\n@endtype\n@block card(value: Card, accent: Color)\n<p>{{value.heading}}</p>\n@endblock';

function directCore(m, files = {}) {
  const uri = m.uri.toString();
  const documents = [{ uri, text: m.getValue() }, ...Object.entries(files).map(([path, text]) => ({ uri: m.uri.with({ path: `/${path}` }).toString(), text }))];
  const project = language.buildProject(documents, { dialect: 'safe-html-v1' });
  return language.getCompletions(project, uri, m.getOffsetAt(m.position()));
}

test('real language core supplies Monaco snippets, kinds and replacement ranges', () => {
  const h = harness(), m = model('  @pa§ram');
  const values = suggestions(h, m), raw = directCore(m);
  assert.equal(values.length, 1); assert.equal(values[0].label, '@param');
  assert.equal(values[0].insertText, raw[0].insertText); assert.equal(values[0].insertTextRules, 4); assert.equal(values[0].kind, itemKinds.Keyword);
  assert.deepEqual(values[0].range, { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 9 });
  assert.equal(values[0].documentation.isTrusted, false);
  m.setSource('@pa§ram title String');
  const existing = suggestions(h, m)[0]; assert.equal(existing.insertText, '@param'); assert.equal(existing.insertTextRules, undefined);
  m.setSource('@param title String la§bel="Title"');
  const label = suggestions(h, m).find(item => item.label === 'label'); assert.equal(label.insertText, 'label'); assert.equal(label.insertTextRules, undefined);
  for (const trigger of ['@', '{', '.', ' ', ':', '(', '"', "'", '/', '[']) assert.ok(h.providers.CompletionItem.triggerCharacters.includes(trigger));
});

test('UTF-16 completion and hover ranges retain emoji and CRLF positions', () => {
  const h = harness(), m = model('@param title String\r\n@layout\r\n<p>😀 {{tit§le}}</p>\r\n@endlayout');
  const range = { startLineNumber: 3, startColumn: 9, endLineNumber: 3, endColumn: 14 };
  assert.deepEqual(suggestions(h, m).find(item => item.label === 'title').range, range);
  const hover = h.providers.Hover.provideHover(m, m.position(), {});
  assert.deepEqual(hover.range, range); assert.match(hover.contents[0].value, /title: String/);
  assert.equal(hover.contents[0].isTrusted, false); assert.equal(hover.contents[0].supportHtml, false);
});

test('unsaved model replaces the snapshot and excludes executable/binary companion files', () => {
  const files = { 'index.tpl': '@param stale String', 'rules.tpl.php': '@param leaked String', 'styles.css': '@param cssLeak String', 'binary.tpl': new Uint8Array([1, 2]) };
  const h = harness(() => files), m = model('@param current Markdown\n@layout\n{{§}}');
  assert.deepEqual(labels(suggestions(h, m)), ['current']);
  m.setSource('@param fresh String\n@layout\n{{§}}');
  assert.deepEqual(labels(suggestions(h, m)), ['fresh']);
  const newFile = model('@param newest String\n{{§}}', 'new.tpl.html');
  assert.ok(labels(suggestions(h, newFile)).includes('newest'));
});

test('included and companion declarations provide types, fields, blocks and parameter hints', () => {
  const files = { 'blocks/card.tpl': declarations, 'other.tpl.html': '@param accent Color' };
  const h = harness(() => files), m = model('@include "blocks/card.tpl"\n@param item Ca§rd[]');
  const type = suggestions(h, m).find(item => item.label === 'Card[]');
  assert.ok(type); assert.equal(type.kind, itemKinds.Struct); assert.deepEqual(type.range, { startLineNumber: 2, startColumn: 13, endLineNumber: 2, endColumn: 19 });
  m.setSource('@param item Card\n@layout\n{{item.§}}');
  assert.deepEqual(labels(suggestions(h, m)), ['heading']);
  files['blocks/card.tpl'] = declarations.replaceAll('heading', 'headline');
  assert.deepEqual(labels(suggestions(h, m)), ['headline']);
  m.setSource('@param item Card\n@layout\n@render ca§');
  assert.equal(suggestions(h, m)[0].label, 'card'); assert.equal(suggestions(h, m)[0].kind, itemKinds.Function);
  m.setSource('@param item Card\n@layout\n@render card(item, §)');
  assert.deepEqual(labels(suggestions(h, m)), ['accent']);
  const signature = h.providers.SignatureHelp.provideSignatureHelp(m, m.position(), {});
  assert.equal(signature.value.signatures[0].label, 'card(value: Card, accent: Color)');
  assert.equal(signature.value.signatures[0].parameters.length, 2); assert.equal(signature.value.activeParameter, 1); assert.equal(signature.value.activeSignature, 0); assert.equal(typeof signature.dispose, 'function');
});

test('safe-html-v1 is explicit: no PHP dialect directives, request bodies or headers', () => {
  const h = harness(), m = model('@§');
  const directives = labels(suggestions(h, m));
  assert.ok(directives.includes('@param')); assert.ok(!directives.includes('@validation')); assert.ok(!directives.includes('@endvalidation'));
  m.setSource('@layout\n{§}'); assert.deepEqual(labels(suggestions(h, m)), ['query', 'locale', 'actions']);
  for (const path of ['headers.', 'body.', 'query.*', 'query.user.']) { m.setSource(`@layout\n{${path}§}`); assert.deepEqual(suggestions(h, m), []); }
  m.setSource('@layout\n{loc§ale}'); assert.equal(suggestions(h, m)[0].insertText, 'locale');
});

test('literal preview JSON, setting strings and PHP suppress DSL help', () => {
  const h = harness(), m = model('@param title String = "@pa§ram"');
  assert.deepEqual(suggestions(h, m), []);
  for (const source of ['@previewData\n{"title":"@pa§ram"}\n@endpreviewData', '<?php "@pa§ram"; ?>']) {
    m.setSource(source); assert.deepEqual(suggestions(h, m), []);
    assert.equal(h.providers.Hover.provideHover(m, m.position(), {}), null);
    assert.equal(h.providers.SignatureHelp.provideSignatureHelp(m, m.position(), {}), null);
  }
});

test('include completion and definitions use the current file directory and project URI', () => {
  const files = { 'pages/blocks/card.tpl': declarations, 'blocks/card.tpl': '@param unrelated String', 'pages/sub/other.tpl.html': '@layout\nHi\n@endlayout' };
  const h = harness(() => files), m = model('@include "blo§cks/card.tpl"', 'pages/index.tpl');
  const values = suggestions(h, m);
  assert.deepEqual(labels(values), ['blocks/card.tpl']);
  assert.equal(values[0].kind, itemKinds.File);
  assert.deepEqual(values[0].range, { startLineNumber: 1, startColumn: 11, endLineNumber: 1, endColumn: 26 });
  const definition = h.providers.Definition.provideDefinition(m, m.position(), {});
  assert.equal(definition.uri.toString(), 'trafficops-template://project/pages/blocks/card.tpl');
  m.setSource('@param item Card\n{{item.hea§ding}}');
  const field = h.providers.Definition.provideDefinition(m, m.position(), {});
  assert.equal(field.uri.toString(), 'trafficops-template://project/pages/blocks/card.tpl');
  assert.deepEqual(field.range, { startLineNumber: 2, startColumn: 8, endLineNumber: 2, endColumn: 15 });
});

test('registration is idempotent, replaceable and disposable', () => {
  const h = harness(() => ({ 'old.tpl': '@param old String' })), m = model('{{§}}');
  assert.ok(labels(suggestions(h, m)).includes('old'));
  const same = registerTplIntelliSense(h.monaco, { getDialect: safeDialect, getProjectFiles: () => ({ 'new.tpl': '@param newValue String' }) });
  assert.equal(same, h.registration); assert.equal(h.calls.length, 8);
  assert.deepEqual(labels(suggestions(h, m)), ['newValue']);
  same.dispose(); same.dispose(); assert.equal(h.disposed.length, 8);
  registerTplIntelliSense(h.monaco, { getDialect: safeDialect, getProjectFiles: () => ({}) }); assert.equal(h.calls.length, 16);
});

test('cache reuses parsed projects and invalidates sibling edits; canceled/stale snapshots return no results', () => {
  const original = language.buildProject;
  let builds = 0;
  language.buildProject = (...args) => { builds++; return original(...args); };
  try {
    const files = { 'shared.tpl': '@param shared String' };
    const h = harness(() => files), m = model('@layout\n{{sha§red}}');
    suggestions(h, m); h.providers.Hover.provideHover(m, m.position(), {}); assert.equal(builds, 1);
    files['shared.tpl'] = '@param updated String'; suggestions(h, m); assert.equal(builds, 2);
    assert.deepEqual(suggestions(h, m, { isCancellationRequested: true }), []); assert.equal(builds, 2);
    registerTplIntelliSense(h.monaco, { getDialect: safeDialect, getProjectFiles: () => { m.setSource('@param changed String\n{{§}}'); return files; } });
    assert.deepEqual(suggestions(h, m), []); assert.equal(builds, 2);
  } finally { language.buildProject = original; }
});

test('mapping falls back to text and zero-width UTF-16 ranges for generic core items', () => {
  const h = harness(), m = model('😀§');
  const item = completionItem(h.monaco, m, { label: 'value', kind: 'other' }, 2);
  assert.equal(item.kind, itemKinds.Text); assert.equal(item.insertText, 'value');
  assert.deepEqual(item.range, modelRange(m, { start: 2, end: 2 })); assert.equal(item.range.startColumn, 3);
});

test('unknown host descriptors return no assistance without entering the language core', () => {
  const original = language.buildProject;
  let builds = 0;
  language.buildProject = (...args) => { builds++; return original(...args); };
  try {
    for (const descriptor of [undefined, null, {}, { schema: 2, id: 'safe-html-v1' }, { schema: 1, id: 'future' }]) {
      const h = harness(() => { assert.fail('unknown descriptors must not read project files'); }, () => descriptor), m = model('@§');
      assert.deepEqual(suggestions(h, m), []);
      for (const method of ['Hover', 'SignatureHelp', 'Definition']) assert.equal(h.providers[method][`provide${method}`](m, m.position(), {}), null);
    }
    assert.equal(builds, 0);
  } finally { language.buildProject = original; }
});

test('two models retain independent dialects and descriptor changes invalidate the cache', () => {
  const descriptors = new WeakMap(), files = { 'request.tpl.php': '@param serverOnly String' };
  const h = harness(() => files, m => descriptors.get(m));
  const safe = model('@§'), trusted = model('@§', 'request.tpl.php');
  descriptors.set(safe, { schema: 1, id: 'safe-html-v1' });
  descriptors.set(trusted, { schema: 1, id: 'fast-landings-v1' });
  assert.ok(!labels(suggestions(h, safe)).includes('@validation'));
  assert.ok(labels(suggestions(h, trusted)).includes('@validation'));
  safe.setSource('@layout\n{§}'); trusted.setSource('@layout\n{§}');
  assert.deepEqual(labels(suggestions(h, safe)), ['query', 'locale', 'actions']);
  assert.deepEqual(labels(suggestions(h, trusted)), ['query', 'headers', 'body']);
  descriptors.set(trusted, { schema: 1, id: 'safe-html-v1' });
  assert.deepEqual(labels(suggestions(h, trusted)), ['query', 'locale', 'actions']);
  descriptors.set(trusted, { schema: 9, id: 'fast-landings-v1' });
  assert.deepEqual(suggestions(h, trusted), []);
  safe.setSource('{{§}}');
  assert.deepEqual(suggestions(h, safe), []);
  descriptors.set(safe, { schema: 1, id: 'fast-landings-v1' });
  assert.ok(labels(suggestions(h, safe)).includes('serverOnly'));
});
