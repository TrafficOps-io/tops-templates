import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createZip } from '@trafficops/template-editor-core';
import { zipSync, strToU8 } from 'fflate';
import { DEFAULT_REPOSITORIES, REPOSITORIES_KEY, DEMO_REPOSITORY_PATH, downloadRepositoryFile, fetchRepositoryIndex, loadRepositoryTemplate, parseRepositoryIndex, readRepositories, repositoryTemplates, repositoryUrl, saveRepositories } from '../src/template-repositories.js';

const url = 'https://raw.githubusercontent.com/team/templates/main/index.json';
const index = () => ({ schemaVersion: 1, repository: { name: 'Team templates', author: 'Our team', homepage: './' }, templates: [{ id: 'launch', name: 'Launch', description: 'Team launch page', version: '1.0', preview: 'preview/index.html', archive: 'archives/launch.zip' }] });
const record = () => ({ id: 'team', url, enabled: true, catalog: parseRepositoryIndex(index(), url) });
const template = () => repositoryTemplates(record())[0];
const zip = () => createZip({ 'index.tpl': '@layout<h1>{{ title }}</h1>@endlayout', 'images/logo.png': new Uint8Array([1, 2, 3]) }, { directories: ['images', 'empty'], settings: { title: 'Team title' }, metadata: { schema: 1, projectId: 'original', kind: 'template', name: 'Original', createdAt: 1, updatedAt: 1 } });
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function memoryCaches() {
  const stores = new Map();
  return { open: async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return { match: async key => entries.get(key)?.clone(), put: async (key, value) => entries.set(key, value.clone()), keys: async () => [...entries.keys()], delete: async key => entries.delete(key) };
  } };
}

test('portable index resolves paths against the index, including GitHub raw and redirect destinations', async () => {
  const parsed = parseRepositoryIndex(index(), url);
  assert.equal(parsed.repository.homepage, 'https://raw.githubusercontent.com/team/templates/main/');
  assert.equal(parsed.templates[0].archive, 'https://raw.githubusercontent.com/team/templates/main/archives/launch.zip');
  assert.equal(parsed.templates[0].preview, 'https://raw.githubusercontent.com/team/templates/main/preview/index.html');
  const response = Response.json(index());
  Object.defineProperty(response, 'url', { value: 'https://cdn.example/catalog/index.json' });
  const fetched = await fetchRepositoryIndex(url, { fetcher: async () => response });
  assert.equal(fetched.templates[0].archive, 'https://cdn.example/catalog/archives/launch.zip');
  assert.equal(repositoryUrl(url + '#fragment'), url);
  assert.equal(repositoryUrl('http://localhost:5173/index.json'), 'http://localhost:5173/index.json');
});

test('reject malformed, ambiguous and executable index fields atomically', () => {
  for (const mutate of [
    data => { data.schemaVersion = 2; }, data => { data.repository.name = ''; },
    data => { data.templates = {}; }, data => { data.templates.push(data.templates[0]); },
    data => { data.templates[0].id = '../bad'; }, data => { data.templates[0].archive = 'javascript:alert(1)'; },
    data => { data.templates[0].preview = 'data:text/html,evil'; }, data => { data.repository.homepage = 'file:///etc/passwd'; },
    data => { data.templates[0].sha256 = 'bad'; }, data => { data.templates[0].name = 'a'.repeat(161); },
    data => { data.templates[0].archive = 'https://user:secret@example.com/archive.zip'; },
  ]) { const data = index(); mutate(data); assert.throws(() => parseRepositoryIndex(data, url)); }
  assert.throws(() => repositoryUrl('github.com/team/index.json'));
  assert.throws(() => parseRepositoryIndex({ ...index(), templates: Array(501).fill(index().templates[0]) }, url));
  assert.equal(parseRepositoryIndex({ ...index(), templates: [] }, url).templates.length, 0);
});

test('same ids from different repositories remain distinct and fit portable source identity', () => {
  const a = template(), b = repositoryTemplates({ ...record(), id: 'another' })[0];
  assert.notEqual(a.id, b.id);
  assert.ok(a.id.length < 160);
});

test('download is credential-free, bounded even without content-length, and cancellable', async () => {
  let options;
  const downloaded = await downloadRepositoryFile(url, { fetcher: async (_url, value) => { options = value; return new Response('abc'); } });
  assert.equal(new TextDecoder().decode(downloaded.bytes), 'abc');
  assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
  await assert.rejects(downloadRepositoryFile(url, { limit: 2, fetcher: async () => new Response('abc') }), /exceeds/);
  await assert.rejects(downloadRepositoryFile(url, { limit: 2, fetcher: async () => new Response('', { headers: { 'content-length': '3' } }) }), /exceeds/);
  await assert.rejects(downloadRepositoryFile(url, { fetcher: async () => new Response('', { status: 404 }) }), /HTTP 404/);
  await assert.rejects(downloadRepositoryFile(url, { fetcher: async () => { throw new TypeError('Failed to fetch'); } }), /CORS/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadRepositoryFile(url, { signal: controller.signal, fetcher: () => assert.fail('must not fetch') }), { name: 'AbortError' });
  await assert.rejects(downloadRepositoryFile(url, { timeout: 5, fetcher: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }), /timed out/);
});

test('HTML and invalid UTF-8 are reported as index errors, not empty catalogs', async () => {
  for (const content of ['<html>GitHub file page</html>', new Uint8Array([0xff])]) {
    await assert.rejects(fetchRepositoryIndex(url, { fetcher: async () => new Response(content) }), /JSON index/);
  }
});

