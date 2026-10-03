import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateProject} from '../../runtime/src/index.js';
import {parseRepositoryIndex} from '../../runtime/src/repository-index.js';
import {readZipProject} from '../../packages/template-editor-core/src/project.js';
import {fetchRepositoryIndex, loadRepositoryTemplate, repositoryTemplates} from '../../editor/src/template-repositories.js';
import {analyzeStudioProject} from '../../editor/src/hosts/studio-analyzer.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const demo = fileURLToPath(new URL('../../repositories/demo', import.meta.url));
const indexUrl = 'https://repository.example/team/catalog/index.json';
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], {cwd, encoding:'utf8', timeout:30000});
const succeed = result => assert.equal(result.status, 0, `${result.error?.message || ''}\n${result.stderr}\n${result.stdout}`);
const bytes = value => Buffer.from(value);
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
async function temporary(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tops-repository-cli-')));
  t.after(() => rm(directory, {recursive:true, force:true}));
  return directory;
}
async function writeTree(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), {recursive:true});
    await writeFile(filename, content);
  }
}
function localResource(root, resource, base = indexUrl) {
  const baseUrl = new URL('.', base), resolved = new URL(resource, base);
  assert.equal(resolved.origin, baseUrl.origin);
  assert.ok(resolved.pathname.startsWith(baseUrl.pathname), `Repository-relative URL: ${resource}`);
  const relative = decodeURIComponent(resolved.pathname.slice(baseUrl.pathname.length));
  assert.ok(relative && !relative.split('/').includes('..'));
  return path.join(root, relative);
}
async function inspectBundle(output, base = indexUrl) {
  const raw = await json(path.join(output, 'index.json'));
  const catalog = parseRepositoryIndex(raw, base), projects = new Map();
  for (let i = 0; i < catalog.templates.length; i++) {
    const entry = catalog.templates[i], source = raw.templates[i];
    assert.ok(source.archive && !/^(?:[a-z]+:|\/)/i.test(source.archive), 'Archives must use portable relative URLs');
    assert.ok(source.preview && !/^(?:[a-z]+:|\/)/i.test(source.preview), 'Previews must use portable relative URLs');
    const archive = await readFile(localResource(output, entry.archive, base));
    assert.equal(createHash('sha256').update(archive).digest('hex'), entry.sha256);
    const project = readZipProject(new Uint8Array(archive));
    assert.equal(project.metadata, undefined, 'Source project identity is not published');
    assert.equal(project.conversationFiles, undefined, 'Source conversations are not published');
    const analysis = analyzeStudioProject({files:project.files, folders:project.folders, locale:'en', entrypoint:null, translations:{en:project.settings}});
    assert.deepEqual(analysis.sourceDiagnostics, [], `${entry.id} source diagnostics`);
    assert.deepEqual(analysis.diagnostics, [], `${entry.id} value diagnostics`);
    assert.equal(analysis.previewAvailable, true);
    const generated = generateProject(project.files, project.settings);
    const preview = localResource(output, entry.preview, base);
    assert.equal(path.basename(preview), analysis.entrypoint);
    for (const [name, content] of Object.entries(generated)) {
      assert.deepEqual(await readFile(path.join(path.dirname(preview), name)), bytes(content), `${entry.id}: preview matches imported ZIP (${name})`);
    }
    await assert.rejects(readFile(path.join(path.dirname(preview), 'index.tpl')), {code:'ENOENT'});
    if (source.thumbnail && !/^https?:/i.test(source.thumbnail)) await readFile(localResource(output, entry.thumbnail, base));
    projects.set(entry.id, {...project, generated});
  }
  return {raw, catalog, projects};
}

