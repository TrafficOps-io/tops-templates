import { moreMenuItem } from './support/studio-chat.js';
// The project library on folder storage: every create, duplicate and Save as template picks a real OPFS folder through
// the user-activation-gated picker (support/studio-folders.js), and the checks read the folders themselves.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { editorReady, installFolderPicker, listOpfs, readOpfs, until, usePicker } from './support/studio-folders.js';

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

// A project folder under picker/<folder>: { meta, values, files: { path: text } } once project.json exists, else null.
async function readProject(folder) {
  const meta = await readOpfs(page, `picker/${folder}/.trafficops/project.json`);
  if (!meta) return null;
  const files = {};
  for (const name of await listOpfs(page, `picker/${folder}`) || []) if (/\.(tpl|css|html|js)$/.test(name)) files[name] = await readOpfs(page, `picker/${folder}/${name}`);
  return { meta: JSON.parse(meta), values: JSON.parse(await readOpfs(page, `picker/${folder}/.trafficops/values.json`) || '{}'), files };
}
async function waitForSaved(folder, { headline, cssIncludes } = {}) {
  let project;
  await until(async () => {
    project = await readProject(folder);
    return project && (headline === undefined || project.values.headline === headline) && (cssIncludes === undefined || project.files['styles.css']?.includes(cssIncludes));
  }, `durable save in ${folder}`, 20000);
  return project;
}

// The editor opens on the assistant when AI is available; field checks use the Content form.
const contentTab = () => page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
function card(name) { return page.locator('.library-card').filter({ has: page.getByRole('heading', { name, exact: true }) }); }

async function library() {
  const toolbar = page.locator('.studio-toolbar');
  const navigation = await toolbar.isVisible() ? toolbar : page.locator('.studio-project-bar');
  await navigation.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.locator('.library').waitFor();
}

