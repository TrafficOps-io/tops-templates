import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeStudioProject, createStudioAnalyzer } from '../src/hosts/studio-analyzer.js';
const fixtures = JSON.parse(readFileSync(new URL(import.meta.resolve('@trafficops/template-editor-core/fixtures/diagnostics.json'))));
const select = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
for (const fixture of fixtures) test(`Analyzer parity: ${fixture.id}`, async () => {
  const analysis = analyzeStudioProject({ entrypoint: null, ...fixture });
  assert.deepEqual({ pages: analysis.pages, diagnostics: analysis.diagnostics.map(issue => select(issue, ['locale','section','path','code'])), sourceDiagnostics: analysis.sourceDiagnostics.map(issue => select(issue, ['file','line','code'])) }, fixture.expected);
  for (const issue of [...analysis.diagnostics, ...analysis.sourceDiagnostics]) assert.ok(issue.message?.length);
});
test('draft rendering tolerates required content gaps without relaxing export validation', async () => {
  const fixture = fixtures[0], state = { ...fixture, entrypoint: null };
  const files = await createStudioAnalyzer().render(state, { locale: 'uk' });
  assert.match(files['index.html'], /<h1><\/h1>/);
  assert.equal(analyzeStudioProject(state).diagnostics[0].code, 'required');
});