const page = `@template "Fixture" version=1
@param title String = "Default title" required
@param description Text = "Default description"
@param destination Url = "https://example.com"
@param accent Color = "#dce4d1"
@layout
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{{title}}</title><link rel="stylesheet" href="styles.css"></head><body style="--accent:{{accent}}"><h1>{{title}}</h1><p>{{description}}</p><a href="{{destination}}">Visit</a><img src="images/mark.svg" alt="Local mark"></body></html>
@endlayout`;
const mark = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="5" fill="#243b30"/></svg>';

test('repository help and alias expose init, add and bundle without requiring --template', () => {
  for (const args of [['repo', '--help'], ['repository', '--help']]) {
    const help = run(args); succeed(help);
    for (const command of ['init', 'add', 'bundle']) assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
  const init = run(['repo', 'init', '--help']); succeed(init);
  for (const flag of ['--name', '--description', '--author', '--homepage']) assert.ok(init.stdout.includes(flag));
  const add = run(['repository', 'add', '--help']); succeed(add);
  for (const flag of ['--path', '--name', '--id', '--description', '--version', '--thumbnail', '--data']) assert.ok(add.stdout.includes(flag));
  const bundle = run(['repo', 'bundle', '--help']); succeed(bundle);
  for (const flag of ['--output', '--force']) assert.ok(bundle.stdout.includes(flag));
});

test('required repository flags produce actionable errors without falling through to page generation', async t => {
  const cwd = await temporary(t);
  for (const [args, missing] of [
    [['repo', 'init'], '--name'],
    [['repo', 'add', '--name', 'Launch'], '--path'],
    [['repo', 'add', '--path', '.'], '--name'],
  ]) {
    const result = run(args, cwd);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(missing), result.stderr);
    assert.doesNotMatch(result.stderr, /required option ['"]?-t, --template/);
  }
  await assert.rejects(readFile(path.join(cwd, 'repository.json')), {code:'ENOENT'});
});

test('init/add/default bundle preserve editable directory sources, local assets and merged Studio values', async t => {
  const cwd = await temporary(t), repository = path.join(cwd, 'team-repository'), source = path.join(cwd, 'original-template');
  await mkdir(repository);
  succeed(run(['repo', 'init', '--name', 'Team templates', '--description', 'Our shared landing pages', '--author', 'Design team', '--homepage', 'https://example.com/team'], repository));
  const metadata = await json(path.join(repository, 'repository.json'));
  assert.equal(metadata.schemaVersion, 1);
  assert.deepEqual(metadata.repository, {name:'Team templates', description:'Our shared landing pages', author:'Design team', homepage:'https://example.com/team'});
  assert.deepEqual(metadata.templates, []);
  const asset = Uint8Array.of(0, 1, 127, 255);
  await writeTree(source, {
    'index.tpl':page, 'styles.css':'body{color:#243b30;background:var(--accent)}', 'images/mark.svg':mark, 'images/raw.png':asset,
    '.trafficops/values.json':JSON.stringify({title:'Saved title', description:'Preserved from Studio', destination:'https://example.com/saved', accent:'#abcdef'}),
    '.trafficops/project.json':JSON.stringify({schema:1, projectId:'source-project', kind:'template', name:'Private working copy', createdAt:1}),
    '.trafficops/conversations/private.json':'Private conversation stays on this computer',
  });
  const data = path.join(cwd, 'overrides.json'), thumbnail = path.join(cwd, 'cover.svg');
  await writeFile(data, JSON.stringify({title:'Launch <edited> & ready'})); await writeFile(thumbnail, mark);
  succeed(run(['repo', 'add', '--path', source, '--name', 'Launch page', '--id', 'team-launch', '--description', 'An editable launch page', '--version', '2.3.0', '--thumbnail', thumbnail, '--data', data], repository));
  const added = await json(path.join(repository, 'repository.json'));
  assert.equal(added.templates.length, 1);
  assert.equal(added.templates[0].id, 'team-launch');
  // Adding takes an independent snapshot: subsequent packaging must not need the input tree or JSON file.
  await rm(source, {recursive:true}); await rm(data); await rm(thumbnail);
  succeed(run(['repo', 'bundle'], repository));
  const output = path.join(repository, 'dist'), {raw, catalog, projects} = await inspectBundle(output);
  assert.equal(catalog.repository.name, 'Team templates');
  assert.equal(catalog.templates[0].version, '2.3.0');
  assert.equal(catalog.templates[0].description, 'An editable launch page');
  assert.match(await readFile(path.join(output, '_headers'), 'utf8'), /Access-Control-Allow-Origin:\s*\*/i);
  assert.equal(await readFile(localResource(output, raw.templates[0].thumbnail), 'utf8'), mark);
  const project = projects.get('team-launch');
  assert.equal(project.files['index.tpl'], page);
  assert.deepEqual(bytes(project.files['images/raw.png']), bytes(asset));
  assert.equal(project.files['images/mark.svg'], mark);
  assert.deepEqual(project.settings, {title:'Launch <edited> & ready', description:'Preserved from Studio', destination:'https://example.com/saved', accent:'#abcdef'});
  assert.match(project.generated['index.html'], /Launch &lt;edited&gt; &amp; ready/);
  assert.match(project.generated['index.html'], /Preserved from Studio/);
  assert.ok(Object.keys(project.files).every(name => !name.startsWith('.trafficops/')));
  const fresh = generateProject(project.files, {...project.settings, title:'Another team’s page'});
  assert.match(fresh['index.html'], /Another team’s page/);
  assert.match(project.generated['index.html'], /Launch &lt;edited&gt; &amp; ready/);
});

test('single .tpl add follows nested includes, uses a name slug, preserves its entrypoint and supports explicit output', async t => {
  const cwd = await temporary(t), repository = path.join(cwd, 'catalog'), input = path.join(cwd, 'source'), output = path.join(cwd, 'site');
  succeed(run(['repository', 'init', repository, '--name', 'File templates'], cwd));
  await writeTree(input, {
    'offer.tpl':'@include "parts/fields.tpl"\n@layout\n<!doctype html><html><head><title>{{title}}</title></head><body><h1>{{title}}</h1><p>{{description}}</p></body></html>\n@endlayout',
    'parts/fields.tpl':'@include "defaults.tpl"\n@param title String = "Offer title" required',
    'parts/defaults.tpl':'@param description Text = "Included nested default"',
    'unrelated.txt':'Do not publish this neighbouring file',
  });
  succeed(run(['repo', 'add', repository, '--path', path.join(input, 'offer.tpl'), '--name', 'Summer Offer', '--thumbnail', 'https://images.example.com/offer.png'], cwd));
  await rm(input, {recursive:true});
  succeed(run(['repo', 'bundle', repository, '-o', output], cwd));
  const {raw, projects} = await inspectBundle(output);
  assert.equal(raw.templates[0].id, 'summer-offer');
  assert.equal(raw.templates[0].version, '1.0.0');
  assert.equal(raw.templates[0].thumbnail, 'https://images.example.com/offer.png');
  assert.match(raw.templates[0].preview, /\/offer\.html$/);
  const project = projects.get('summer-offer');
  assert.deepEqual(Object.keys(project.files).sort(), ['offer.tpl', 'parts/defaults.tpl', 'parts/fields.tpl']);
  assert.match(project.generated['offer.html'], /Included nested default/);
  await assert.rejects(readFile(path.join(repository, 'dist', 'index.json')), {code:'ENOENT'});
});

test('a relocated bundle opens through the Studio repository loader at a nested GitHub raw URL', async t => {
  const cwd = await temporary(t), repository = path.join(cwd, 'working'), source = path.join(cwd, 'source'), output = path.join(cwd, 'publish'), relocated = path.join(cwd, 'relocated-site');
  await writeTree(source, {'index.tpl':page, 'styles.css':'body{margin:0}', 'images/mark.svg':mark});
  succeed(run(['repo', 'init', repository, '--name', 'Portable templates'], cwd));
  succeed(run(['repo', 'add', repository, '--path', source, '--name', 'Portable page'], cwd));
  succeed(run(['repo', 'bundle', repository, '--output', output], cwd));
  await cp(output, relocated, {recursive:true});
  await rm(repository, {recursive:true}); await rm(source, {recursive:true}); await rm(output, {recursive:true});
  const base = 'https://raw.githubusercontent.com/team/pages/main/nested/templates/index.json';
  const {projects} = await inspectBundle(relocated, base), requests = [];
  const fetcher = async (url, options) => {
    requests.push({url, options});
    return new Response(await readFile(localResource(relocated, url, base)));
  };
  const catalog = await fetchRepositoryIndex(base, {fetcher});
  const template = repositoryTemplates({id:'team', url:base, catalog})[0];
  const loaded = await loadRepositoryTemplate(template, {fetcher, cacheStorage:undefined, offline:false});
  assert.deepEqual({...loaded.files}, {...projects.get('portable-page').files});
  assert.deepEqual(loaded.settings, projects.get('portable-page').settings);
  assert.match(generateProject(loaded.files, loaded.settings)['index.html'], /Default title/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.options.credentials === 'omit'));
  assert.ok(requests.every(request => request.url.startsWith(new URL('.', base).href)));
});

test('CLI bundle requires --force for an existing output and preserves unrelated files when forced', async t => {
  const cwd = await temporary(t), repository = path.join(cwd, 'repo'), source = path.join(cwd, 'source'), output = path.join(cwd, 'output');
  await writeTree(source, {'index.tpl':'@param title String = "Original"\n@layout\n<h1>{{title}}</h1>\n@endlayout'});
  succeed(run(['repo', 'init', repository, '--name', 'Team'], cwd));
  succeed(run(['repo', 'add', repository, '--path', source, '--name', 'Page'], cwd));
  succeed(run(['repo', 'bundle', repository, '-o', output], cwd));
  await writeFile(path.join(output, 'keep.txt'), 'An unrelated hosting file');
  const before = await readFile(path.join(output, 'index.json'));
  const rejected = run(['repo', 'bundle', repository, '-o', output], cwd);
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /--force/);
  assert.deepEqual(await readFile(path.join(output, 'index.json')), before);
  succeed(run(['repo', 'bundle', repository, '-o', output, '-f'], cwd));
  assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'An unrelated hosting file');
  await inspectBundle(output);
});

