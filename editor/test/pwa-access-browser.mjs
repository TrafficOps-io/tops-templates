import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { starterProject } from '../src/starter.js';

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

async function openPage(installed = false, displayMode = null) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const result = await context.newPage(); page = result;
  result.on('pageerror', error => errors.push(error.message));
  await result.exposeFunction('capturePwaProviderCall', value => providerCalls.push(value));
  await result.addInitScript(({ installed, displayMode }) => {
    if (displayMode) {
      const realMatchMedia = window.matchMedia.bind(window), queries = new Map();
      let currentMode = displayMode;
      window.matchMedia = query => {
        const mode = /^\(display-mode: (.+)\)$/.exec(query)?.[1];
        if (!mode) return realMatchMedia(query);
        if (!queries.has(query)) {
          const media = new EventTarget();
          Object.defineProperties(media, { media: { value: query }, matches: { get: () => mode === currentMode } });
          media.addListener = callback => media.addEventListener('change', callback);
          media.removeListener = callback => media.removeEventListener('change', callback);
          queries.set(query, media);
        }
        return queries.get(query);
      };
      window.setTestDisplayMode = nextMode => {
        const previous = new Map([...queries].map(([query, media]) => [query, media.matches]));
        currentMode = nextMode;
        for (const [query, media] of queries) {
          if (media.matches === previous.get(query)) continue;
          const event = new Event('change');
          Object.defineProperties(event, { media: { value: query }, matches: { value: media.matches } });
          media.dispatchEvent(event);
        }
      };
    }
    if (installed) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.pwaAccessTest = { directoryStoreReads: 0, handleCalls: 0, pickerCalls: 0 };
    window.showDirectoryPicker = async () => {
      window.pwaAccessTest.pickerCalls++;
      throw new DOMException('Test dismissed the picker.', 'AbortError');
    };
    const originalGetAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      const request = originalGetAll.apply(this, args);
      if (this.name === 'directory-projects') {
        window.pwaAccessTest.directoryStoreReads++;
        request.addEventListener('success', () => {
          const result = request.result.map(project => ({ ...project, handle: {
            kind: 'directory', name: project.name,
            async queryPermission() { window.pwaAccessTest.handleCalls++; return 'granted'; },
            async requestPermission() { window.pwaAccessTest.handleCalls++; return 'granted'; },
            async *values() { window.pwaAccessTest.handleCalls++; throw new Error('Browser tab must never read a saved folder.'); },
            async getDirectoryHandle() { window.pwaAccessTest.handleCalls++; throw new Error('Browser tab must never read a saved folder.'); },
          } }));
          Object.defineProperty(request, 'result', { value: result });
        });
      }
      return request;
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const target = input instanceof Request ? input.url : String(input);
      if (!target.includes('openrouter.ai/api/v1/')) return realFetch(input, options);
      await window.capturePwaProviderCall(target);
      return Response.json({ error: { message: 'Provider calls are forbidden in this access regression.' } }, { status: 503 });
    };
  }, { installed, displayMode });
  await result.goto(url);
  await result.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  return result;
}

async function assertNoPrivilegedControls(page, expectedAccess = { directoryStoreReads: 0, handleCalls: 0, pickerCalls: 0 }) {
  for (const name of ['AI assistant']) assert.equal(await page.getByRole('tab', { name, exact: true }).count(), 0);
  for (const name of ['With AI', 'AI connection settings', 'Generate image with AI', 'Open folder', 'Folders', 'Manage project folders', 'Add project folder', 'Reconnect folder']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `${name} is PWA-only`);
  }
  assert.equal(await page.getByRole('button', { name: /^Create with AI/ }).count(), 0);
  assert.equal(await page.locator('.ai-prompt, .ai-settings, .image-ai-form').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.pwaAccessTest), expectedAccess);
  assert.equal(providerCalls.length, 0);
}

async function createStarter(page, name) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create landing', exact: true }).click();
  await page.locator('.browser-frame iframe').waitFor();
}

