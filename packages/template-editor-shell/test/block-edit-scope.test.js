import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBlockDraftScope, assertBlockScopeBase, blockScopeFiles, blockScopeValueTargets, createBlockEditScope, serializeBlockEditScope, setBlockScopeValue } from '../src/block-edit-scope.js';

function setup(overrides = {}) {
  const first = '<article data-block="Comment"><p>{{item.body}}</p></article>', second = '<form data-block="order_form"><input></form>';
  const files = { 'index.tpl': `@layout\n<div>Unselected header</div>\n${first}\n${second}\n@endlayout`, 'styles.css': 'body { color: black; }', 'photo.png': Uint8Array.of(1, 2, 3) };
  const values = { comments: [{ body: 'First', author: 'Ada' }, { body: 'Second', author: 'Ben' }], shared: 'Header', show: true, retired: 'Keep' };
  const source = (id, content) => ({ id, label: id, path: 'index.tpl', start: files['index.tpl'].indexOf(content), end: files['index.tpl'].indexOf(content) + content.length, content });
  const metadata = { version: 1, page: 'index.html', locale: 'en', intent: 'mixed', blockSources: [source('comment', first), source('form', second)],
    blockInstances: [{ id: 'first', sourceId: 'comment', label: 'Comment', page: 'index.html', valuePaths: [['comments', 0, 'body'], ['shared'], ['show']] },
      { id: 'second', sourceId: 'comment', label: 'Comment', page: 'index.html', valuePaths: [['comments', 1, 'body'], ['shared']] }, { id: 'form', sourceId: 'form', label: 'order_form', page: 'index.html', valuePaths: [] }],
    valueUses: [{ path: ['comments', 0, 'body'], instanceIds: ['first'], page: 'index.html' }, { path: ['comments', 1, 'body'], instanceIds: ['second'], page: 'index.html' },
      { path: ['comments'], instanceIds: [], page: 'index.html', control: true }, { path: ['shared'], instanceIds: ['first', 'second'], page: 'index.html' }, { path: ['show'], instanceIds: ['first'], page: 'index.html', control: true }], selectedInstanceIds: ['first'], ...overrides };
  return { files, values, metadata, scope: createBlockEditScope(metadata, { files, values, rawValues: values }) };
}

test('shared source changes are local while only selected-instance leaves are editable', () => {
  const { scope, files, values } = setup();
  assert.deepEqual(blockScopeValueTargets(scope), ['/comments/0/body']);
  const next = blockScopeFiles(scope, { comment: '<article data-block="Comment" style="padding: 20px"><p>{{item.body}}</p></article>' });
  const nextValues = setBlockScopeValue(scope, values, ['comments', 0, 'body'], 'Changed first');
  assert.equal(assertBlockDraftScope(scope, { files: next, rawValues: nextValues }), true);
  assert.equal(nextValues.comments[1].body, 'Second'); assert.equal(next['styles.css'], files['styles.css']);
  assert.throws(() => setBlockScopeValue(scope, values, '/shared', 'Bad'), /shared outside/);
  assert.throws(() => setBlockScopeValue(scope, values, '/show', false), /shared outside/);
});

test('unselected source, assets, files and global code cannot change', () => {
  const { scope, files, values } = setup();
  const changed = body => blockScopeFiles(scope, { comment: `<article data-block="Comment">${body}<p>{{item.body}}</p></article>` });
  for (const candidate of [{ ...files, 'other.txt': 'Bad' }, { ...files, 'styles.css': 'Bad' }, { ...files, 'photo.png': Uint8Array.of(0, 2, 3) }, { ...files, 'index.tpl': files['index.tpl'].replace('Unselected', 'Bad') }]) assert.throws(() => assertBlockDraftScope(scope, { files: candidate, rawValues: values }), /scope/);
  for (const body of ['<style>body{color:red}</style>', '<script>alert(1)</script>', '<link rel="stylesheet" href="evil.css">', '<button onclick="bad()">Bad</button>', '<a href="javascript:bad()">Bad</a>', '<a href=" &#x6a;ava&#x09;script:bad()">Bad</a>', '<form action="javascript:bad()"></form>', '\n@param extra String\n', '\n@include "global.tpl"\n']) assert.throws(() => assertBlockDraftScope(scope, { files: changed(body), rawValues: values }), /Global CSS/);
  assert.throws(() => assertBlockDraftScope(scope, { files: blockScopeFiles(scope, { comment: '<article data-block="Changed"><p>{{item.body}}</p></article>' }), rawValues: values }), /root marker/);
});

