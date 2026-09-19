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
