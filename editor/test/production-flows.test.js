import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { createZip, readZipProject } from '../src/project.js';
import { imageTarget, cropRectangle } from '@trafficops/template-editor-shell/image-editing';
import { imageFromResponse, generateImageWithOpenRouter, OPENROUTER_IMAGE_ENDPOINT } from '@trafficops/template-editor-shell/openrouter-images';
import { installedDisplayMode, watchDisplayMode } from '../src/app-mode.js';
import { starterProject } from '../src/starter.js';

test('PWA capabilities require installed display mode, never a launch query', () => {
  const browser = { location: { search: '?studio=1' }, matchMedia: () => ({ matches: false }), navigator: {} };
  assert.equal(installedDisplayMode(browser), false);
  assert.equal(installedDisplayMode({ ...browser, navigator: { standalone: true } }), true);
  assert.equal(installedDisplayMode({ ...browser, matchMedia: query => ({ matches: query === '(display-mode: standalone)' }) }), true);
  assert.equal(installedDisplayMode({ ...browser, matchMedia: query => ({ matches: query === '(display-mode: minimal-ui)' }) }), true);
  assert.equal(installedDisplayMode({ ...browser, matchMedia: query => ({ matches: query === '(display-mode: fullscreen)' }) }), false);
});

function displayEnvironment(initialMode) {
  let mode = initialMode;
  const queries = new Map();
  const environment = Object.assign(new EventTarget(), {
    navigator: {},
    matchMedia(query) {
      if (!queries.has(query)) {
        const result = new EventTarget();
        Object.defineProperty(result, 'matches', { get: () => query === `(display-mode: ${mode})` });
        queries.set(query, result);
      }
      return queries.get(query);
    },
  });
  return { environment, setMode(nextMode) {
    const previous = mode;
    mode = nextMode;
    for (const [query, result] of queries) {
      if (query === `(display-mode: ${previous})` || query === `(display-mode: ${mode})`) result.dispatchEvent(new Event('change'));
    }
  } };
}

test('confirmed PWA fullscreen retains capabilities until the window returns to browser mode', () => {
  for (const launchMode of ['standalone', 'minimal-ui']) {
    const { environment, setMode } = displayEnvironment(launchMode);
    assert.equal(installedDisplayMode(environment), true);
    setMode('fullscreen');
    assert.equal(installedDisplayMode(environment), true);
    setMode('browser');
    assert.equal(installedDisplayMode(environment), false);
    setMode('fullscreen');
    assert.equal(installedDisplayMode(environment), false);
  }
});

test('iOS standalone confirms its own window and explicit browser mode clears confirmation', () => {
  const { environment, setMode } = displayEnvironment('unknown');
  environment.navigator.standalone = true;
  assert.equal(installedDisplayMode(environment), true);
  environment.navigator.standalone = false;
  setMode('fullscreen');
  assert.equal(installedDisplayMode(environment), true);
  const otherWindow = displayEnvironment('fullscreen');
  assert.equal(installedDisplayMode(otherWindow.environment), false);
  setMode('browser');
  environment.navigator.standalone = true;
  assert.equal(installedDisplayMode(environment), true);
  environment.navigator.standalone = false;
  assert.equal(installedDisplayMode(environment), false);
  setMode('fullscreen');
  assert.equal(installedDisplayMode(environment), false);
});

test('display-mode watcher observes fullscreen and clears app confirmation in browser mode', () => {
  const { environment, setMode } = displayEnvironment('standalone');
  const updates = [];
  const stop = watchDisplayMode(value => updates.push(value), environment);
  setMode('fullscreen');
  assert.equal(updates.at(-1), true);
  setMode('browser');
  assert.equal(updates.at(-1), false);
  setMode('fullscreen');
  assert.equal(updates.at(-1), false);
  const updateCount = updates.length;
  stop();
  setMode('standalone');
  environment.dispatchEvent(new Event('appinstalled'));
  assert.equal(updates.length, updateCount);
});

test('appinstalled in an ordinary tab never grants AI or filesystem capabilities, including fullscreen', () => {
  const { environment, setMode } = displayEnvironment('browser');
  const updates = [];
  const stop = watchDisplayMode(value => updates.push(value), environment);
  environment.dispatchEvent(new Event('appinstalled'));
  assert.deepEqual(updates, [false]);
  setMode('fullscreen');
  assert.equal(installedDisplayMode(environment), false);
  assert.ok(updates.every(value => value === false));
  stop();
});