test('saved catalog survives reload and failed refresh; deleting all repositories stays empty', async () => {
  const storage = memoryStorage();
  assert.equal(readRepositories(storage, 'https://studio.example').length, 2);
  const data = { ...record(), index: index(), updatedAt: 42 };
  saveRepositories(storage, [data]);
  const reloaded = readRepositories(storage, 'https://studio.example');
  assert.equal(reloaded[0].catalog.templates[0].name, 'Launch');
  await assert.rejects(fetchRepositoryIndex(url, { fetcher: async () => Response.json({ schemaVersion: 2 }) }));
  assert.equal(readRepositories(storage, 'https://studio.example')[0].updatedAt, 42);
  saveRepositories(storage, [{ ...data, enabled: false }]);
  assert.equal(readRepositories(storage, 'https://studio.example')[0].enabled, false);
  saveRepositories(storage, []); assert.deepEqual(readRepositories(storage, 'https://studio.example'), []);
  storage.setItem(REPOSITORIES_KEY, '{'); assert.throws(() => readRepositories(storage, 'https://studio.example'));
});

test('demo is enabled by default and offered once to old profiles without re-enabling removed or disabled defaults', () => {
  const storage = memoryStorage(), base = 'https://studio.example';
  const defaults = readRepositories(storage, base);
  assert.deepEqual(defaults.map(entry => entry.id), DEFAULT_REPOSITORIES.map(entry => entry.id));
  assert.ok(defaults.every(entry => entry.enabled && entry.builtin));
  assert.equal(defaults[1].url, base + DEMO_REPOSITORY_PATH);

  // A previous release's user removed the original starters and kept their own repo disabled.
  storage.setItem(REPOSITORIES_KEY, JSON.stringify({ schemaVersion: 1, repositories: [{ ...record(), enabled: false }] }));
  const migrated = readRepositories(storage, base);
  assert.equal(migrated.length, 2);
  assert.equal(migrated[0].enabled, false);
  assert.equal(migrated[1].id, 'trafficops-demo'); assert.equal(migrated[1].enabled, true);
  assert.equal(migrated.some(entry => entry.id === 'trafficops'), false);

  saveRepositories(storage, migrated.map(entry => ({ ...entry, enabled: false })));
  assert.ok(readRepositories(storage, base).every(entry => !entry.enabled));
  saveRepositories(storage, migrated.filter(entry => entry.id !== 'trafficops-demo'));
  assert.deepEqual(readRepositories(storage, base).map(entry => entry.id), ['team']);

  // Existing manual connections to the same URL are neither duplicated nor re-enabled.
  storage.setItem(REPOSITORIES_KEY, JSON.stringify({ schemaVersion: 1, repositories: [{ id: 'manual-demo', url: base + DEMO_REPOSITORY_PATH, enabled: false }] }));
  const manual = readRepositories(storage, base);
  assert.equal(manual.length, 1); assert.equal(manual[0].enabled, false); assert.equal(manual[0].builtin, true);
});

test('ZIP creates an independent source snapshot with values, binary assets and empty folders', async () => {
  const bytes = zip(), entry = { ...template(), sha256: createHash('sha256').update(bytes).digest('hex') };
  const project = await loadRepositoryTemplate(entry, { fetcher: async () => new Response(bytes), cacheStorage: memoryCaches() });
  assert.equal(project.settings.title, 'Team title');
  assert.deepEqual(project.files['images/logo.png'], new Uint8Array([1, 2, 3]));
  assert.ok(project.folders.includes('empty'));
  assert.equal(project.metadata, undefined); assert.equal(project.conversationFiles, undefined);
  assert.equal(project.projectId, undefined); assert.equal(project.pendingAi, undefined);
});

test('reject corrupt, unsafe ZIPs and checksum mismatches before caching or creating', async () => {
  await assert.rejects(loadRepositoryTemplate({ ...template(), sha256: '0'.repeat(64) }, { fetcher: async () => new Response(zip()), cacheStorage: memoryCaches() }), /SHA-256/);
  for (const bytes of [strToU8('<html>404</html>'), zipSync({ '../escape.tpl': strToU8('bad') })]) {
    await assert.rejects(loadRepositoryTemplate(template(), { fetcher: async () => new Response(bytes), cacheStorage: memoryCaches() }));
  }
});

test('offline ZIP cache is isolated by repository and release; HTTP failures cannot silently reuse old code', async () => {
  const cacheStorage = memoryCaches(), entry = template();
  await loadRepositoryTemplate(entry, { cacheStorage, fetcher: async () => new Response(zip()) });
  const offline = async () => { throw new TypeError('Offline'); };
  const cached = await loadRepositoryTemplate(entry, { cacheStorage, offline: true, fetcher: () => assert.fail('cached offline template should not fetch') });
  assert.equal(cached.settings.title, 'Team title');
  assert.equal((await loadRepositoryTemplate(entry, { cacheStorage, fetcher: offline })).settings.title, 'Team title');
  for (const changed of [{ version: '2.0' }, { repositoryId: 'other' }, { sha256: '0'.repeat(64) }, { archive: 'https://example.com/new.zip' }]) {
    await assert.rejects(loadRepositoryTemplate({ ...entry, ...changed }, { cacheStorage, fetcher: offline }), /CORS/);
  }
  await assert.rejects(loadRepositoryTemplate(entry, { cacheStorage, fetcher: async () => new Response('', { status: 404 }) }), /HTTP 404/);
});

test('bundled repository archives match published checksums', async () => {
  const root = new URL('../public/template-repositories/trafficops/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('index.json', root), 'utf8'));
  parseRepositoryIndex(source, url);
  for (const entry of source.templates) {
    const bytes = await readFile(new URL(entry.archive, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});
