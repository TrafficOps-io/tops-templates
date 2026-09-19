import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    const value = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(value);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const source = '@template "Recovery test"\n@section content "Content"\n@param title String = "Disk title" label="Page title"\n@endsection\n@layout\n<!doctype html><html><head><meta charset="utf-8"><title>{{title}}</title></head><body><h1>{{title}}</h1></body></html>\n@endlayout\n';
// Some managed macOS runners terminate Chromium on deserializing an OPFS handle.
// Default to explicit folder-handle simulation; IndexedDB and the application
// remain real. Opt into native OPFS coverage with STUDIO_NATIVE_HANDLES=1.
const nativeHandles = process.env.STUDIO_NATIVE_HANDLES === '1';
let browser, page;
const errors = [];

async function newPage(context) {
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  if (!nativeHandles) await context.addInitScript(() => {
    const original = IDBObjectStore.prototype.getAll;
    const missing = () => new DOMException('Fixture entry does not exist.', 'NotFoundError');
    function directory(fixture, path = '') {
      const files = fixture.fixtureFiles, folders = new Set(fixture.fixtureFolders);
      const prefix = path ? `${path}/` : '';
      return {
        kind: 'directory', name: path.split('/').pop() || fixture.name,
        async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
        async *values() {
          const names = new Set([...Object.keys(files), ...folders].filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length).split('/')[0]));
          for (const name of names) yield Object.hasOwn(files, prefix + name) ? await this.getFileHandle(name) : await this.getDirectoryHandle(name);
        },
        async getDirectoryHandle(name) {
          const child = prefix + name;
          if (!folders.has(child) && !Object.keys(files).some(file => file.startsWith(`${child}/`))) throw missing();
          return directory(fixture, child);
        },
        async getFileHandle(name) {
          const file = prefix + name;
          if (!Object.hasOwn(files, file)) throw missing();
          return { kind: 'file', name, async getFile() { return new File([files[file]], name); }, async createWritable() { throw new Error('Recovery must not write to the simulated source folder.'); } };
        },
      };
    }
    IDBObjectStore.prototype.getAll = function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'directory-projects') request.addEventListener('success', () => {
        const result = request.result.map(project => project.handle?.fixtureFiles ? { ...project, handle: directory(project.handle) } : project);
        Object.defineProperty(request, 'result', { value: result });
      });
      return request;
    };
  });
  const result = await context.newPage();
  result.setDefaultTimeout(20000);
  result.on('pageerror', error => errors.push(error.message));
  await result.goto(url);
  await result.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  return result;
}

