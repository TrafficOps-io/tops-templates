import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseProject, getDefaults, validateValues, generateProject} from '../src/index.js';

// Shared parity fixtures are the contract with the PHP reference implementation (ADR-0001).
// The same cases run in template-dsl/tests/ParityFixturesTest.php.
const directory = fileURLToPath(new URL('../../fixtures/parity/', import.meta.url));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// {"$repeat": ["a", n]} and {"$concat": [...]} keep large fixture inputs readable.
function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$repeat') return value.$repeat[0].repeat(value.$repeat[1]);
  if (keys.length === 1 && keys[0] === '$concat') return value.$concat.map(expand).join('');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
}
const normalize = (html) => html.replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

function run(fixture) {
  const files = {'index.tpl': fixture.source, ...(fixture.pages ?? {}), ...(fixture.includes ?? {})};
  const project = parseProject(files);
  const values = expand(fixture.values ?? {});
  const warnings = [];
  const normalized = validateValues(project.definition, values, {warnings});
  const pages = generateProject(files, values, fixture.context ?? {});
  return {defaults: getDefaults(project.definition), values: normalized, warnings: warnings.map((warning) => warning.path), html: pages[project.definition.entrypoint], pages};
}

for (const file of readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
  const suite = JSON.parse(readFileSync(directory + file, 'utf8'));
  for (const fixture of suite.cases) {
    test(`${file.replace(/\.json$/, '')}: ${fixture.name}`, () => {
      assert.equal(fixture.residual, undefined, 'Parity cases must execute; use portableReject for stricter JavaScript input');
      const expect = fixture.expect;
      if (fixture.portableReject) {
        assert.equal(expect.ok, true, 'A portable rejection may only narrow PHP-accepted input');
        assert.throws(() => run(fixture), undefined, fixture.portableReject);
        return;
      }
      if (!expect.ok) { assert.throws(() => run(fixture), undefined, 'Expected the case to be rejected'); return; }
      const actual = run(fixture);
      if ('defaults' in expect) assert.deepEqual(actual.defaults, expect.defaults, 'defaults');
      if ('values' in expect) assert.deepEqual(actual.values, expand(expect.values), 'values');
      if ('warnings' in expect) assert.deepEqual(actual.warnings, expect.warnings, 'warnings');
      if ('html' in expect) assert.equal(normalize(actual.html), normalize(expand(expect.html)), 'html');
      for (const [path, html] of Object.entries(expect.pages ?? {})) assert.equal(normalize(actual.pages[path] ?? ''), normalize(expand(html)), `pages.${path}`);
    });
  }
}