test('content and source intentions grant separate capabilities', () => {
  const { scope, files, values } = setup();
  assert.throws(() => assertBlockDraftScope({ ...scope, intent: 'content' }, { files: blockScopeFiles(scope, { comment: '<article data-block="Comment" class="new"><p>{{item.body}}</p></article>' }), rawValues: values }), /Unselected file/);
  assert.throws(() => assertBlockDraftScope({ ...scope, intent: 'source' }, { files, rawValues: { ...values, comments: [{ ...values.comments[0], body: 'Bad' }, values.comments[1]] } }), /Unselected field/);
});

test('nested selection grants descendant leaves, and any usage on another page prevents edits', () => {
  const { metadata, files, values } = setup();
  metadata.blockInstances.push({ id: 'child', sourceId: 'comment', parentId: 'first', page: 'index.html', valuePaths: [['comments', 0, 'author']] });
  metadata.valueUses.push({ path: ['comments', 0, 'author'], instanceIds: ['child'], page: 'index.html' });
  let scope = createBlockEditScope(metadata, { files, values, rawValues: values });
  assert.ok(blockScopeValueTargets(scope).includes('/comments/0/author'));
  metadata.valueUses.push({ path: ['comments', 0, 'author'], instanceIds: [], page: 'other.html' });
  scope = createBlockEditScope(metadata, { files, values, rawValues: values });
  assert.ok(!blockScopeValueTargets(scope).includes('/comments/0/author'));
});

test('leaf edits minimally materialize defaults and do not persist unrelated default fields', () => {
  const { metadata, files, values } = setup();
  const rawValues = { retired: 'Keep' }, scope = createBlockEditScope(metadata, { files, values, rawValues });
  const next = setBlockScopeValue(scope, rawValues, '/comments/0/body', 'Changed');
  assert.deepEqual(next, { retired: 'Keep', comments: [{ body: 'Changed' }, {}] });
  assert.equal(assertBlockDraftScope(scope, { files, rawValues: next }), true);
  assert.throws(() => assertBlockDraftScope(scope, { files, rawValues: { ...next, shared: 'Header' } }), /Unselected field/);
  assert.throws(() => assertBlockDraftScope(scope, { files, rawValues: { comments: [{ body: 'Changed' }, {}] } }), /deleted/);
});

test('groups, repeaters, unknown keys and row structure stay frozen', () => {
  const { scope, files, values } = setup();
  assert.throws(() => setBlockScopeValue(scope, values, '/comments', []), /shared outside/);
  for (const comments of [[], [...values.comments, { body: 'New' }], [values.comments[1], values.comments[0]]]) assert.throws(() => assertBlockDraftScope(scope, { files, rawValues: { ...values, comments } }), /rows|Unselected field/);
  assert.throws(() => assertBlockDraftScope(scope, { files, rawValues: { ...values, retired: 'Bad' } }), /Unselected field|Undeclared saved field/);
  assert.throws(() => setBlockScopeValue(scope, values, ['__proto__', 'bad'], 'Bad'), /Invalid field/);
});

