import { revealConversationTab } from './support/studio-chat.js';
// Storage and AI access by browser capability (folder-first): a plain tab offers AI and project folders (D7); a browser
// without the folder picker stores projects in OPFS (D9); one without OPFS either gets the unsupported screen. The
// installed presentation keeps its one-line header. A stored AI key never makes a provider call without a request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { editorReady, installFolderPicker, listOpfs, metaOf, usePicker } from './support/studio-folders.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/?studio=1`;
let browser, page;
const errors = [], providerCalls = [];

// storage: 'folder' (picker installed), 'opfs' (picker removed) or 'none' (picker and OPFS removed).
async function openPage({ storage = 'folder', installed = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  if (storage === 'folder') await installFolderPicker(context);
  else await context.addInitScript(storage => {
    delete window.showDirectoryPicker;
    if (storage === 'none') Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined });
  }, storage);
  if (installed) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await context.route('https://openrouter.ai/**', route => { providerCalls.push(route.request().url()); return route.fulfill({ status: 503, json: { error: { message: 'Provider calls are forbidden in this access regression.' } } }); });
  const result = page = await context.newPage();
  result.on('pageerror', error => errors.push(error.message));
  await result.goto(url);
  return result;
}
// A stored key and model: their presence alone must never reach the provider.
const configureAi = target => target.evaluate(async () => {
  const db = await new Promise((done, reject) => { const request = indexedDB.open('trafficops-template-studio-ai', 1); request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'id' }); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  await new Promise((done, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-key-must-never-be-sent', model: 'test/model', imageModel: 'test/image' }); tx.oncomplete = done; tx.onerror = () => reject(tx.error); }); db.close();
  window.dispatchEvent(new Event('trafficops-ai-settings'));
});
async function createStarter(target, name) {
  await target.getByRole('button', { name: 'New project', exact: true }).first().click();
  const dialog = target.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByRole('button', { name: 'From template', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create landing', exact: true }).click();
  await editorReady(target);
  await target.getByRole('tab', { name: 'Content', exact: true }).click();
}
// AI settings: a header button when the chat is wide, else the chat header's More actions menu.
async function openAiSettings(target) {
  const chat = target.locator('[data-testid="studio-chat"]'); await chat.waitFor();
  const direct = target.getByRole('button', { name: 'AI settings', exact: true });
  if (await direct.count()) await direct.first().click();
  else { await chat.locator('.studio-chat-header').getByRole('button', { name: 'More actions', exact: true }).click(); await chat.getByRole('menuitem', { name: 'AI settings', exact: true }).click(); }
  await target.locator('.ai-settings input[type=password]').waitFor();
}
async function assertAiAndFolders(target) {
  await target.getByRole('tab', { name: 'Conversations', exact: true }).waitFor();
  await target.locator('.home-project-chat, .editor-shell').first().waitFor();
}

try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

  // A plain tab: the home AI composer, "With AI", Open folder (the picker) and the AI tools in the editor.
  const tab = await openPage();
  await configureAi(tab);
  await tab.locator('.library').waitFor();
  assert.equal(await tab.locator('.installed-app').count(), 0, 'a plain tab is not the installed app');
  await tab.getByRole('button', { name: 'New project', exact: true }).first().click();
  await tab.getByRole('dialog', { name: 'New project', exact: true }).getByRole('button', { name: 'With AI', exact: true }).waitFor();
  await tab.getByRole('button', { name: 'Close new project', exact: true }).click();
  await usePicker(tab, '!abort');
  await tab.getByRole('button', { name: 'Open folder', exact: true }).click();
  await tab.waitForFunction(() => window.__pickerCalls === 1);
  assert.equal(await tab.getByRole('alert').count(), 0, 'a cancelled picker is not an error');
  await usePicker(tab, 'browser-editor');
  await createStarter(tab, 'Browser editor');
  assert.equal((await metaOf(tab, 'picker/browser-editor')).name, 'Browser editor', 'the project lands in the picked folder');
  assert.equal((await listOpfs(tab, 'projects'))?.length ?? 0, 0, 'folder mode creates no OPFS roots');
  await tab.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Your message', exact: true }).click();
  await tab.getByRole('button', { name: 'Generate image with AI', exact: true }).waitFor();
  await assertAiAndFolders(tab);
  await revealConversationTab(tab.locator('[data-testid=\"studio-chat\"]'));
  await openAiSettings(tab);
  await tab.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  // Neither appinstalled (while still in a tab) nor browser fullscreen changes the tab's presentation or access.
  await tab.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await tab.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Test browser fullscreen';
    button.onclick = () => document.documentElement.requestFullscreen(); document.body.append(button);
  });
  await tab.getByRole('button', { name: 'Test browser fullscreen', exact: true }).click();
  await tab.waitForFunction(() => Boolean(document.fullscreenElement));
  await tab.evaluate(() => {
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: fullscreen)' ? { ...realMatchMedia(query), matches: true } : realMatchMedia(query);
    window.dispatchEvent(new Event('appinstalled'));
  });
  assert.equal(await tab.locator('.installed-app').count(), 0, 'fullscreen and appinstalled do not make a tab the installed app');
  await assertAiAndFolders(tab);
  await tab.evaluate(() => document.exitFullscreen());
  // Reload: the project reopens from its folder; a stored key still starts nothing.
  await tab.reload();
  await editorReady(tab);
  await tab.getByText('Folder: browser-editor').first().waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(providerCalls, [], 'a stored key never reaches the provider without a request');
  console.log('PASS: plain tab offers the home AI composer, With AI, Open folder (picker), image generation and AI settings; projects save to the picked folder; fullscreen/appinstalled change nothing; no provider calls.');
  await tab.context().close();

  // The installed presentation: its header stays on one line at 1280 px, with one save-status live region shown once.
  const pwa = await openPage({ installed: true });
  await pwa.locator('.library').waitFor();
  await usePicker(pwa, 'installed-editor');
  await createStarter(pwa, 'Installed PWA editor');
  await pwa.locator('.editor-shell.is-app').waitFor();
  await pwa.setViewportSize({ width: 1280, height: 900 });
  await pwa.waitForFunction(() => document.querySelector('.studio-toolbar')?.getBoundingClientRect().width <= 1280);
  const header = await pwa.evaluate(() => {
    const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const toolbar = document.querySelector('.studio-toolbar'), navigation = toolbar.querySelector('.studio-navigation');
    const lines = new Set([...navigation.children, ...toolbar.querySelector('.studio-toolbar-actions').children].filter(visible).map(element => Math.round(element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2)));
    const regions = [...document.querySelectorAll('.editor-shell [role="status"]')].filter(visible).filter(element => element.querySelector('.studio-badge'));
    const text = regions[0]?.textContent.trim();
    const shown = [...document.querySelectorAll('.editor-shell *')].filter(element => visible(element) && element.textContent.trim() === text && ![...element.children].some(child => child.textContent.trim() === text));
    return { lines: lines.size, height: Math.round(toolbar.getBoundingClientRect().height), regions: regions.length, text, shown: shown.length, storage: [...toolbar.querySelectorAll('.studio-toolbar-storage')].filter(visible).map(element => element.textContent) };
  });
  assert.equal(header.lines, 1, `installed header on one line at 1280: ${JSON.stringify(header)}`);
  assert.ok(header.height <= 72, `installed header height: ${JSON.stringify(header)}`);
  assert.equal(header.regions, 1, `one save-status live region: ${JSON.stringify(header)}`);
  assert.equal(header.shown, 1, `save status shown once: ${JSON.stringify(header)}`);
  // The toolbar storage label names the location only ("Folder: <name>"); it never repeats the save status.
  assert.deepEqual(header.storage, [], `one location label: ${JSON.stringify(header)}`);
  assert.ok(header.storage.every(text => !/saved|stored/i.test(text) && !text.includes(header.text)), `no storage text repeating the status: ${JSON.stringify(header)}`);
  await pwa.setViewportSize({ width: 1600, height: 1100 });
  await pwa.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Your message', exact: true }).click();
  await pwa.getByRole('button', { name: 'Generate image with AI', exact: true }).waitFor();
  assert.equal(await pwa.getByRole('button', { name: 'Save to folder', exact: true }).count(), 0, 'every project already lives in a folder');
  await revealConversationTab(pwa.locator('[data-testid=\"studio-chat\"]'));
  await openAiSettings(pwa);
  assert.deepEqual(errors, []);
  assert.deepEqual(providerCalls, []);
  console.log('PASS: installed presentation keeps a one-line header at 1280 px with one save status, image generation and AI settings.');
  await pwa.context().close();

  // No folder picker (Safari, Firefox): projects live in OPFS projects/ with a backup note; Open folder is not offered.
  const opfs = await openPage({ storage: 'opfs' });
  await opfs.getByText('Stored in this browser — export a backup ZIP regularly', { exact: false }).first().waitFor();
  await opfs.locator('.library').waitFor();
  assert.equal(await opfs.getByRole('button', { name: 'Open folder', exact: true }).count(), 0);
  await createStarter(opfs, 'Browser storage project');
  assert.equal(await opfs.locator('.studio-toolbar-status').getAttribute('title'), 'Stored in this browser — export a backup ZIP regularly. Clearing site data removes this project.');
  const roots = await listOpfs(opfs, 'projects');
  assert.equal(roots.length, 1);
  assert.equal((await metaOf(opfs, `projects/${roots[0]}`)).name, 'Browser storage project');
  assert.equal(await listOpfs(opfs, 'picker'), null, 'no picker folders exist');
  await opfs.getByRole('tab', { name: 'Conversations', exact: true }).waitFor();
  await opfs.reload();
  await editorReady(opfs);
  assert.equal(await opfs.locator('.studio-toolbar-status').getAttribute('title'), 'Stored in this browser — export a backup ZIP regularly. Clearing site data removes this project.');
  console.log('PASS: without the folder picker, projects are stored in OPFS projects/ with the backup note and no Open folder.');
  await opfs.context().close();

  // Neither the picker nor OPFS: the unsupported screen, without the library or AI.
  const bare = await openPage({ storage: 'none' });
  await bare.getByRole('heading', { name: "Studio can't save projects in this browser" }).waitFor();
  assert.equal(await bare.locator('.library, .home-project-chat').count(), 0);
  assert.equal(await bare.getByRole('button', { name: 'New project', exact: true }).count(), 0);
  await bare.context().close();
  assert.deepEqual(errors, []);
  assert.deepEqual(providerCalls, []);
  console.log('PASS: without folder picker and OPFS, Studio shows the unsupported-browser screen.');
} catch (error) {
  await page?.screenshot({ path: '/tmp/studio-storage-access-failure.png', fullPage: true }).catch(() => {});
  console.error((await page?.locator('body').innerText().catch(() => '') || '').slice(0, 5000));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
