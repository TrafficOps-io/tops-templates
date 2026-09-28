'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const language = require('@trafficops/template-language');
const formatter = require('@trafficops/template-language/formatter');

test('published CommonJS and ESM entry points expose the same language and formatter', async () => {
  assert.equal((await import('@trafficops/template-language')).default, language);
  assert.equal((await import('@trafficops/template-language/formatter')).default, formatter);
  assert.equal(typeof language.buildProject, 'function');
  assert.equal(typeof language.getCompletions, 'function');
  assert.equal(typeof language.phpSpans, 'function');
});

test('host dialect profiles retain distinct runtime and executable capabilities', () => {
  const safe = language.DIALECT_PROFILES['safe-html-v1'];
  const trusted = language.DIALECT_PROFILES['fast-landings-v1'];
  assert.equal(safe.php, false);
  assert.equal(trusted.php, true);
  assert.deepEqual(safe.runtimeSources, ['query', 'locale', 'actions']);
  assert.deepEqual(trusted.runtimeSources, ['query', 'headers', 'body']);
});

test('standalone formatter preserves literal preview data through the package entry point', async () => {
  const source = '@template "Example"\n@previewData\n{"title":"a  b"}\n@endpreviewData\n@layout\n<h1>{{title}}</h1>\n@endlayout\n';
  const formatted = await formatter.formatDocument(source, { tabSize: 2, insertSpaces: true });
  assert.deepEqual(JSON.parse(formatted.match(/@previewData\n([\s\S]*?)\n@endpreviewData/)[1]), { title: 'a  b' });
  assert.equal(await formatter.formatDocument(formatted, { tabSize: 2, insertSpaces: true }), formatted);
});

test('an unknown or missing dialect id falls back to safe-html-v1 and is reported as a diagnostic', () => {
  assert.equal(language.DEFAULT_DIALECT, 'safe-html-v1');
  assert.equal(language.normalizeDialect(undefined), 'safe-html-v1');
  assert.equal(language.normalizeDialect('legacy-v0'), 'safe-html-v1');
  assert.equal(language.normalizeDialect('fast-landings-v1'), 'fast-landings-v1');
  const document = language.parseDocument('index.tpl', '@layout\n<p>{locale}</p>\n@endlayout', { dialect: 'legacy-v0' });
  assert.equal(document.dialect, 'safe-html-v1');
  assert.deepEqual(document.diagnostics.map(issue => issue.message), ['Unknown dialect "legacy-v0"; safe-html-v1 applies. Hosts select safe-html-v1 or fast-landings-v1.']);
  assert.deepEqual(language.parseDocument('index.tpl', '@layout\n<p>{locale}</p>\n@endlayout').diagnostics, []);
});

test('an unknown dialect is a host-configuration warning reported once per document, not a template error', () => {
  const project = language.buildProject([{ uri: 'a.tpl', text: '@layout\nA\n@endlayout' }, { uri: 'b.tpl', text: '@layout\nB\n@endlayout' }], { dialect: 'legacy-v0' });
  for (const uri of ['a.tpl', 'b.tpl']) {
    const unknown = project.documents.get(uri).diagnostics.filter(issue => /Unknown dialect/.test(issue.message));
    assert.equal(unknown.length, 1, uri);
    assert.equal(unknown[0].severity, 'warning');
  }
  const safeOnly = language.parseDocument('index.tpl', '<?php echo 1; ?>', { dialect: 'legacy-v0' }).diagnostics;
  assert.equal(safeOnly.find(issue => /PHP source is unavailable/.test(issue.message)).severity, undefined, 'template errors keep the default error severity');
});
