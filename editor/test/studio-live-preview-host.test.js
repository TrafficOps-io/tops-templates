import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioHost } from '../src/hosts/StudioHost.js';

test('Studio live preview uses the same canonical page order as analysis, regardless of HTML insertion order', async t => {
  // Rendering and page selection are real. DOM serialization is covered by the
  // browser runner tests; this test needs only a document-shaped serializer.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: class {
    parseFromString(source) { return { querySelectorAll: () => [], documentElement: { outerHTML: source } }; }
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'DOMParser', previous); else delete globalThis.DOMParser; });
  for (const files of [
    { 'other.html': '<h1>Other</h1>', 'index.html': '<h1>Index</h1>' },
    { 'index.html': '<h1>Index</h1>', 'other.html': '<h1>Other</h1>' },
    { 'page10.html': '<h1>Ten</h1>', 'page2.html': '<h1>Two</h1>' },
  ]) {
    const host = createStudioHost({ initial: { files, folders: [], settings: {} } });
    const state = await host.project.open(), analysis = await host.analyzer.analyze(state);
    for (const page of [undefined, '', 'missing.html']) {
      const preview = await host.livePreview.render(state, { locale: 'en', page });
      assert.equal(preview.page, analysis.pages[0]);
    }
    const selected = analysis.pages[1];
    assert.equal((await host.livePreview.render(state, { locale: 'en', page: selected })).page, selected);
    assert.equal((await host.livePreview.render({ ...state, entrypoint: selected }, { locale: 'en' })).page, selected);
  }
});