async function poll(read, predicate, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`);
}

async function readWorkspace() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('trafficops-landing-workspace', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('workspace', 'readonly');
      const value = transaction.objectStore('workspace').get('last');
      transaction.oncomplete = () => { database.close(); resolve(value.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function readLibrary() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('trafficops-studio-library', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction(['projects', 'preferences'], 'readonly');
      const projects = transaction.objectStore('projects').getAll(), active = transaction.objectStore('preferences').get('active-project');
      transaction.oncomplete = () => {
        database.close();
        resolve({ active: active.result, projects: projects.result.map(record => ({ ...record, files: Object.fromEntries(Object.entries(record.files).map(([path, value]) => [path, value instanceof Uint8Array ? Array.from(value) : value])) })) });
      };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function seedFolder({ invalidSettings = false } = {}) {
  return page.evaluate(async ({ source, invalidSettings, nativeHandles }) => {
    let handle;
    if (nativeHandles) {
      // OPFS is private to this disposable profile; no personal directory is used.
      const originRoot = await navigator.storage.getDirectory();
      handle = await originRoot.getDirectoryHandle('isolated-recovery-folder', { create: true });
      const file = await handle.getFileHandle('index.tpl', { create: true });
      const writable = await file.createWritable(); await writable.write(source); await writable.close();
      await handle.getDirectoryHandle('empty', { create: true });
      if (invalidSettings) {
        const metadata = await handle.getDirectoryHandle('.trafficops', { create: true });
        const values = await metadata.getFileHandle('values.json', { create: true });
        const writer = await values.createWritable(); await writer.write('{invalid json'); await writer.close();
      }
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('OPFS permission must be granted for this regression.');
    } else {
      handle = { name: 'isolated-recovery-folder', fixtureFiles: { 'index.tpl': source, ...(invalidSettings ? { '.trafficops/values.json': '{invalid json' } : {}) }, fixtureFolders: ['empty'] };
    }
    const recoveredFiles = { 'index.tpl': source.replace('<body>', '<body data-recovery="true">') };
    const workspace = { name: 'Recovered folder', files: recoveredFiles, folders: ['empty'], overrides: { title: 'Recovered field value' }, sourceBaseline: { 'index.tpl': source }, projectId: 'recovery-folder', dirty: true };
    const put = (name, storeName, record, key, keyPath) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName, keyPath ? { keyPath } : undefined);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(storeName, 'readwrite');
        if (keyPath) transaction.objectStore(storeName).put(record); else transaction.objectStore(storeName).put(record, key);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
    await put('trafficops-template-studio', 'directory-projects', { id: workspace.projectId, name: handle.name, handle, lastOpenedAt: Date.now(), displayPath: '' }, undefined, 'id');
    await put('trafficops-landing-workspace', 'workspace', workspace, 'last');
    return workspace;
  }, { source, invalidSettings, nativeHandles });
}

try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  console.log(`Folder handles: ${nativeHandles ? 'native isolated OPFS' : 'simulated read API'}; storage: real IndexedDB in disposable browser contexts.`);

  const detached = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  page = await newPage(detached);
  const expected = await seedFolder();
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByLabel('Page title', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Recovered field value');
  await page.locator('.browser-frame iframe').contentFrame().getByRole('heading', { name: 'Recovered field value', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const saved = await poll(readWorkspace, value => value?.dirty === false && value.detached === true, 'detached recovery commit after Save draft');
  assert.equal(saved.projectId, expected.projectId);
  assert.deepEqual(saved.files, expected.files);
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByLabel('Page title', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Recovered field value');
  assert.deepEqual((await readWorkspace()).files, expected.files);
  const disk = await page.evaluate(async nativeHandles => {
    if (nativeHandles) {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('isolated-recovery-folder');
      return (await (await directory.getFileHandle('index.tpl')).getFile()).text();
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('trafficops-template-studio', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction('directory-projects', 'readonly');
        const value = transaction.objectStore('directory-projects').get('recovery-folder');
        transaction.oncomplete = () => { database.close(); resolve(value.result.handle.fixtureFiles['index.tpl']); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  }, nativeHandles);
  assert.equal(disk, source, 'Save draft on a detached copy must not overwrite disk');
  console.log('PASS: detached folder recovery survives Save draft and reload when disk differs.');
  await detached.close();

  const malformed = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  page = await newPage(malformed);
  const malformedExpected = await seedFolder({ invalidSettings: true });
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Your recovery copy is open' }).waitFor();
  await page.getByLabel('Page title', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Recovered field value');
  await poll(readWorkspace, value => value?.detached === true, 'failed folder read retains detached recovery');
  assert.deepEqual((await readWorkspace()).files, malformedExpected.files);
  await page.locator('.studio-project-bar').getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  const recovered = await poll(readLibrary, value => value.projects.length === 1, 'leaving recovery makes an independent saved copy');
  assert.deepEqual(recovered.projects[0].files, malformedExpected.files);
  assert.equal(recovered.projects[0].settings.title, 'Recovered field value');
  assert.equal(await readWorkspace(), null);
  console.log('PASS: malformed folder values open recovery and preserve an independent copy on leaving.');
  await malformed.close();

  const conflict = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  page = await newPage(conflict);
  await page.evaluate(async source => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('trafficops-studio-library', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(['projects', 'preferences'], 'readwrite');
        transaction.objectStore('projects').put({ id: 'deleted-project', kind: 'landing', name: 'Deleted landing', revision: 1, files: { 'index.tpl': source, 'images/pixel.png': new Uint8Array([0, 1, 255]) }, folders: ['empty', 'images'], settings: { title: 'Original value' }, createdAt: Date.now(), updatedAt: Date.now() });
        transaction.objectStore('preferences').put('deleted-project', 'active-project');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  }, source);
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByLabel('Page title', { exact: false }).waitFor();
  const other = await conflict.newPage();
  await other.goto(url);
  await other.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await other.getByRole('heading', { name: 'Deleted landing', exact: true }).waitFor();
  await other.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('trafficops-studio-library', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction(['projects', 'preferences'], 'readwrite');
      transaction.objectStore('projects').delete('deleted-project');
      transaction.objectStore('preferences').delete('active-project');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  await page.getByLabel('Page title', { exact: false }).fill('Rescued unsaved value');
  await page.locator('.studio-project-bar').getByRole('button', { name: 'Save as new project', exact: true }).waitFor();
  await page.locator('.studio-project-bar').getByRole('button', { name: 'Save as new project', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByRole('heading', { name: 'Deleted landing (recovered)', exact: true }).waitFor();
  const rescue = await poll(readLibrary, value => value.projects.length === 1 && value.projects[0].settings.title === 'Rescued unsaved value', 'conflict rescue commit');
  assert.notEqual(rescue.projects[0].id, 'deleted-project');
  assert.equal(rescue.active, rescue.projects[0].id);
  assert.equal(rescue.projects[0].kind, 'landing');
  assert.equal(rescue.projects[0].files['index.tpl'], source);
  assert.deepEqual(rescue.projects[0].files['images/pixel.png'], [0, 1, 255]);
  assert.deepEqual(rescue.projects[0].folders, ['empty', 'images']);
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByLabel('Page title', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Rescued unsaved value');
  await page.locator('.studio-project-bar').getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  assert.equal(await page.locator('.library-grid:not(.starter-grid) .library-card').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: deleting a project in another tab stops stale saves; Save as new project preserves edits, assets and folders.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '/tmp/studio-recovery-failure.png', fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