test('recovery preserves its original baseline and detects stale Apply without replacement state', () => {
  const { scope, files, values } = setup();
  const next = blockScopeFiles(scope, { comment: '<article data-block="Comment" class="new"><p>{{item.body}}</p></article>' });
  const restored = serializeBlockEditScope(structuredClone(scope));
  assert.equal(assertBlockDraftScope(restored, { files: next, rawValues: values }), true);
  assert.equal(assertBlockScopeBase(restored, { files, rawValues: values }), true);
  assert.throws(() => assertBlockScopeBase(restored, { files: next, rawValues: values }), /original project changed/);
  files['photo.png'][0] = 99; values.comments[1].body = 'Changed elsewhere';
  assert.equal(restored.baselineFiles['photo.png'][0], 1); assert.equal(restored.baselineRawValues.comments[1].body, 'Second');
});

test('source edits cannot introduce new consumers or rebind existing loop/block argument scopes', () => {
  const { scope, files, values } = setup();
  assert.throws(() => assertBlockDraftScope(scope, { files: blockScopeFiles(scope, { comment: '<article data-block="Comment"><p>{{item.body}} {{shared}}</p></article>' }), rawValues: values }), /new data dependencies/);
  assert.equal(assertBlockDraftScope(scope, { files: blockScopeFiles(scope, { comment: '<article data-block="Comment" style="color: red"><p>Literal</p></article>' }), rawValues: values }), true, 'literal local source overrides remain supported');
  assert.equal(assertBlockDraftScope(scope, { files: blockScopeFiles(scope, { comment: '<article data-block="Comment"><h2>{{item.body}}</h2><p>{{item.body}}</p></article>' }), rawValues: values }), true, 'reusing an existing binding in the same scope is safe');
  const body = '<article data-block="Loop">\n@each item in comments\n@render card(item)\n<p>{{item.body}}</p>\n@endeach\n</article>';
  const loopFiles = { 'index.tpl': body }, loopScope = createBlockEditScope({ ...scope, baselineFiles: undefined, blockSources: [{ id: 'loop', path: 'index.tpl', start: 0, end: body.length, content: body }],
    blockInstances: [{ id: 'loop-1', sourceId: 'loop', valuePaths: [], page: 'index.html' }], selectedInstanceIds: ['loop-1'], valueUses: [] }, { files: loopFiles, rawValues: {}, values: {} });
  for (const replacement of [body.replace('in comments', 'in other'), body.replace('card(item)', 'card(shared)'), body.replace('<p>', '@if show\n<p>').replace('</p>', '</p>\n@endif')]) assert.throws(() => assertBlockDraftScope(loopScope, { files: { 'index.tpl': replacement }, rawValues: {} }), /new data dependencies/);
});

test('document-level marked roots do not invalidate selections of ordinary descendants', () => {
  const section = '<section data-block="Section"><p>Original</p></section>', content = `<html data-block="Page"><head data-block="Head"><title>Title</title></head><body data-block="Body">${section}</body></html>`;
  const files = { 'index.tpl': `@layout\n${content}\n@endlayout` }, source = (id, fragment) => ({ id, path: 'index.tpl', start: files['index.tpl'].indexOf(fragment), end: files['index.tpl'].indexOf(fragment) + fragment.length, content: fragment });
  const scope = createBlockEditScope({ version: 1, blockSources: [source('page', content), source('head', '<head data-block="Head"><title>Title</title></head>'), source('body', `<body data-block="Body">${section}</body>`), source('section', section)],
    blockInstances: [{ id: 'section-instance', sourceId: 'section', valuePaths: [] }], valueUses: [], selectedInstanceIds: ['section-instance'], intent: 'source' }, { files, rawValues: {}, values: {} });
  const next = blockScopeFiles(scope, { section: '<section data-block="Section" style="color: red"><p>Original</p></section>' });
  assert.equal(assertBlockDraftScope(scope, { files: next, rawValues: {} }), true);
});

