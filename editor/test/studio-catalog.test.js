import test from 'node:test';
import assert from 'node:assert/strict';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { createZip, readZipProject } from '../src/project.js';
import { cloneStudioProject } from '../src/studio-library.js';
import { studioStarters } from '../src/studio-catalog.js';
import { analyzeStudioProject } from '../src/hosts/studio-analyzer.js';

function state(project, settings = project.settings) {
  return { files: project.files, folders: project.folders, entrypoint: null, locale: 'en', translations: { en: settings } };
}

test('catalog IDs are unique and every starter remains available as an editable template', () => {
  assert.ok(studioStarters.length >= 3);
  assert.equal(new Set(studioStarters.map(project => project.id)).size, studioStarters.length);
  for (const project of studioStarters) {
    assert.equal(project.kind, 'template');
    assert.equal(project.builtin, true);
    assert.ok(project.description);
    assert.ok(project.files['index.tpl']);
  }
});

for (const project of studioStarters) {
  test(`${project.name}: default fields compile and generate a complete page without diagnostics`, () => {
    const analysis = analyzeStudioProject(state(project));
    assert.deepEqual(analysis.sourceDiagnostics, []);
    assert.deepEqual(analysis.diagnostics, []);
    assert.equal(analysis.previewAvailable, true);
    assert.equal(analysis.entrypoint, 'index.html');
    assert.ok(analysis.definition.sections.flatMap(section => section.fields).length > 0);
    const generated = generateProject(project.files, project.settings);
    assert.equal(generated['index.tpl'], undefined);
    assert.match(generated[analysis.entrypoint], /<!doctype html>/i);
    assert.match(generated[analysis.entrypoint], /<h1>[\s\S]+?<\/h1>/);
    assert.doesNotMatch(generated[analysis.entrypoint], /\{\{\s*(?:headline|brand|description|accent)\s*\}\}/);
    for (const [path, contents] of Object.entries(project.files)) {
      if (!path.endsWith('.tpl')) assert.deepEqual(generated[path], contents, `Asset retained: ${path}`);
    }
  });

  test(`${project.name}: field changes render safely and survive source ZIP export`, () => {
    const { definition } = parseProject(project.files);
    const settings = { ...getDefaults(definition), headline: 'Edited <headline> & launch', brand: 'My studio', accent: '#123456', destination: 'https://example.com/start?source=studio' };
    const analysis = analyzeStudioProject(state(project, settings));
    assert.deepEqual(analysis.sourceDiagnostics, []);
    assert.deepEqual(analysis.diagnostics, []);
    const generated = generateProject(project.files, settings);
    assert.match(generated['index.html'], /Edited &lt;headline&gt; &amp; launch/);
    assert.match(generated['index.html'], /My studio/);
    assert.match(generated['index.html'], /#123456/);
    const reopened = readZipProject(createZip(project.files, { settings, directories: project.folders }));
    assert.deepEqual({ ...reopened.files }, project.files);
    assert.deepEqual(reopened.settings, settings);
    assert.deepEqual(generateProject(reopened.files, reopened.settings), generated);
  });

  test(`${project.name}: creating a landing leaves the built-in template unchanged`, () => {
    const before = structuredClone(project);
    const landing = cloneStudioProject(project, { id: `${project.id}-landing`, kind: 'landing', name: 'My landing', now: 123 });
    assert.equal(landing.sourceTemplateId, project.id);
    assert.equal(landing.kind, 'landing');
    assert.equal(landing.createdAt, 123);
    assert.deepEqual(landing.files, project.files);
    assert.deepEqual(landing.settings, project.settings);
    landing.files['index.tpl'] += '\n';
    landing.settings.headline = 'Independent page';
    landing.folders.push('my-assets');
    assert.deepEqual(project, before);
    assert.deepEqual(analyzeStudioProject(state(landing)).sourceDiagnostics, []);
    assert.match(generateProject(landing.files, landing.settings)['index.html'], /Independent page/);
  });
}
