import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { createZip, readZipProject } from '@trafficops/template-editor-core';
import { analyzeStudioProject } from '../src/hosts/studio-analyzer.js';
import { DEMO_REPOSITORY_PATH, parseRepositoryIndex, readRepositories } from '../src/template-repositories.js';

const published = new URL('../public/template-repositories/demo/', import.meta.url);
const sources = new URL('../../repositories/demo/', import.meta.url);
const index = JSON.parse(await readFile(new URL('index.json', published), 'utf8'));
const metadata = JSON.parse(await readFile(new URL('repository.json', sources), 'utf8'));
const catalog = parseRepositoryIndex(index, 'https://studio.example' + DEMO_REPOSITORY_PATH);

test('default demo index publishes exactly the five requested scenarios with previews and ZIPs', async () => {
  assert.equal(index.repository.name, 'TrafficOps Demo');
  assert.deepEqual(index.templates.map(entry => entry.id), ['demo-saas', 'demo-course', 'demo-event', 'demo-cafe', 'demo-portfolio']);
  assert.deepEqual(index.templates.map(entry => entry.name), metadata.templates.map(entry => entry.name));
  assert.equal(catalog.templates.length, 5);
  const enabled = readRepositories({ getItem: () => null }, 'https://studio.example').find(entry => entry.url.endsWith(DEMO_REPOSITORY_PATH));
  assert.equal(enabled.enabled, true); assert.equal(enabled.builtin, true);
  for (const entry of index.templates) {
    assert.ok(entry.description && entry.preview && entry.thumbnail && entry.sha256);
    assert.ok((await readFile(new URL(entry.thumbnail, published))).byteLength > 1000);
    assert.match(await readFile(new URL(entry.preview, published), 'utf8'), /<!doctype html>/i);
  }
});

async function sourceFiles(root, prefix = '', files = {}) {
  for (const entry of await readdir(new URL(prefix || '.', root), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await sourceFiles(root, path + '/', files);
    else files[path] = await readFile(new URL(path, root));
  }
  return files;
}
for (const entry of index.templates) {
  test(`${entry.name}: published ZIP matches its source, compiles and preserves edited values/assets`, async () => {
    const bytes = await readFile(new URL(entry.archive, published));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const project = readZipProject(new Uint8Array(bytes));
    const source = await sourceFiles(new URL(`templates/${entry.id}/`, sources));
    assert.deepEqual(Object.keys(project.files).sort(), Object.keys(source).sort());
    for (const [path, value] of Object.entries(project.files)) assert.deepEqual(Buffer.from(value), source[path], path);
    const { definition } = parseProject(project.files);
    const defaults = getDefaults(definition);
    for (const key of ['brand', 'headline', 'description', 'accent', 'destination', 'button']) assert.ok(Object.hasOwn(defaults, key), `${entry.id}: editable ${key}`);
    for (const values of [defaults, { ...defaults, headline: 'A <custom> & headline', brand: 'Custom studio', accent: '#234567', destination: 'https://example.com/custom', button: 'Custom action' }]) {
      const state = { files: project.files, folders: project.folders, entrypoint: null, locale: 'en', translations: { en: values } };
      const analysis = analyzeStudioProject(state);
      assert.deepEqual(analysis.sourceDiagnostics, []); assert.deepEqual(analysis.diagnostics, []);
      assert.equal(analysis.previewAvailable, true);
      const generated = generateProject(project.files, values);
      assert.match(generated['index.html'], /<h1[\s>]/);
      assert.doesNotMatch(generated['index.html'], /\{\{[^}]+\}\}/);
      assert.doesNotMatch(generated['index.html'], /<(?:img|script|link)[^>]+(?:src|href)="https?:/);
      if (values !== defaults) {
        assert.match(generated['index.html'], /A &lt;custom&gt; &amp; headline/);
        assert.match(generated['index.html'], /Custom studio/);
        assert.match(generated['index.html'], /#234567/);
        assert.match(generated['index.html'], /https:\/\/example.com\/custom/);
      }
      const reopened = readZipProject(createZip(project.files, { directories: project.folders, settings: values }));
      assert.deepEqual(reopened.settings, values);
      assert.deepEqual(generateProject(reopened.files, reopened.settings), generated);
    }
  });
}
