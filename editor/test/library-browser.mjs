import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { unzipSync, strFromU8 } from 'fflate';

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
let browser, page;

async function readRecords() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('trafficops-studio-library', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('projects', 'readonly');
      const records = transaction.objectStore('projects').getAll();
      records.onsuccess = () => resolve(records.result);
      records.onerror = () => reject(records.error);
      transaction.oncomplete = () => database.close();
    };
  }));
}

async function waitForSaved(name, { headline, cssIncludes } = {}) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const records = await readRecords();
    const record = records.find(item => item.name === name);
    if (record && (headline === undefined || record.settings.headline === headline) && (cssIncludes === undefined || record.files['styles.css']?.includes(cssIncludes))) return record;
    await delay(100);
  }
  throw new Error(`Timed out waiting for durable save: ${name}`);
}

function card(name) { return page.locator('.library-card').filter({ has: page.getByRole('heading', { name, exact: true }) }); }

async function library() {
  const toolbar = page.locator('.studio-toolbar');
  const navigation = await toolbar.isVisible() ? toolbar : page.locator('.studio-project-bar');
  await navigation.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
}

async function create(name, { template = false } = {}) {
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  if (template) await dialog.getByRole('button', { name: /Reusable template/ }).click();
  await dialog.getByRole('button', { name: template ? 'Create template' : 'Create landing', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.browser-frame iframe').waitFor();
  return waitForSaved(name);
}

async function sourceExport() {
  await page.getByRole('button', { name: 'Export project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download project', exact: true });
  await dialog.getByRole('combobox').selectOption('source');
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /source\.zip$/);
  return unzipSync(new Uint8Array(await readFile(await download.path())));
}

async function assertNoOverflow(label) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(sizes.document <= sizes.width + 1 && sizes.body <= sizes.width + 1, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
}

async function captureLibrary(path) {
  // Chrome does not paint offscreen iframe surfaces for full-page captures.
  // Expand only viewport height so the responsive width stays under test.
  const viewport = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height });
  for (const thumbnail of await page.locator('.library-thumbnail').all()) {
    await thumbnail.scrollIntoViewIfNeeded();
    await thumbnail.frameLocator('iframe').getByRole('heading', { level: 1 }).waitFor();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path });
  await page.setViewportSize(viewport);
}

