// Five real template archives, default connection/preferences, responsive previews and offline PWA creation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { readZipProject } from '@trafficops/template-editor-core';
import { editorReady, installFolderPicker, readOpfs, until, usePicker } from './support/studio-folders.js';

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = resolve(process.argv[2] || 'editor/dist'), screenshots = '/tmp/studio-demo-repository-qa';
await mkdir(screenshots, { recursive: true });
const index = JSON.parse(await readFile(`${root}/template-repositories/demo/index.json`, 'utf8'));
assert.equal(index.templates.length, 5);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`, workspace = `${base}/?studio=1`, key = 'trafficops-template-repositories-v1';
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow' });
  await installFolderPicker(context);
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(workspace);
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  const demo = page.getByRole('region', { name: 'TrafficOps Demo', exact: true });
  await until(async () => await demo.locator('.library-card').count() === 5, 'five default demo templates');
  for (const entry of index.templates) await demo.getByRole('heading', { name: entry.name, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Manage repositories', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Template repositories', exact: true });
  const toggle = settings.getByRole('checkbox', { name: 'Enable TrafficOps Demo', exact: true });
  assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck(); await page.reload();
  assert.equal(await toggle.isChecked(), false);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  assert.equal(await demo.count(), 0);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  assert.equal(await dialog.getByRole('region', { name: 'TrafficOps Demo', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Manage repositories', exact: true }).click();
  await toggle.check();
  await page.getByRole('button', { name: 'Back to new project', exact: true }).click();
  await until(async () => await dialog.getByRole('region', { name: 'TrafficOps Demo', exact: true }).locator('.template-choice').count() === 5, 'demo restored in project picker');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS: five templates appear by default; disabling persists after reload and hides both catalog and picker; re-enabling restores them.');

  for (const entry of index.templates) {
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: `Use ${entry.name}`, exact: true }).click();
    await dialog.waitFor();
    await dialog.getByLabel('Project name', { exact: true }).fill(`Demo copy ${entry.id}`);
    await usePicker(page, entry.id);
    await dialog.getByRole('button', { name: 'Create landing', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); await editorReady(page);
    const zip = readZipProject(new Uint8Array(await readFile(`${root}/template-repositories/demo/${entry.archive}`)));
    for (const [path, content] of Object.entries(zip.files)) assert.equal(await readOpfs(page, `picker/${entry.id}/${path}`), content, `${entry.id}/${path} copied from ZIP`);
    const meta = JSON.parse(await readOpfs(page, `picker/${entry.id}/.trafficops/project.json`));
    assert.equal(meta.name, `Demo copy ${entry.id}`); assert.equal(meta.kind, 'landing');
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
  }
  console.log('PASS: all five ZIPs create independent editable projects with their exact source and local assets.');

  // Inspect the actual published previews at both sizes, not just their thumbnails.
  const preview = await context.newPage();
  for (const entry of index.templates) {
    for (const width of [1280, 390]) {
      await preview.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await preview.goto(`${base}/template-repositories/demo/${entry.preview}`);
      await preview.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${entry.id} fits ${width}px`);
      assert.equal(await preview.locator('h1').count(), 1);
      const missingAnchors = await preview.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map(link => link.getAttribute('href').slice(1)).filter(id => id && !document.getElementById(id)));
      assert.deepEqual(missingAnchors, [], `${entry.id} internal links resolve`);
      await preview.screenshot({ path: `${screenshots}/${entry.id}-${width}.png`, fullPage: true });
    }
  }
  await preview.close();
  console.log('PASS: every published preview renders on desktop/mobile, all images load and internal navigation resolves.');

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await until(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'service worker control');
  // Remove the optional download cache to prove the PWA precache includes every demo archive.
  await page.evaluate(() => caches.delete('trafficops-template-repository-trafficops-demo'));
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
  await context.setOffline(true); await page.reload();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  for (const entry of index.templates) {
    await page.getByRole('button', { name: `Use ${entry.name}`, exact: true }).click(); await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Create landing', exact: true }).isEnabled(), true);
    if (entry.id === 'demo-portfolio') {
      await usePicker(page, 'offline-demo');
      await dialog.getByRole('button', { name: 'Create landing', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await editorReady(page);
      assert.ok(await readOpfs(page, 'picker/offline-demo/index.tpl'));
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
    } else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await context.setOffline(false);
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Manage repositories', exact: true }).click();
  await settings.getByRole('button', { name: 'Remove TrafficOps Demo', exact: true }).click();
  await page.reload();
  assert.equal(await settings.getByRole('article', { name: 'TrafficOps Demo', exact: true }).count(), 0);
  for (const entry of index.templates) assert.ok(await readOpfs(page, `picker/${entry.id}/.trafficops/project.json`));
  assert.ok((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).knownDefaults.includes('trafficops-demo'));
  await settings.getByRole('button', { name: 'Use the included TrafficOps Demo repository', exact: true }).click();
  await settings.getByRole('button', { name: 'Add repository', exact: true }).click();
  await settings.getByRole('article', { name: 'TrafficOps Demo', exact: true }).waitFor();
  assert.equal(await toggle.isChecked(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: all five archives work offline in the installed PWA; removing the default remains removed and preserves projects; manual restoration works.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
