import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createStudioProject } from '../src/studio-library.js';
import { readZipProject } from '@trafficops/template-editor-core';
import { studioChat } from './support/studio-chat.js';

// Real OPFS handles and real IndexedDB in a disposable profile. Some managed
// macOS runners crash Chromium while cloning native directory handles. Set
// STUDIO_NATIVE_HANDLES=0 there to bridge only the handle reference by its OPFS
// name; file reads/writes, permissions, content CAS and history remain real.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const nativeHandles = process.env.STUDIO_NATIVE_HANDLES !== '0';
const root = resolve(process.argv[2] || 'editor/dist');
const source = '@template "Folder continuity"\n@section content "Content"\n@param title String = "Initial title" label="Page title"\n@endsection\n@layout\n<html><head><meta charset="utf-8"><title>{{title}}</title></head><body><h1>{{title}}</h1></body></html>\n@endlayout\n';
const fixture = { ...createStudioProject({ kind: 'landing', name: 'Folder continuity', files: { 'index.tpl': source, 'notes.txt': 'Keep the same project and dialogues.', 'assets/pixel.png': new Uint8Array([0, 1, 255]) }, folders: ['empty', 'assets'], settings: { title: 'Device content' }, appliedAiRuns: ['already-applied-run'] }, { id: 'folder-continuity-project' }), revision: 1 };
const now = Date.now();
const document = { schema: 1, projectId: fixture.id, revision: 1, legacyMigrated: true, threads: [
  { id: 'thread-alpha', title: 'Plan the page', archived: false, createdAt: now, updatedAt: now, messages: [{ id: 'message-alpha', role: 'user', prompt: 'Keep this conversation when saving to a folder.', createdAt: now }, { id: 'answer-alpha', role: 'assistant', text: 'Saved conversations stay with the same project.', createdAt: now + 1 }] },
  { id: 'thread-beta', title: 'Review typography', archived: true, createdAt: now + 2, updatedAt: now + 2, messages: [{ id: 'message-beta', role: 'user', prompt: 'A second saved conversation.', createdAt: now + 2 }] },
], runs: [] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try { const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path)); if (!file.startsWith(root + '/')) throw new Error('Invalid path'); response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const report = { handles: nativeHandles ? 'native isolated OPFS and IndexedDB handle cloning' : 'real isolated OPFS; name-reference bridge around native handle cloning', paidRequests: 0, errors: [], checks: [] };
async function poll(read, predicate, label) { const end = Date.now() + 20000; while (Date.now() < end) { const value = await read(); if (predicate(value)) return value; await delay(100); } throw new Error(`Timed out: ${label}`); }
async function readStorage() {
  return page.evaluate(async () => {
    const read = (name, stores) => new Promise((done, reject) => { const request = indexedDB.open(name, 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction(stores, 'readonly'), result = {}; for (const store of stores) { const value = tx.objectStore(store).getAll(); value.onsuccess = () => { result[store] = value.result; }; } tx.oncomplete = () => { db.close(); done(result); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; });
    const library = await read('trafficops-studio-library', ['projects', 'preferences']);
    const bindings = await read('trafficops-template-studio', ['directory-projects']);
    const history = await read('trafficops-studio-conversations', ['documents']);
    return { records: library.projects.map(record => ({ ...record, files: Object.fromEntries(Object.entries(record.files).map(([path, value]) => [path, value instanceof Uint8Array ? Array.from(value) : value])) })), bindings: bindings['directory-projects'].map(binding => ({ id: binding.id, projectId: binding.projectId, name: binding.name, kind: binding.handle.kind, handleName: binding.handle.name })), histories: history.documents };
  });
}
async function readFolder(name) {
  return page.evaluate(async name => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(name), entries = [], files = {};
    async function visit(directory, prefix = '') { for await (const entry of directory.values()) { const path = prefix + entry.name; entries.push(path); if (entry.kind === 'directory') await visit(entry, path + '/'); else { const file = await entry.getFile(); files[path] = path.endsWith('.png') ? Array.from(new Uint8Array(await file.arrayBuffer())) : await file.text(); } } }
    await visit(handle);
    return { entries: entries.sort(), files, metadata: files['.trafficops/project.json'] ? JSON.parse(files['.trafficops/project.json']) : null, conversations: files['.trafficops/conversations.json'] ? JSON.parse(files['.trafficops/conversations.json']) : null };
  }, name);
}
async function chooseFolder(name) { await page.evaluate(name => localStorage.setItem('test-folder-picker', name), name); }
try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'allow', reducedMotion: 'reduce' });
  await context.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin + '/') || url.startsWith(`blob:${origin}/`) || url.startsWith('data:')) return route.continue(); if (/openrouter\.ai|\/chat\/completions/.test(url)) report.paidRequests++; return route.abort(); });
  await context.addInitScript(({ nativeHandles }) => {
    if (window.top !== window) return;
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const nativeDirectory = async name => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    function reference(name) {
      return { kind: 'directory', name, __testOpfs: name,
        async queryPermission(options) { return (await nativeDirectory(name)).queryPermission(options); }, async requestPermission(options) { return (await nativeDirectory(name)).requestPermission(options); },
        async getDirectoryHandle(...args) { return (await nativeDirectory(name)).getDirectoryHandle(...args); }, async getFileHandle(...args) { return (await nativeDirectory(name)).getFileHandle(...args); },
        async removeEntry(...args) { return (await nativeDirectory(name)).removeEntry(...args); }, async *values() { yield* (await nativeDirectory(name)).values(); },
        async isSameEntry(other) { return (await nativeDirectory(name)).isSameEntry(other.__testOpfs ? await nativeDirectory(other.__testOpfs) : other); },
      };
    }
    window.showDirectoryPicker = async () => { const name = localStorage.getItem('test-folder-picker') || 'continuity-folder'; return nativeHandles ? nativeDirectory(name) : reference(name); };
    if (!nativeHandles) {
      const put = IDBObjectStore.prototype.put, getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.put = function (value, ...args) { return put.call(this, this.name === 'directory-projects' && value.handle ? { ...value, handle: { kind: 'directory', name: value.handle.name, __testOpfs: value.handle.name } } : value, ...args); };
      IDBObjectStore.prototype.getAll = function (...args) { const request = getAll.apply(this, args); if (this.name === 'directory-projects') request.addEventListener('success', () => { const result = request.result.map(record => record.handle?.__testOpfs ? { ...record, handle: reference(record.handle.__testOpfs) } : record); Object.defineProperty(request, 'result', { value: result }); }); return request; };
    }
    if (typeof FileSystemFileHandle === 'undefined') return;
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const writer = await createWritable.apply(this, args), name = this.name;
      return { async write(value) { if (name === 'index.tpl' && window.__holdTransferWrite) { window.__holdTransferWrite = false; window.__writeHeld = true; await new Promise(done => { window.__releaseTransferWrite = done; }); } return writer.write(value); }, close: () => writer.close(), abort: reason => writer.abort(reason) };
    };
  }, { nativeHandles });
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin); await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await page.evaluate(async ({ fixture, document }) => {
    const open = (name, initialize) => new Promise((done, reject) => { const request = indexedDB.open(name, 1); request.onupgradeneeded = () => initialize?.(request.result); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    const write = (db, stores, callback) => new Promise((done, reject) => { const tx = db.transaction(stores, 'readwrite'); callback(tx); tx.oncomplete = done; tx.onabort = () => reject(tx.error); });
    fixture.files['assets/pixel.png'] = new Uint8Array(fixture.files['assets/pixel.png']);
    const library = await open('trafficops-studio-library'); await write(library, ['projects', 'preferences'], tx => { tx.objectStore('projects').put(fixture); tx.objectStore('preferences').put(fixture.id, 'active-project'); }); library.close();
    const conversations = await open('trafficops-studio-conversations', db => { db.createObjectStore('documents', { keyPath: 'projectId' }); db.createObjectStore('disk-sync', { keyPath: 'projectId' }); }); await write(conversations, ['documents'], tx => tx.objectStore('documents').put(document)); conversations.close();
    const target = await (await navigator.storage.getDirectory()).getDirectoryHandle('continuity-folder', { create: true });
    if (await target.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Native OPFS handle permission must be granted.');
  }, { fixture: { ...fixture, files: { ...fixture.files, 'assets/pixel.png': Array.from(fixture.files['assets/pixel.png']) } }, document });
  await page.reload(); await page.getByRole('tab', { name: 'Content', exact: true }).click(); await page.getByLabel('Page title', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Device content');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  // The saved conversation is listed: in the list column when the chat is wide enough, otherwise in the header menu "Conversations".
  { const chat = studioChat(page); await chat.root.waitFor(); if (await chat.threads.isVisible()) await chat.thread('Plan the page').waitFor(); else { const header = chat.root.locator('.studio-chat-header'); await header.getByRole('button', { name: 'Conversations', exact: true }).click(); await header.getByRole('menuitem', { name: 'Plan the page', exact: true }).waitFor(); await page.keyboard.press('Escape'); } }
  await page.evaluate(() => { window.__holdTransferWrite = true; });
  await page.getByRole('button', { name: 'Save to folder', exact: true }).click();
  await page.waitForFunction(() => window.__writeHeld === true);
  await page.evaluate(() => new Promise((done, reject) => {
    const request = indexedDB.open('trafficops-studio-conversations', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents'), get = store.get('folder-continuity-project'); get.onsuccess = () => { const document = get.result; document.revision++; document.threads[1].messages.push({ id: 'message-during-transfer', role: 'assistant', text: 'A checkpoint completed during transfer.', createdAt: Date.now() }); store.put(document); }; tx.oncomplete = () => { db.close(); done(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }));
  await page.evaluate(() => window.__releaseTransferWrite());
  await poll(async () => ({ storage: await readStorage(), folder: await readFolder('continuity-folder') }), value => value.storage.bindings.some(binding => binding.id === fixture.id) && value.folder.metadata?.projectId === fixture.id, 'transfer preserves the logical project ID');
  await page.getByText('Folder: continuity-folder', { exact: false }).first().waitFor();
  let storage = await readStorage(), folder = await readFolder('continuity-folder');
  assert.equal(storage.records.length, 1); assert.equal(storage.records[0].id, fixture.id); assert.equal(storage.bindings.length, 1); assert.equal(storage.bindings[0].projectId, fixture.id); assert.equal(storage.bindings[0].kind, 'directory');
  assert.equal(folder.files['index.tpl'], source); assert.deepEqual(folder.files['assets/pixel.png'], [0, 1, 255]); assert.ok(folder.entries.includes('empty'));
  assert.equal(folder.metadata.kind, 'landing'); assert.equal(folder.metadata.name, fixture.name); assert.deepEqual(folder.metadata.appliedAiRuns, ['already-applied-run']); assert.deepEqual(folder.conversations.threads.map(thread => thread.id), ['thread-alpha', 'thread-beta']);
  folder = await poll(() => readFolder('continuity-folder'), value => value.conversations?.threads[1].messages.some(message => message.id === 'message-during-transfer'), 'latest history is mirrored after rebinding during a transfer');
  assert.equal(folder.conversations.revision, 2);
  report.checks.push('device project transfers to native OPFS without duplicate project, with bytes, empty folders, metadata, applied markers and history');
  await page.reload(); await page.getByText('Folder: continuity-folder', { exact: false }).first().waitFor(); await page.getByRole('tab', { name: 'Content', exact: true }).click(); await page.getByLabel('Page title', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Device content');
  await page.getByLabel('Page title', { exact: false }).fill('Folder content after reload');
  await poll(async () => ({ storage: await readStorage(), folder: await readFolder('continuity-folder') }), value => value.storage.records[0]?.settings.title === 'Folder content after reload' && JSON.parse(value.folder.files['.trafficops/values.json'] || '{}').title === 'Folder content after reload', 'folder autosave also updates the same cache record');
  await page.reload(); await page.getByRole('tab', { name: 'Content', exact: true }).click(); await page.getByLabel('Page title', { exact: false }).waitFor(); assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Folder content after reload');
  await page.getByRole('button', { name: 'Projects', exact: true }).click(); await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor(); assert.equal(await page.locator('.library-grid:not(.starter-grid) .library-card').count(), 1);
  report.checks.push(`${nativeHandles ? 'native handle survives IndexedDB cloning' : 'OPFS handle restores through the name-reference bridge'} and reload; folder changes update one gallery/cache record`);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), source = await root.getDirectoryHandle('continuity-folder'), target = await root.getDirectoryHandle('alternate-folder', { create: true });
    async function copy(from, to) { for await (const entry of from.values()) { if (entry.kind === 'directory') await copy(entry, await to.getDirectoryHandle(entry.name, { create: true })); else { const writer = await (await to.getFileHandle(entry.name, { create: true })).createWritable(); await writer.write(await entry.getFile()); await writer.close(); } } }
    await copy(source, target);
  });
  await chooseFolder('alternate-folder'); await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Continue this project or create a copy?', exact: true }); await review.waitFor(); await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await readStorage()).bindings[0].name, 'continuity-folder', 'Cancelling a same-ID alternate folder must retain the existing durable binding');
  report.checks.push('cancel alternate same-ID folder leaves the existing binding untouched');
  await chooseFolder('untouched-empty-folder'); await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await page.getByText('Folder: untouched-empty-folder', { exact: false }).first().waitFor(); await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor();
  await delay(700); assert.deepEqual((await readFolder('untouched-empty-folder')).entries, [], 'Opening an empty folder must not write starter files or assistant sidecars');
  storage = await readStorage(); assert.equal(storage.records.length, 2); const emptyRecord = storage.records.find(record => record.id !== fixture.id); assert.ok(emptyRecord);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  folder = await poll(() => readFolder('untouched-empty-folder'), value => value.metadata?.projectId === emptyRecord.id && Object.hasOwn(value.files, 'index.tpl'), 'explicit Save writes the in-memory starter');
  assert.ok(folder.files['index.tpl'].length); assert.equal((await readStorage()).records.length, 2);
  await page.reload(); await page.getByText('Folder: untouched-empty-folder', { exact: false }).first().waitFor(); assert.equal((await readStorage()).records.length, 2);
  report.checks.push('empty folder remains unchanged until explicit Save; saved starter retains its ID after reload');
  await page.getByLabel('Switch project', { exact: true }).selectOption(fixture.id); await page.getByText('Folder: continuity-folder', { exact: false }).first().waitFor();
  await chooseFolder('race-transfer-folder'); await page.evaluate(() => { window.__writeHeld = false; window.__holdTransferWrite = true; }); await page.getByRole('button', { name: 'Save to folder', exact: true }).click(); await page.waitForFunction(() => window.__writeHeld === true);
  await page.evaluate(() => new Promise((done, reject) => {
    const request = indexedDB.open('trafficops-studio-library', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), get = store.get('folder-continuity-project'); get.onsuccess = () => { const record = get.result; record.revision++; record.contentRevision++; record.updatedAt = Date.now(); record.settings.title = 'Changed by another window during copy'; store.put(record); }; tx.oncomplete = () => { db.close(); done(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }));
  await page.evaluate(() => window.__releaseTransferWrite()); await page.getByRole('alert').filter({ hasText: 'changed in another window during transfer' }).waitFor();
  storage = await readStorage(); assert.equal(storage.bindings.find(binding => binding.id === fixture.id).name, 'continuity-folder'); assert.equal(storage.records.find(record => record.id === fixture.id).settings.title, 'Changed by another window during copy'); assert.equal(storage.records.length, 2);
  report.checks.push('concurrent device save during copying retains the newer cache and original binding, with a visible transfer conflict');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('menuitem', { name: /Editable project/ }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true }); await exportDialog.waitFor(); const downloadReady = page.waitForEvent('download'); await exportDialog.getByRole('button', { name: 'Download', exact: true }).click(); const download = await downloadReady, bytes = await readFile(await download.path()), imported = readZipProject(new Uint8Array(bytes));
  assert.equal(imported.metadata.projectId, fixture.id); assert.equal(imported.conversations.projectId, fixture.id); assert.equal(imported.conversations.threads.length, 2);
  await page.getByLabel('Import project ZIP', { exact: true }).setInputFiles({ name: 'same-project-source.zip', mimeType: 'application/zip', buffer: bytes });
  const importDialog = page.getByRole('dialog', { name: 'Continue this project or create a copy?', exact: true }); await importDialog.waitFor(); await importDialog.getByText(/changed content values/).waitFor(); await importDialog.getByRole('button', { name: 'Continue project', exact: true }).click();
  await page.getByText('Saved on this device', { exact: false }).first().waitFor();
  storage = await readStorage(); assert.equal(storage.records.length, 2); assert.equal(storage.records.filter(record => record.id === fixture.id).length, 1); assert.equal(storage.bindings.some(binding => binding.id === fixture.id), false); assert.equal(storage.histories.find(document => document.projectId === fixture.id).threads.length, 2); assert.equal(storage.histories.find(document => document.projectId === fixture.id).threads[1].messages.length, 2);
  await page.reload(); await page.getByRole('tab', { name: 'Content', exact: true }).click(); await page.getByLabel('Page title', { exact: false }).waitFor(); assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Folder content after reload'); assert.equal((await readStorage()).records.length, 2);
  report.checks.push('source ZIP preserves identity/history; explicit same-ID Continue updates the device copy, removes the old writable binding and avoids duplicate messages/projects');
  assert.equal(report.paidRequests, 0); assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.message;
  if (page && !page.isClosed()) { await page.screenshot({ path: '/tmp/studio-project-folder-failure.png', fullPage: true }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await writeFile('/tmp/studio-project-folder-report.json', JSON.stringify(report, null, 2)); }