test('source replacements preserve future selectability by rejecting duplicate root attributes', () => {
  const { scope, values } = setup();
  for (const attributes of ['data-block="Comment" data-block="Comment"', 'data-block="Comment" DATA-BLOCK="Other"', 'data-block="Comment" class="first" class="second"']) {
    const files = blockScopeFiles(scope, { comment: `<article ${attributes}><p>{{item.body}}</p></article>` });
    assert.throws(() => assertBlockDraftScope(scope, { files, rawValues: values }), /root marker/);
  }
  assert.equal(assertBlockDraftScope(scope, { files: blockScopeFiles(scope, { comment: '<article data-block=Comment style="padding: 10px"><p>{{item.body}}</p></article>' }), rawValues: values }), true);
});

test('Unicode-indented TPL directives retain their original ownership and CRLF spelling', () => {
  for (const newline of ['\n', '\r\n']) {
    const body = `<section data-block="List">${newline}\u00a0@each item in first:${newline}<p>{{item.body}}</p>${newline}\u00a0@endeach${newline}</section>`;
    const files = { 'index.tpl': body }, scope = createBlockEditScope({ version: 1, intent: 'source',
      blockSources: [{ id: 'list', path: 'index.tpl', start: 0, end: body.length, content: body }],
      blockInstances: [{ id: 'list-1', sourceId: 'list', valuePaths: [] }], valueUses: [], selectedInstanceIds: ['list-1'] }, { files, rawValues: {}, values: {} });
    assert.throws(() => assertBlockDraftScope(scope, { files: { 'index.tpl': body.replace('in first', 'in second') }, rawValues: {} }), /new data dependencies/);
    assert.equal(assertBlockDraftScope(scope, { files: { 'index.tpl': body.replace('<p>', '<p style="color: red">') }, rawValues: {} }), true);
  }
});

test('unchanged includes cannot move to another loop lexical scope', () => {
  const body = '<section data-block="Lists">\n@each item in first:\n@include "shared/card.tpl"\n@endeach\n@each item in second:\n@endeach\n</section>';
  const files = { 'index.tpl': body, 'shared/card.tpl': '<p>{{item.body}}</p>' }, scope = createBlockEditScope({ version: 1, intent: 'source',
    blockSources: [{ id: 'lists', path: 'index.tpl', start: 0, end: body.length, content: body }],
    blockInstances: [{ id: 'lists-1', sourceId: 'lists', valuePaths: [] }], valueUses: [], selectedInstanceIds: ['lists-1'] }, { files, rawValues: {}, values: {} });
  const moved = body.replace('@include "shared/card.tpl"\n', '').replace('@each item in second:\n', '@each item in second:\n@include "shared/card.tpl"\n');
  assert.throws(() => assertBlockDraftScope(scope, { files: { ...files, 'index.tpl': moved }, rawValues: {} }), /new data dependencies/);
  assert.equal(assertBlockDraftScope(scope, { files: { ...files, 'index.tpl': body.replace('<section data-block="Lists">', '<section data-block="Lists" style="padding: 10px">') }, rawValues: {} }), true);
});

test('multiple selected fragments of changing sizes preserve every intervening source byte', () => {
  const { scope, files, values } = setup({ selectedInstanceIds: ['first', 'form'] });
  const changed = blockScopeFiles(scope, { comment: '<article data-block="Comment" style="padding: 10px"><div><p>{{item.body}}</p></div></article>', form: '<form data-block="order_form" class="updated"><label>Order<input></label></form>' });
  assert.equal(assertBlockDraftScope(scope, { files: changed, rawValues: values }), true);
  assert.ok(changed['index.tpl'].includes('Unselected header'));
  assert.throws(() => assertBlockDraftScope(scope, { files: { ...changed, 'index.tpl': changed['index.tpl'].replace('</article>\n<form', '</article>Added outside<form') }, rawValues: values }), /outside/);
  assert.equal(files['index.tpl'], scope.baselineFiles['index.tpl']);
});