test('source export round trips customized values and binary assets; landing export contains rendered values only', () => {
  const files = { ...starterProject(), 'images/photo.png': new Uint8Array([1, 2, 3]) };
  const values = { ...getDefaults(parseProject(files).definition), headline: 'A filled production landing' };
  const sourceZip = createZip(files, { directories: ['images'], settings: values });
  const restored = readZipProject(sourceZip);
  assert.deepEqual(restored.settings, values);
  assert.deepEqual(restored.files['images/photo.png'], files['images/photo.png']);
  assert.equal(Object.hasOwn(restored.files, '.trafficops/values.json'), false);
  const output = unzipSync(createZip(generateProject(restored.files, restored.settings), { generated: true }));
  assert.match(new TextDecoder().decode(output['index.html']), /A filled production landing/);
  assert.equal(Object.keys(output).some(path => /\.tpl$|values\.json/.test(path)), false);
  assert.throws(() => readZipProject(zipSync({ 'index.tpl': strToU8(files['index.tpl']), '.trafficops/key.json': strToU8('{}') })), /Unsafe/);
});

test('crop respects prescribed sizes and bounds while panning never samples outside source', () => {
  assert.deepEqual(imageTarget({ width: 2000, height: 1000 }, { aspect_ratio: 1 }), { width: 1000, height: 1000 });
  assert.deepEqual(imageTarget({ width: 1000, height: 2000 }, { aspect_ratio: 16 / 9 }), { width: 1000, height: 563 });
  assert.deepEqual(imageTarget({ width: 5000, height: 5000, outputWidth: 9000 }, { aspect_ratio: .01 }), { width: 41, height: 4096 });
  assert.deepEqual(imageTarget({ preset: 1 }, { sizes: [{ width: 100, height: 100 }, { width: 1200, height: 630 }] }), { width: 1200, height: 630 });
  for (const zoom of [1, 2, 8]) for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
    const rect = cropRectangle({ width: 1200, height: 800, zoom, x, y }, { width: 600, height: 600 });
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1200 && rect.y + rect.height <= 800);
  }
});

test('image generation uses the dedicated API, returns a local file and redacts errors', async () => {
  let request;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=';
  const file = await generateImageWithOpenRouter({ apiKey: 'secret', imageModel: 'vendor/image', prompt: 'A ceramic coffee cup', field: { label: 'Hero' }, fetchImpl: async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ data: [{ b64_json: png, media_type: 'image/png' }] }));
  } });
  assert.equal(request.url, OPENROUTER_IMAGE_ENDPOINT);
  assert.equal(request.headers.Authorization, 'Bearer secret');
  assert.equal(request.body.model, 'vendor/image');
  assert.match(request.body.prompt, /Hero/);
  assert.equal(file.type, 'image/png');
  assert.ok(file.size > 0);
  assert.throws(() => imageFromResponse({ data: [{ b64_json: png, media_type: 'text/html' }] }), /raster/);
  await assert.rejects(() => generateImageWithOpenRouter({ apiKey: 'secret', imageModel: 'vendor/image', prompt: 'x', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Invalid secret' } }), { status: 401 }) }), error => error.message.includes('[redacted]') && !error.message.includes('secret'));
});

test('unsaved file indicators distinguish new/modified source, compare binary contents and clear after saving', async () => {
  const { changedProjectFiles } = await import('../src/project-changes.js');
  const baseline = { 'index.tpl': 'old', 'image.png': new Uint8Array([1, 2]) };
  const files = { 'index.tpl': 'new', 'image.png': new Uint8Array([1, 2]), 'styles.css': 'body{}' };
  assert.deepEqual(changedProjectFiles(files, baseline), { 'index.tpl': 'modified', 'styles.css': 'added' });
  assert.deepEqual(changedProjectFiles(files, files), {});
  assert.deepEqual(changedProjectFiles({ ...baseline, 'image.png': new Uint8Array([1, 3]) }, baseline), { 'image.png': 'modified' });
});
