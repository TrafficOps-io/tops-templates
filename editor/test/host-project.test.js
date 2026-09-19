import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { parseProject, generateProject } from '@trafficops/template-runtime';
import { encodeProject, decodeProject, moveEntry, inputValues } from '../src/host-project.js';
const fixture = JSON.parse(fs.readFileSync(new URL(import.meta.resolve('@trafficops/template-editor-core/fixtures/multipage.json'))));
test('PW Apps contract fixture discovers the same pages and merges shared declarations', () => {
  const project = parseProject(fixture.files);
  assert.deepEqual(project.pages.map(page => page.entrypoint), fixture.pages);
  assert.deepEqual(project.definition.fields.map(field => field.name), fixture.fields);
  assert.match(generateProject(fixture.files, fixture.values)['demo/app.html'], /Shared card/);
});
test('host wire format preserves binary images and exact whitespace in text', () => {
  const files = { ...fixture.files, 'binary.png': new Uint8Array([0, 13, 127, 128, 255]) };
  assert.deepEqual(decodeProject(encodeProject(files)), files);
  assert.throws(() => moveEntry(files, [], { path: 'demo' }, 'demo/subfolder'), /itself/);
  const moved = moveEntry(files, ['demo/empty'], { path: 'demo' }, 'pages');
  assert.ok(moved.files['pages/demo/app.tpl.html']);
  assert.deepEqual(moved.folders, ['pages/demo/empty']);
});

test('new nested defaults merge into every row without coercing incompatible or removed values', () => {
  const definition = { sections: [{ fields: [{ name: 'items', type: 'repeater', fields: [
    { name: 'title', type: 'text', default: 'New title' }, { name: 'meta', type: 'group', fields: [{ name: 'visible', type: 'checkbox', default: true }] },
  ] }] }] };
  const saved = { items: [{ title: 17, removed: 'recoverable', meta: {} }, { title: 'Kept' }], old: 'kept' };
  assert.deepEqual(inputValues(definition, saved), { items: [{ title: 17, removed: 'recoverable', meta: { visible: true } }, { title: 'Kept', meta: { visible: true } }], old: 'kept' });
  assert.deepEqual(saved.items[0].meta, {});
});