test('the checked-in Demo repository bundles five complete Studio-compatible templates without source changes', async t => {
  const cwd = await temporary(t), output = path.join(cwd, 'demo-site'), fixture = path.join(cwd, 'demo-source');
  const metadataBefore = await readFile(path.join(demo, 'repository.json'));
  // Keep the actual repository fixture isolated even if CLI output routing regresses.
  await cp(demo, fixture, {recursive:true, filter: source => source !== path.join(demo, 'dist')});
  succeed(run(['repo', 'bundle', fixture, '--output', output], cwd));
  const {raw, projects} = await inspectBundle(output);
  assert.equal(raw.repository.name, 'TrafficOps Demo');
  assert.deepEqual(raw.templates.map(entry => entry.id), ['demo-saas', 'demo-course', 'demo-event', 'demo-cafe', 'demo-portfolio']);
  for (const entry of raw.templates) {
    assert.ok(entry.thumbnail, `${entry.id} has a thumbnail`);
    assert.ok(projects.get(entry.id).files['index.tpl']);
    assert.ok(projects.get(entry.id).files['styles.css']);
    assert.match(projects.get(entry.id).generated['index.html'], /<!doctype html>/i);
  }
  assert.deepEqual(await readFile(path.join(fixture, 'repository.json')), metadataBefore);
  assert.deepEqual(await readFile(path.join(demo, 'repository.json')), metadataBefore);
  await assert.rejects(readFile(path.join(fixture, 'dist', 'index.json')), {code:'ENOENT'});
});
