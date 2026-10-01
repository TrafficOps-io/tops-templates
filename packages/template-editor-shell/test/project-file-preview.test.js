import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectFilePreview, projectFileImageMime } from '../src/project-file-preview.js';

test('image previews use a fixed raster MIME allowlist and never treat project text as a URL', () => {
  assert.equal(projectFileImageMime('images/HERO.PNG'), 'image/png');
  assert.equal(projectFileImageMime('images/hero.avif'), 'image/avif');
  assert.equal(projectFileImageMime('index.html'), null);
  assert.equal(projectFileImageMime('images/vector.svg'), null);
  assert.equal(projectFileImageMime('constructor'), null);
  assert.equal(projectFileImageMime('__proto__'), null);
  const urls = { createObjectURL() { assert.fail('Unsupported values must not allocate object URLs'); } };
  for (const [path, value] of [
    ['hero.png', 'https://example.com/hero.png'], ['hero.png', 'data:image/png;base64,AA=='],
    ['hero.png', undefined], ['hero.png', new Uint8Array()], ['hero.svg', '<svg></svg>'],
    ['index.html', new Uint8Array([60, 62])], ['hero.png', { 0: 137, length: 1 }],
  ]) assert.equal(createProjectFilePreview(path, value, urls), null);
  assert.equal(createProjectFilePreview('hero.png', new Uint8Array([137]), { createObjectURL() { throw new Error('Preview unavailable'); } }), null);
});

test('binary previews preserve the exact typed array view and release each URL once', async () => {
  let blob, allocated = 0;
  const revoked = [];
  const urls = { createObjectURL(value) { blob = value; allocated += 1; return 'blob:local-preview'; }, revokeObjectURL(value) { revoked.push(value); } };
  const bytes = new Uint8Array([0, 137, 80, 78, 71, 0]);
  const preview = createProjectFilePreview('images/hero.png', bytes.subarray(1, 5), urls);
  assert.equal(allocated, 1);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
  assert.equal(preview.url, 'blob:local-preview');
  preview.dispose(); preview.dispose();
  assert.deepEqual(revoked, ['blob:local-preview']);
});
