import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {initRepository, addTemplate, bundleRepository} from '../src/repositories.js';
import {readZipProject, LIMITS} from '../../packages/template-editor-core/src/project.js';
import {parseRepositoryIndex} from '../../runtime/src/repository-index.js';

const source = '@param title String = "Welcome" required\n@param description String = "Default description"\n@layout\n<h1>{{title}}</h1><p>{{description}}</p>\n@endlayout';
async function fixture(t) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tops-repository-test-')));
  t.after(() => rm(temporary, {recursive:true, force:true}));
  const project = path.join(temporary, 'source'), repository = path.join(temporary, 'repository');
  await mkdir(project); await writeFile(path.join(project, 'landing.tpl'), source);
  return {temporary, project, repository};
}
const manifest = root => readFile(path.join(root, 'repository.json'), 'utf8').then(JSON.parse);
async function initAndAdd(t, options = {}) {
  const paths = await fixture(t);
  await initRepository(paths.repository, {name:'Team templates', author:'Test Team', homepage:'https://example.com'});
  await addTemplate(paths.repository, {path:paths.project, name:'Product Launch', ...options});
  return paths;
}

test('initialization creates a valid empty repository and preserves unrelated existing files', async t => {
  const {repository} = await fixture(t);
  await mkdir(repository); await writeFile(path.join(repository, 'keep.txt'), 'keep');
  const result = await initRepository(repository, {name:'Team', description:'Our landings', author:'TrafficOps', homepage:'https://example.com'});
  assert.equal(result.root, repository);
  assert.equal(result.manifest.repository.name, 'Team');
  assert.deepEqual(await readdir(path.join(repository, 'templates')), []);
  const output = await bundleRepository(repository);
  assert.deepEqual(parseRepositoryIndex(output.index, 'https://example.com/index.json').templates, []);
  assert.match(await readFile(path.join(output.output, '_headers'), 'utf8'), /Access-Control-Allow-Origin: \*/);
  await assert.rejects(initRepository(repository, {name:'Replacement'}), /already exists/);
  assert.equal((await manifest(repository)).repository.name, 'Team');
  assert.equal(await readFile(path.join(repository, 'keep.txt'), 'utf8'), 'keep');
});