// Fills the open New project dialog; Create opens the picker, which returns picker/<folder>.
async function create(name, folder, { template = false, mode } = {}) {
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  if (mode) await dialog.getByRole('button', { name: mode, exact: true }).click();
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  if (template) { await dialog.getByText('Project options', { exact: true }).click(); await dialog.getByRole('button', { name: /Reusable template/ }).click(); }
  await usePicker(page, folder);
  await dialog.getByRole('button', { name: template ? 'Create template' : 'Create landing', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await editorReady(page);
  await contentTab();
  return waitForSaved(folder);
}

async function sourceExport() {
  // Browser tabs and the installed app share one workspace: export starts from the toolbar's Export menu.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: /Editable project/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
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
  for (const thumbnail of await page.locator('.library-thumbnail:visible').all()) {
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
  await installFolderPicker(context);
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [], confirms = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { confirms.push(dialog.message()); dialog.accept(); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.library').getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  assert.equal(await page.locator('.starter-grid .library-card').count(), 3);

  await page.locator('.library-heading').getByRole('button', { name: 'New project', exact: true }).click();
  const blank = await create('Blank draft', 'blank-draft', { mode: 'From scratch' });
  assert.equal(blank.meta.kind, 'landing');
  assert.ok(Object.hasOwn(blank.files, 'index.tpl'));
  await page.reload();
  await page.locator('.studio-toolbar').getByRole('heading', { name: 'Blank draft', exact: true }).waitFor();
  await library();
  console.log('PASS: blank creation into a picked folder and last-project restore.');

  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Use Product spotlight', exact: true }).click();
  await create('Browser template', 'browser-template', { template: true });
  await page.getByLabel('Headline', { exact: false }).fill('Template baseline');
  const template = await waitForSaved('browser-template', { headline: 'Template baseline' });
  assert.equal(template.meta.kind, 'template');
  await library();
  // A user template: its card click reads it (D2); Create then picks the landing's folder.
  await card('Browser template').getByRole('button', { name: 'Project actions: Browser template', exact: true }).click();
  await card('Browser template').getByRole('menuitem', { name: 'Use template', exact: true }).click();
  const landing = await create('Independent landing', 'independent-landing');
  assert.equal(landing.meta.sourceTemplateId, template.meta.projectId);
  assert.notEqual(landing.meta.projectId, template.meta.projectId);
  assert.equal(await page.getByLabel('Headline', { exact: false }).inputValue(), 'Template baseline');
  await page.getByLabel('Headline', { exact: false }).fill('Landing-only headline');
  // Between the edit and the durable write the toolbar badge reads Saving… (the workspace's single live save region).
  await page.locator('.studio-toolbar [role="status"]').filter({ hasText: 'Saving…' }).waitFor();
  await waitForSaved('independent-landing', { headline: 'Landing-only headline' });
  // Save state is text: a badge with the save time, shown once per mode; the sidebar footer keeps the storage label only.
  assert.equal(await page.locator('.sidebar-footer [role="status"]').count(), 0);
  await page.locator('.studio-toolbar [role="status"]').filter({ hasText: /^Saved \d{1,2}:\d{2}/ }).waitFor();
  assert.equal(await page.locator('.studio-statusbar-save:visible').filter({ hasText: /Saved \d{1,2}:\d{2}/ }).count(), 0, 'the status bar does not repeat the save status');
  assert.equal(await page.locator('[role="status"]:visible').filter({ hasText: /^Saved \d{1,2}:\d{2}/ }).count(), 1, 'one live save region');
  assert.equal(await page.locator('.editor-shell.is-app').getByText(/^Saved \d{1,2}:\d{2}/).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length > 0).length), 1, 'the workspace shows the save status once');
  assert.equal((await readProject('browser-template')).values.headline, 'Template baseline');

  // Save as template (D4): the dialog's submit picks the template's folder.
  await (await moreMenuItem(page, 'Save as template')).click();
  const saveTemplate = page.getByRole('dialog', { name: 'Save as template', exact: true });
  await saveTemplate.getByLabel('Template name', { exact: true }).fill('Saved landing template');
  await usePicker(page, 'saved-landing-template');
  await saveTemplate.getByRole('button', { name: 'Save as template', exact: true }).click();
  await saveTemplate.waitFor({ state: 'hidden' });
  const copied = await waitForSaved('saved-landing-template', { headline: 'Landing-only headline' });
  assert.equal(copied.meta.kind, 'template');
  assert.equal(copied.meta.name, 'Saved landing template');
  assert.notEqual(copied.meta.projectId, landing.meta.projectId);
  assert.equal((await readProject('independent-landing')).meta.kind, 'landing');
  await page.reload();
  await editorReady(page); await contentTab();
  await page.getByLabel('Headline', { exact: false }).waitFor();
  await page.waitForFunction(() => document.querySelector('#setting-headline')?.value === 'Landing-only headline');
  assert.equal(await page.getByLabel('Headline', { exact: false }).inputValue(), 'Landing-only headline');
  const archive = await sourceExport();
  assert.ok(archive['index.tpl']);
  assert.equal(JSON.parse(strFromU8(archive['.trafficops/values.json'])).headline, 'Landing-only headline');
  await library();
  console.log('PASS: built-in template, independent landing from a user template, autosave, save as template, persisted fields and source ZIP.');

  await usePicker(page, 'independent-landing-copy');
  await card('Independent landing').getByRole('button', { name: 'Project actions: Independent landing', exact: true }).click();
  await card('Independent landing').getByRole('menuitem', { name: 'Duplicate Independent landing', exact: true }).click();
  await card('Independent landing (copy)').waitFor();
  const duplicate = await waitForSaved('independent-landing-copy', { headline: 'Landing-only headline' });
  assert.notEqual(duplicate.meta.projectId, landing.meta.projectId);
  assert.equal(duplicate.meta.name, 'Independent landing (copy)');
  // Delete (folder): only the list entry goes; the folder stays on disk.
  await card('Independent landing (copy)').getByRole('button', { name: 'Project actions: Independent landing (copy)', exact: true }).click();
  await card('Independent landing (copy)').getByRole('menuitem', { name: 'Delete Independent landing (copy)', exact: true }).click();
  await card('Independent landing (copy)').waitFor({ state: 'hidden' });
  assert.match(confirms.at(-1), /^Remove “Independent landing \(copy\)” from Studio\? The folder stays on your disk\./);
  assert.equal((await readProject('independent-landing-copy')).meta.projectId, duplicate.meta.projectId, 'the folder stays on disk');
  await page.getByLabel('Search projects', { exact: true }).fill('Independent landing');
  assert.equal(await page.locator('.library-project-list .library-card').count(), 1);
  await page.getByLabel('Search projects', { exact: true }).fill('');
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('template');
  assert.equal(await page.locator('.library-project-list .library-card').count(), 2);
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).selectOption('all');
  await captureLibrary('/tmp/studio-library-desktop.png');
  await assertNoOverflow('desktop library');

  await page.setViewportSize({ width: 390, height: 844 });
  await captureLibrary('/tmp/studio-library-mobile.png');
  await assertNoOverflow('mobile library');
  await page.locator('.library-heading').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('dialog', { name: 'New project', exact: true }).waitFor();
  await assertNoOverflow('mobile creation dialog');
  await page.getByRole('button', { name: 'Close new project', exact: true }).click();
  console.log('PASS: duplicate into a picked folder, delete keeps the folder, search, project filters and mobile library/creation layout.');

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
  await page.locator('.editor-shell.is-app').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Collapse editor', exact: true }).count(), 0);
  await page.locator('.file-sidebar button[title="styles.css"]').click();
  const code = page.getByRole('textbox', { name: 'Source code for styles.css', exact: true });
  // Without word wrap Monaco's hidden input has zero width, so wait for it to attach rather than to be visible.
  await code.waitFor({ state: 'attached' });
  await code.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.insertText('\n/* edited while offline */\n');
  await waitForSaved('independent-landing', { cssIncludes: 'edited while offline' });
  assert.equal((await readProject('browser-template')).files['styles.css'].includes('edited while offline'), false);
  assert.equal((await readProject('saved-landing-template')).files['styles.css'].includes('edited while offline'), false);
  const offlineArchive = await sourceExport();
  assert.match(strFromU8(offlineArchive['styles.css']), /edited while offline/);
  assert.equal(JSON.parse(strFromU8(offlineArchive['.trafficops/values.json'])).headline, 'Landing-only headline');
  await page.reload();
  await page.locator('.editor-shell.is-app').waitFor();
  assert.match((await waitForSaved('independent-landing')).files['styles.css'], /edited while offline/);
  assert.deepEqual(errors, []);
  console.log('PASS: installed display mode, real service-worker offline reload, offline Monaco editing/autosave into the folder and source ZIP export.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: '/tmp/studio-library-failure.png', fullPage: true }).catch(() => {});
    console.error('Picker folders:', await listOpfs(page, 'picker').catch(() => null));
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 7000));
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
