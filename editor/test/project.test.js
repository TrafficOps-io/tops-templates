import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { createZip, inspectZip, LIMITS, readZip, renameFile, safePath, validateProject } from '../src/project.js';
import { resolveAsset } from '../src/preview.js';
import { starterProject } from '../src/starter.js';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';

test('ZIP round trip preserves UTF-8 source, relative asset paths and binary bytes', () => {
  const files = { 'index.tpl': '@layout\n<h1>Привет</h1>\n@endlayout', 'images/a.png': new Uint8Array([0, 127, 255, 12]) };
  assert.deepEqual({ ...readZip(createZip(files)) }, files);
});
test('project archives may have a single enclosing folder', () => {
  const files = readZip(zipSync({ 'my-template/index.tpl': strToU8('@layout\nHi\n@endlayout'), 'my-template/styles.css': strToU8('body {}') }));
  assert.deepEqual(Object.keys(files), ['index.tpl', 'styles.css']);
});
test('rejects traversal, absolute, ambiguous and control-character paths', () => {
  for (const name of ['../bad', '/tmp/bad', 'a/../../bad', 'C:\\bad', 'a\\b', 'a//b', 'a/./b', 'a/.env', 'a%2fb', 'a\0b', 'a b']) assert.throws(() => safePath(name), /Unsafe/);
  assert.equal(safePath('assets/image-01.svg'), 'assets/image-01.svg');
  assert.throws(() => readZip(zipSync({ '../escape.tpl': strToU8('x') })), /Unsafe/);
});
test('rejects truncated and oversized archives before decompression', () => {
  const bytes = createZip({ 'index.tpl': 'hello' });
  assert.throws(() => readZip(bytes.slice(0, -5)), /complete ZIP/);
  assert.throws(() => inspectZip(new Uint8Array(LIMITS.archive + 1)), /20 MiB/);
  const bomb = bytes.slice(); const view = new DataView(bomb.buffer);
  const end = bomb.length - 22; const start = view.getUint32(end + 16, true);
  view.setUint32(start + 24, LIMITS.file + 1, true);
  assert.throws(() => readZip(bomb), /too large/);
});
test('rejects duplicate entries, symlinks and mismatched local metadata', () => {
  const duplicate = zipSync({ 'a.tpl': strToU8('one'), 'b.tpl': strToU8('two') });
  for (let at = 0; at < duplicate.length - 5; at++) if (String.fromCharCode(...duplicate.slice(at, at + 5)) === 'b.tpl') duplicate[at] = 97;
  assert.throws(() => readZip(duplicate), /Duplicate ZIP/);
  const bytes = createZip({ 'index.tpl': 'hello' });
  const view = new DataView(bytes.buffer); const start = view.getUint32(bytes.length - 6, true);
  view.setUint32(start + 38, (0xa000 << 16) >>> 0, true);
  assert.throws(() => readZip(bytes), /symlinks/);
  view.setUint32(start + 38, 0, true); view.setUint32(22, 100, true);
  assert.throws(() => readZip(bytes), /Inconsistent ZIP size/);
});
test('file mutations reject overwrite and file/folder conflicts', () => {
  const files = { 'index.tpl': 'hello', 'a.txt': 'kept' };
  assert.throws(() => renameFile(files, 'index.tpl', 'a.txt'), /already exists/);
  assert.throws(() => validateProject({ 'a': 'file', 'a/b.txt': 'child' }), /conflicts/);
  assert.equal(renameFile(files, 'a.txt', 'assets/b.txt')['assets/b.txt'], 'kept');
  assert.equal(files['a.txt'], 'kept');
});
test('preview asset resolution stays inside the project and supports nested pages', () => {
  assert.equal(resolveAsset('../images/a.png', 'pages/index.html'), 'images/a.png');
  assert.equal(resolveAsset('./image.png?v=2', 'pages/index.html'), 'pages/image.png');
  assert.equal(resolveAsset('/styles.css', 'pages/index.html'), 'styles.css');
  for (const value of ['https://example.com/p.png', '//example.com/a', '../../escape', 'javascript:alert(1)', 'file:///a', 'blob:anything']) assert.equal(resolveAsset(value, 'pages/index.html'), null);
});
test('both starter projects generate HTML with defaults', () => {
  for (const blank of [true, false]) {
    const files = starterProject(blank); const { definition } = parseProject(files);
    const generated = generateProject(files, getDefaults(definition));
    assert.match(generated['index.html'], /<h1>/); assert.equal(generated['index.tpl'], undefined);
    const zip = unzipSync(createZip(generated)); assert.ok(zip['index.html']);
    if (!blank) { assert.ok(zip['images/cover.svg']); assert.match(generated['index.html'], /images\/cover\.svg/); }
  }
});

test('generated HTML export permits the runtime output budget without relaxing source limits', () => {
  const files = { 'index.html': '<p>' + 'a'.repeat(LIMITS.text + 100) + '</p>' };
  assert.throws(() => createZip(files), /too large/);
  assert.equal(unzipSync(createZip(files, { generated: true }))['index.html'].byteLength, files['index.html'].length);
});

test('preview bounds repeated data URLs and deeply nested CSS before expansion', async () => {
  const { createAssetResolver } = await import('../src/preview.js');
  const repeated = createAssetResolver({ 'image.png': new Uint8Array(1000) }, { limit: 5000 });
  repeated.asset('image.png', 'index.html');
  assert.throws(() => { for (let i = 0; i < 10; i++) repeated.asset('image.png', 'index.html'); }, /Preview exceeds/);
  const chain = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`${index}.css`, `@import "${index + 1}.css";`]));
  assert.throws(() => createAssetResolver(chain).asset('0.css', 'index.html'), /nested too deeply/);
  const tree = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`${index}.css`, `@import "${index + 1}.css"; @import "${index + 1}.css";`]));
  assert.throws(() => createAssetResolver(tree, { limit: 10000 }).asset('0.css', 'index.html'), /Preview exceeds/);
});