try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'allow' });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  assert.equal(await page.locator('.starter-grid .library-card').count(), 3);

  await page.getByRole('button', { name: /Start from scratch/ }).click();
  const blank = await create('Blank draft');
  assert.equal(blank.kind, 'landing');
  assert.ok(Object.hasOwn(blank.files, 'index.tpl'));
  await page.reload();
  await page.getByRole('heading', { name: 'Blank draft', exact: true }).waitFor();
  await library();
  console.log('PASS: blank creation and active-project restore.');

  await page.getByRole('button', { name: 'Use Product spotlight', exact: true }).click();
  await create('Browser template', { template: true });
  await page.getByLabel('Headline', { exact: false }).fill('Template baseline');
  const template = await waitForSaved('Browser template', { headline: 'Template baseline' });
  assert.equal(template.kind, 'template');
  await library();
  await card('Browser template').getByRole('button', { name: 'Use template', exact: true }).click();
  const landing = await create('Independent landing');
  assert.equal(landing.sourceTemplateId, template.id);
  assert.notEqual(landing.id, template.id);
  assert.equal(await page.getByLabel('Headline', { exact: false }).inputValue(), 'Template baseline');
  await page.getByLabel('Headline', { exact: false }).fill('Landing-only headline');
  await waitForSaved('Independent landing', { headline: 'Landing-only headline' });
  assert.equal((await readRecords()).find(item => item.id === template.id).settings.headline, 'Template baseline');

  await page.getByRole('button', { name: 'Save as template', exact: true }).click();
  const saveTemplate = page.getByRole('dialog', { name: 'Save as template', exact: true });
  await saveTemplate.getByLabel('Template name', { exact: true }).fill('Saved landing template');
  await saveTemplate.getByRole('button', { name: 'Save as template', exact: true }).click();
  await saveTemplate.waitFor({ state: 'hidden' });
  const copied = await waitForSaved('Saved landing template', { headline: 'Landing-only headline' });
  assert.equal(copied.kind, 'template');
  assert.notEqual(copied.id, landing.id);
  assert.equal((await readRecords()).find(item => item.id === landing.id).kind, 'landing');
  await page.reload();
  await page.getByLabel('Headline', { exact: false }).waitFor();
  await page.waitForFunction(() => document.querySelector('#setting-headline')?.value === 'Landing-only headline');
  assert.equal(await page.getByLabel('Headline', { exact: false }).inputValue(), 'Landing-only headline');
  const archive = await sourceExport();
  assert.ok(archive['index.tpl']);
  assert.equal(JSON.parse(strFromU8(archive['.trafficops/values.json'])).headline, 'Landing-only headline');
  await library();
  console.log('PASS: built-in template, independent landing, autosave, save as template, persisted fields and source ZIP.');

  await card('Independent landing').getByRole('button', { name: 'Duplicate Independent landing', exact: true }).click();
  await card('Independent landing (copy)').waitFor();
  const duplicate = await waitForSaved('Independent landing (copy)', { headline: 'Landing-only headline' });
  assert.notEqual(duplicate.id, landing.id);
  page.once('dialog', dialog => dialog.accept());
  await card('Independent landing (copy)').getByRole('button', { name: 'Delete Independent landing (copy)', exact: true }).click();
  await card('Independent landing (copy)').waitFor({ state: 'hidden' });
  assert.equal((await readRecords()).some(item => item.id === duplicate.id), false);
  await page.getByLabel('Search projects', { exact: true }).fill('Independent landing');
  assert.equal(await page.locator('.library-grid:not(.starter-grid) .library-card').count(), 1);
  await page.getByLabel('Search projects', { exact: true }).fill('');
  await page.getByRole('group', { name: 'Project filter', exact: true }).getByRole('button', { name: /^Templates/ }).click();
  assert.equal(await page.locator('.library-grid:not(.starter-grid) .library-card').count(), 2);
  await page.getByRole('group', { name: 'Project filter', exact: true }).getByRole('button', { name: /^All projects/ }).click();
  await captureLibrary('/tmp/studio-library-desktop.png');
  await assertNoOverflow('desktop library');

  await page.setViewportSize({ width: 390, height: 844 });
  await captureLibrary('/tmp/studio-library-mobile.png');
  await assertNoOverflow('mobile library');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('dialog', { name: 'New project', exact: true }).waitFor();
  await assertNoOverflow('mobile creation dialog');
  await page.getByRole('button', { name: 'Close new project', exact: true }).click();
  console.log('PASS: duplicate/delete, search, project filters and mobile library/creation layout.');

  // Headless Chrome has no operating-system install UI; emulate the installed
  // display-mode signal while exercising a real production service worker.
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true }));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.locator('.studio.installed-app .library').waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.getByText('Offline · local editing available', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open Independent landing', exact: true }).click();
  await page.locator('.editor-shell.is-expanded').waitFor();
  await page.locator('.file-sidebar button[title="styles.css"]').click();
  const code = page.getByRole('textbox', { name: 'Source code for styles.css', exact: true });
  await code.waitFor();
  await code.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.insertText('\n/* edited while offline */\n');
  await waitForSaved('Independent landing', { cssIncludes: 'edited while offline' });
  const afterOfflineEdit = await readRecords();
  assert.equal(afterOfflineEdit.find(item => item.id === template.id).files['styles.css'].includes('edited while offline'), false);
  assert.equal(afterOfflineEdit.find(item => item.id === copied.id).files['styles.css'].includes('edited while offline'), false);
  const offlineArchive = await sourceExport();
  assert.match(strFromU8(offlineArchive['styles.css']), /edited while offline/);
  assert.equal(JSON.parse(strFromU8(offlineArchive['.trafficops/values.json'])).headline, 'Landing-only headline');
  await page.reload();
  await page.locator('.editor-shell.is-expanded').waitFor();
  assert.match((await waitForSaved('Independent landing')).files['styles.css'], /edited while offline/);
  assert.deepEqual(errors, []);
  console.log('PASS: installed display mode, real service-worker offline reload, offline Monaco editing/autosave and source ZIP export.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: '/tmp/studio-library-failure.png', fullPage: true }).catch(() => {});
    console.error('Saved records:', (await readRecords().catch(() => [])).map(({ name, revision, settings }) => ({ name, revision, settings })));
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 7000));
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
