import assert from 'node:assert/strict';
import test from 'node:test';
import { copyPreviewLink } from '../src/clipboard.js';

test('restores window focus before copying a server-generated URL', async () => {
  const calls = [];
  assert.equal(await copyPreviewLink('https://example.test/preview', { focus() { calls.push('focus'); } }, {}, { clipboard: { async writeText(value) { calls.push(value); } } }), true);
  assert.deepEqual(calls, ['focus', 'https://example.test/preview']);
});

test('focus or clipboard denial leaves the preview available for manual copying', async () => {
  assert.equal(await copyPreviewLink('url', { focus() {} }, {}, { clipboard: { async writeText() { throw new DOMException('Document is not focused.', 'NotAllowedError'); } } }), false);
  assert.equal(await copyPreviewLink('url', { focus() {} }, {}, {}), false);
});