test('add copies binary assets, empty folders and Studio values while excluding identity and history', async t => {
  const {temporary, repository, project} = await fixture(t);
  await mkdir(path.join(project, 'assets', 'empty'), {recursive:true});
  await mkdir(path.join(project, '.trafficops', 'conversations'), {recursive:true});
  await writeFile(path.join(project, 'assets', 'sample.bin'), Uint8Array.of(0, 1, 255, 128));
  await writeFile(path.join(project, '.trafficops', 'values.json'), JSON.stringify({title:'Saved title', description:'Retained'}));
  await writeFile(path.join(project, '.trafficops', 'project.json'), '{"secret":"identity"}');
  await writeFile(path.join(project, '.trafficops', 'conversations', 'private.json'), '{"secret":"chat"}');
  await writeFile(path.join(project, '.env'), 'DO_NOT_COPY=secret');
  const data = path.join(temporary, 'values.json'); await writeFile(data, '{"title":"A & B"}');
  const thumbnail = path.join(temporary, 'thumbnail.svg'); await writeFile(thumbnail, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await initRepository(repository, {name:'Team'});
  const {entry} = await addTemplate(repository, {path:project, name:'Product Launch', data, thumbnail, description:'A product page'});
  assert.equal(entry.id, 'product-launch'); assert.equal(entry.version, '1.0.0'); assert.equal(entry.thumbnail, 'thumbnails/product-launch.svg');
  await rm(project, {recursive:true}); await rm(thumbnail);
  const snapshot = path.join(repository, 'templates', entry.id);
  assert.deepEqual(await readdir(path.join(snapshot, '.trafficops')), ['values.json']);
  await assert.rejects(readFile(path.join(snapshot, '.env')), /ENOENT/);
  const {output, index} = await bundleRepository(repository);
  const bytes = await readFile(path.join(output, index.templates[0].archive)), imported = readZipProject(bytes);
  assert.deepEqual(imported.settings, {title:'A & B', description:'Retained'});
  assert.equal(imported.metadata, undefined); assert.equal(imported.conversationFiles, undefined);
  assert.deepEqual(imported.files['assets/sample.bin'], Uint8Array.of(0, 1, 255, 128));
  assert.ok(imported.folders.includes('assets/empty'));
  assert.equal(index.templates[0].preview, 'previews/product-launch/landing.html');
  assert.equal(index.templates[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(await readFile(path.join(output, index.templates[0].preview), 'utf8'), /<h1>A &amp; B<\/h1><p>Retained<\/p>/);
  assert.equal(await readFile(path.join(output, entry.thumbnail), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

test('single tpl includes its source graph and bundles the correct generated entrypoint', async t => {
  const {repository, project} = await fixture(t);
  await mkdir(path.join(project, 'parts'));
  await writeFile(path.join(project, 'landing.tpl'), '@param title String = "Hello"\n@include "parts/body.tpl"');
  await writeFile(path.join(project, 'parts', 'body.tpl'), '@layout\n<h1>{{title}}</h1>\n@endlayout');
  await writeFile(path.join(project, 'unrelated.txt'), 'private');
  await initRepository(repository, {name:'Team'});
  const {entry} = await addTemplate(repository, {path:path.join(project, 'landing.tpl'), thumbnail:'https://cdn.example.com/image.png'});
  assert.equal(entry.id, 'landing');
  const {index, output} = await bundleRepository(repository);
  const imported = readZipProject(await readFile(path.join(output, 'landing.zip')));
  assert.deepEqual(Object.keys(imported.files).sort(), ['landing.tpl', 'parts/body.tpl']);
  assert.equal(index.templates[0].thumbnail, 'https://cdn.example.com/image.png');
  assert.match(await readFile(path.join(output, index.templates[0].preview), 'utf8'), /<h1>Hello<\/h1>/);
});

test('bundle is deterministic and force changes only generated paths', async t => {
  const {repository} = await initAndAdd(t);
  const first = await bundleRepository(repository);
  const before = await readFile(path.join(first.output, 'product-launch.zip'));
  const initialIndex = await readFile(path.join(first.output, 'index.json'));
  await writeFile(path.join(first.output, 'keep.txt'), 'not generated');
  await assert.rejects(bundleRepository(repository), /--force/);
  const second = await bundleRepository(repository, {force:true});
  assert.deepEqual(await readFile(path.join(second.output, 'product-launch.zip')), before);
  assert.deepEqual(await readFile(path.join(second.output, 'index.json')), initialIndex);
  assert.equal(await readFile(path.join(second.output, 'keep.txt'), 'utf8'), 'not generated');
});

test('invalid template or thumbnail cannot partially publish over a prior successful bundle', async t => {
  const {repository} = await initAndAdd(t);
  const {output} = await bundleRepository(repository);
  const before = await readFile(path.join(output, 'index.json'));
  const archiveBefore = await readFile(path.join(output, 'product-launch.zip'));
  await writeFile(path.join(repository, 'templates', 'product-launch', 'landing.tpl'), '@layout\n{{unknown}}\n@endlayout');
  await assert.rejects(bundleRepository(repository, {force:true}), /Unknown|unknown/i);
  assert.deepEqual(await readFile(path.join(output, 'index.json')), before);
  assert.deepEqual(await readFile(path.join(output, 'product-launch.zip')), archiveBefore);
  await writeFile(path.join(repository, 'templates', 'product-launch', 'landing.tpl'), source);
  const changed = await manifest(repository); changed.templates[0].thumbnail = 'missing.png';
  await writeFile(path.join(repository, 'repository.json'), JSON.stringify(changed));
  await assert.rejects(bundleRepository(repository, {force:true}), /ENOENT/);
  assert.deepEqual(await readFile(path.join(output, 'index.json')), before);
  assert.deepEqual(await readFile(path.join(output, 'product-launch.zip')), archiveBefore);
});

test('invalid additions leave the manifest and project folder unchanged', async t => {
  const {repository, project} = await initAndAdd(t);
  const before = await readFile(path.join(repository, 'repository.json'));
  await assert.rejects(addTemplate(repository, {path:project, name:'Duplicate', id:'product-launch'}), /Duplicate|already exists/);
  await assert.rejects(addTemplate(repository, {path:project, name:'Unsafe', id:'../escape'}), /id|Unsafe/);
  await assert.rejects(addTemplate(repository, {path:project, name:'Bad values', data:[]}), /JSON object/);
  await assert.rejects(addTemplate(repository, {path:project, name:'Bad required', data:{title:''}}), /required/);
  await assert.rejects(addTemplate(repository, {path:project, name:'Bad thumb', thumbnail:path.join(project, 'landing.tpl')}), /Thumbnail/);
  assert.deepEqual(await readFile(path.join(repository, 'repository.json')), before);
  assert.deepEqual(await readdir(path.join(repository, 'templates')), ['product-launch']);
});

test('source and output symlinks, unsafe manifest paths and source overlap are rejected', async t => {
  const {temporary, repository, project} = await initAndAdd(t);
  const outside = path.join(temporary, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'keep'), 'keep');
  await symlink(outside, path.join(project, 'linked'));
  await assert.rejects(addTemplate(repository, {path:project, name:'Linked'}), /Symbolic links/);
  await rm(path.join(project, 'linked'));
  await symlink(project, path.join(temporary, 'alias'));
  await assert.rejects(addTemplate(repository, {path:path.join(temporary, 'alias', 'landing.tpl'), name:'Alias'}), /Symbolic links/);
  await symlink(outside, path.join(repository, 'dist'));
  await assert.rejects(bundleRepository(repository, {force:true}), /Symbolic links/);
  await rm(path.join(repository, 'dist'));
  await assert.rejects(bundleRepository(repository, {output:repository, force:true}), /overlap/);
  await assert.rejects(bundleRepository(repository, {output:temporary, force:true}), /overlap/);
  await assert.rejects(bundleRepository(repository, {output:path.join(repository, 'templates', 'product-launch', 'dist'), force:true}), /overlap/);
  const changed = await manifest(repository); changed.templates[0].thumbnail = '../outside/keep';
  await writeFile(path.join(repository, 'repository.json'), JSON.stringify(changed));
  await assert.rejects(bundleRepository(repository), /Unsafe/);
  assert.equal(await readFile(path.join(outside, 'keep'), 'utf8'), 'keep');
});

test('preflight detects all output conflicts before writing any repository files', async t => {
  const {repository} = await initAndAdd(t);
  const output = path.join(repository, 'dist'); await mkdir(output);
  await writeFile(path.join(output, 'product-launch.zip'), 'keep archive');
  await writeFile(path.join(output, 'previews'), 'keep file where a directory should be');
  await assert.rejects(bundleRepository(repository, {force:true}), /directory|ENOTDIR/);
  assert.equal(await readFile(path.join(output, 'product-launch.zip'), 'utf8'), 'keep archive');
  await assert.rejects(readFile(path.join(output, 'index.json')), /ENOENT/);
});

test('Studio size limits reject oversized content before adding a source snapshot', async t => {
  const {repository, project} = await fixture(t);
  await initRepository(repository, {name:'Team'});
  await writeFile(path.join(project, 'large.txt'), Buffer.alloc(LIMITS.text + 1, 65));
  await assert.rejects(addTemplate(repository, {path:project, name:'Too large'}), /exceeds 2 MiB/);
  assert.deepEqual((await manifest(repository)).templates, []);
  assert.deepEqual(await readdir(path.join(repository, 'templates')), []);
});

test('bundle accepts the existing demo source format and makes all five templates importable', async t => {
  const {temporary} = await fixture(t);
  const repository = new URL('../../repositories/demo', import.meta.url).pathname;
  const {index, output} = await bundleRepository(repository, {output:path.join(temporary, 'demo-dist')});
  assert.equal(index.templates.length, 5);
  for (const entry of index.templates) {
    const archive = readZipProject(await readFile(path.join(output, entry.archive)));
    assert.ok(Object.keys(archive.files).some(filename => filename.endsWith('.tpl')));
    assert.match(await readFile(path.join(output, entry.preview), 'utf8'), /<h1[\s>]/);
    assert.ok((await readFile(path.join(output, entry.thumbnail))).byteLength);
  }
});

test('manually edited case-colliding IDs and reserved thumbnail paths cannot publish', async t => {
  const {repository} = await initAndAdd(t);
  const {output} = await bundleRepository(repository);
  const before = await readFile(path.join(output, 'index.json'));
  const original = await manifest(repository);
  await writeFile(path.join(repository, 'repository.json'), JSON.stringify({...original, templates:[...original.templates, {...original.templates[0], id:'Product-Launch'}]}));
  await assert.rejects(bundleRepository(repository, {force:true}), /case-insensitive/);
  const edited = {...original, templates:[{...original.templates[0], thumbnail:'INDEX.JSON'}]};
  await writeFile(path.join(repository, 'INDEX.JSON'), 'thumbnail');
  await writeFile(path.join(repository, 'repository.json'), JSON.stringify(edited));
  await assert.rejects(bundleRepository(repository, {force:true}), /collision/);
  assert.deepEqual(await readFile(path.join(output, 'index.json')), before);
});
