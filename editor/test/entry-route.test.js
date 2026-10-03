import test from 'node:test';
import assert from 'node:assert/strict';
import { isStudioEntry } from '../src/entry-route.js';

function browser(search = '', hash = '', mode = 'browser', standalone = false) {
  return { location: { search, hash }, navigator: { standalone }, matchMedia: query => ({ matches: query === `(display-mode: ${mode})` }) };
}
test('ordinary website visits stay on the landing, including marketing anchors and unrelated query parameters', () => {
  for (const env of [browser(), browser('?campaign=studio'), browser('?studio=0'), browser('', '#features'), browser('', '#install'), browser('', '', 'fullscreen')]) assert.equal(isStudioEntry(env), false);
});
test('the manifest start URL and legacy settings bookmarks enter the workspace', () => {
  assert.equal(isStudioEntry(browser('?studio=1')), true);
  assert.equal(isStudioEntry(browser('?campaign=test&studio=1', '#settings')), true);
  assert.equal(isStudioEntry(browser('', '#settings')), true);
});
test('installed windows bypass the landing, including existing installs whose start URL is root', () => {
  for (const mode of ['standalone', 'minimal-ui', 'window-controls-overlay']) assert.equal(isStudioEntry(browser('', '', mode)), true);
  assert.equal(isStudioEntry(browser('', '', 'browser', true)), true);
});
