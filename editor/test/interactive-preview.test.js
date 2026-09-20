import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareJavaScript, PROJECT_ORIGIN } from '../src/preview/module-source.js';

test('prepares static module dependencies, dynamic import and module-relative URLs without rewriting strings/comments', () => {
  const dependencies = new Set();
  const source = `import x from './x.js?v=2'; export {x} from '../root.js'; // import('./comment.js')
const literal="import('./literal.js')"; const dynamic=import('./later.js',{with:{type:'json'}}); const image=new URL('../cover.svg',import.meta.url);`;
  const prepared = prepareJavaScript(source, 'scripts/main.js', 'runtime', dependencies);
  assert.deepEqual([...dependencies], [`${PROJECT_ORIGIN}/scripts/x.js?v=2`, `${PROJECT_ORIGIN}/root.js`]);
  assert.match(prepared, /globalThis\["runtime"\]\.import\('\.\/later\.js',"https:\/\/project\.trafficops\.invalid\/scripts\/main\.js",\{with:/);
  assert.ok(prepared.includes('new URL(\'../cover.svg\',"https://project.trafficops.invalid/scripts/main.js")'));
  assert.ok(prepared.includes('// import(\'./comment.js\')'));
  assert.ok(prepared.includes('"import(\'./literal.js\')"'));
});

test('virtualizes ordinary page navigation while preserving locally bound location and property names', () => {
  const source = `location.href='next.html'; window.location.assign('next.html'); self.location='next.html'; const data={location}; const property={location:1}; function helper(location) { return location.href; } function named(window) { return window.location; }`;
  const prepared = prepareJavaScript(source, 'index.html', 'runtime');
  assert.ok(prepared.includes('globalThis["runtime"].location.href='));
  assert.ok(prepared.includes('globalThis["runtime"].location.assign('));
  assert.ok(prepared.includes('const data={location: globalThis["runtime"].location}'));
  assert.ok(prepared.includes('const property={location:1}'));
  assert.ok(prepared.includes('function helper(location) { return location.href; }'));
  assert.ok(prepared.includes('function named(window) { return window.location; }'));
});

test('prepares handler return statements and reports invalid source with its path', () => {
  assert.equal(prepareJavaScript("location.href='thanks.html'; return false", 'index.html', 'runtime'), "globalThis[\"runtime\"].location.href='thanks.html'; return false");
  assert.throws(() => prepareJavaScript('const = broken', 'scripts/broken.js', 'runtime'), /scripts\/broken\.js:/);
});