async function seedPendingWork(page) {
  return page.evaluate(async files => {
    const put = (databaseName, storeName, value, key, stores) => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        for (const [name, keyPath] of stores) request.result.createObjectStore(name, keyPath ? { keyPath } : undefined);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(storeName, 'readwrite');
        if (key === undefined) transaction.objectStore(storeName).put(value);
        else transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
    const libraryStores = [['projects', 'id'], ['preferences']];
    await put('trafficops-studio-library', 'projects', { id: 'pending-pwa-ai', kind: 'landing', name: 'Pending PWA AI', revision: 1, files, folders: ['images'], settings: {}, aiPrompt: 'Generate a new page only when explicitly requested in the PWA.', aiStarted: false, createdAt: Date.now(), updatedAt: Date.now() }, undefined, libraryStores);
    await put('trafficops-studio-library', 'preferences', 'pending-pwa-ai', 'active-project', libraryStores);
    await put('trafficops-template-studio-ai', 'settings', { id: 'openrouter', apiKey: 'mock-key-must-never-be-sent', model: 'test/model', imageModel: 'test/image' }, undefined, [['settings', 'id']]);
    const workspace = { projectId: 'saved-pwa-folder', name: 'Saved PWA folder', files, folders: ['images'], overrides: { headline: 'Keep my folder recovery' }, sourceBaseline: files, dirty: true };
    await put('trafficops-template-studio', 'directory-projects', { id: workspace.projectId, name: workspace.name, handle: { kind: 'directory', name: workspace.name }, lastOpenedAt: Date.now(), displayPath: '' }, undefined, [['directory-projects', 'id']]);
    await put('trafficops-landing-workspace', 'workspace', workspace, 'last', [['workspace']]);
    return workspace;
  }, starterProject());
}
async function readRecord(page, databaseName, storeName, key) {
  return page.evaluate(({ databaseName, storeName, key }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction(storeName);
      const record = transaction.objectStore(storeName).get(key);
      transaction.oncomplete = () => { database.close(); resolve(record.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), { databaseName, storeName, key });
}

try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const tab = await openPage();
  await assertNoPrivilegedControls(tab);
  await tab.getByRole('button', { name: 'New project', exact: true }).click();
  await assertNoPrivilegedControls(tab);
  await tab.getByRole('button', { name: 'Close new project', exact: true }).click();
  await createStarter(tab, 'Browser editor');
  await tab.getByRole('button', { name: 'Your message', exact: true }).click();
  await tab.getByLabel('Image path', { exact: false }).waitFor();
  await assertNoPrivilegedControls(tab);

  const expectedWorkspace = await seedPendingWork(tab);
  await tab.reload();
  await tab.getByRole('heading', { name: 'Pending PWA AI', exact: true }).waitFor();
  await assertNoPrivilegedControls(tab);
  const pending = await readRecord(tab, 'trafficops-studio-library', 'projects', 'pending-pwa-ai');
  assert.equal(pending.aiStarted, false); assert.equal(pending.revision, 1);
  assert.deepEqual(await readRecord(tab, 'trafficops-landing-workspace', 'workspace', 'last'), expectedWorkspace);

  await tab.getByRole('button', { name: 'Library', exact: true }).first().click();
  await tab.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  assert.deepEqual(await readRecord(tab, 'trafficops-landing-workspace', 'workspace', 'last'), expectedWorkspace);
  await createStarter(tab, 'Another browser draft');
  assert.deepEqual(await readRecord(tab, 'trafficops-landing-workspace', 'workspace', 'last'), expectedWorkspace);
  await tab.getByRole('button', { name: 'Library', exact: true }).first().click();
  await tab.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await tab.reload();
  await tab.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await assertNoPrivilegedControls(tab);
  assert.deepEqual(await readRecord(tab, 'trafficops-landing-workspace', 'workspace', 'last'), expectedWorkspace);

  // Neither appinstalled (while still in a tab) nor real browser fullscreen is an installed launch.
  await tab.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await assertNoPrivilegedControls(tab);
  await tab.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Test browser fullscreen';
    button.onclick = () => document.documentElement.requestFullscreen(); document.body.append(button);
  });
  await tab.getByRole('button', { name: 'Test browser fullscreen', exact: true }).click();
  await tab.waitForFunction(() => Boolean(document.fullscreenElement));
  // Headless Chrome may enter DOM fullscreen without changing its display-mode
  // media query. Also exercise a fullscreen-only browser display explicitly.
  await tab.evaluate(() => {
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: fullscreen)' ? { ...realMatchMedia(query), matches: true } : realMatchMedia(query);
    window.dispatchEvent(new Event('appinstalled'));
  });
  await assertNoPrivilegedControls(tab);
  assert.equal(await tab.locator('.installed-app').count(), 0);
  await tab.evaluate(() => document.exitFullscreen());
  console.log('PASS: ordinary tab and ?studio=1 omit AI/image/settings/folder controls; persisted key and brief cannot start AI; folder handles and recovery stay untouched; fullscreen and appinstalled do not unlock access.');

  const pwa = await openPage(true);
  await pwa.getByRole('button', { name: /^Create with AI/ }).waitFor();
  await pwa.getByRole('button', { name: 'Open folder', exact: true }).click();
  assert.equal(await pwa.evaluate(() => window.pwaAccessTest.pickerCalls), 1);
  await pwa.getByRole('button', { name: 'New project', exact: true }).click();
  await pwa.getByRole('button', { name: 'With AI', exact: true }).waitFor();
  await pwa.getByRole('button', { name: 'Close new project', exact: true }).click();
  await createStarter(pwa, 'Installed PWA editor');
  await pwa.getByRole('button', { name: 'Your message', exact: true }).click();
  await pwa.getByRole('button', { name: 'Generate image with AI', exact: true }).waitFor();
  await pwa.getByRole('button', { name: 'Manage project folders', exact: true }).waitFor();
  await pwa.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await pwa.getByRole('button', { name: 'AI connection settings', exact: true }).click();
  await pwa.locator('.ai-settings input[type=password]').waitFor();
  assert.deepEqual(errors, []);
  assert.equal(providerCalls.length, 0);
  console.log('PASS: installed-PWA display mode exposes AI creation, assistant, image generation, connection settings and explicit folder picker.');


  // A confirmed standalone window retains access in fullscreen, then loses it
  // permanently on returning to browser mode until a new installed mode appears.
  const transitions = await openPage(false, 'standalone');
  await transitions.getByRole('button', { name: /^Create with AI/ }).waitFor();
  await createStarter(transitions, 'Display mode transitions');
  await transitions.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await transitions.getByRole('button', { name: 'AI connection settings', exact: true }).click();
  await transitions.locator('.ai-settings input[type=password]').waitFor();
  await transitions.evaluate(() => window.setTestDisplayMode('fullscreen'));
  await transitions.getByRole('tab', { name: 'AI assistant', exact: true }).waitFor();
  assert.equal(await transitions.locator('.installed-app').count(), 1);
  await transitions.locator('.ai-settings input[type=password]').waitFor();
  await transitions.getByRole('button', { name: 'Manage project folders', exact: true }).click();
  await transitions.getByRole('button', { name: 'Add project folder', exact: true }).click();
  assert.equal(await transitions.evaluate(() => window.pwaAccessTest.pickerCalls), 1);
  await transitions.getByRole('dialog', { name: 'Project folders', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  const beforeRevocation = await transitions.evaluate(() => ({ ...window.pwaAccessTest }));
  await transitions.evaluate(() => window.setTestDisplayMode('browser'));
  await transitions.locator('.installed-app').waitFor({ state: 'detached' });
  await assertNoPrivilegedControls(transitions, beforeRevocation);
  await transitions.evaluate(() => window.setTestDisplayMode('fullscreen'));
  await assertNoPrivilegedControls(transitions, beforeRevocation);
  assert.equal(await transitions.locator('.installed-app').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: standalone → fullscreen retains AI settings and folder picker; browser mode revokes access; later fullscreen from browser cannot restore it.');
} catch (error) {
  await page?.screenshot({ path: '/tmp/studio-pwa-access-failure.png', fullPage: true }).catch(() => {});
  console.error((await page?.locator('body').innerText().catch(() => '')).slice(0, 5000));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
