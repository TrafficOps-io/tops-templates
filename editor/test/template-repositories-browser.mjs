// Real cross-origin static repository, disposable browser storage, and user-activation-gated folder picker.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createZip } from '@trafficops/template-editor-core';
import { editorReady, installFolderPicker, readOpfs, until, usePicker } from './support/studio-folders.js';

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const app = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
const files = {
  'index.tpl': '@template "Team template" version=1\n@section content "Content"\n  @param headline String = "Original" label="Headline"\n@endsection\n@layout\n<!doctype html><html><body><h1>{{ headline }}</h1><img src="images/logo.svg"></body></html>\n@endlayout\n',
  'images/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="25" fill="red"/></svg>',
};
const zip = createZip(files, { settings: { headline: 'Value from repository' }, directories: ['empty-assets'] });
const checksum = createHash('sha256').update(zip).digest('hex');
let version = '1.0', broken = false, brokenZip = false, delayed = false, releaseIndex, archiveRequests = 0;
const catalog = name => ({ schemaVersion: 1, repository: { name, description: 'Shared team starting points.', author: 'Studio team', homepage: './' }, templates: [{ id: 'launch', name: `${name} landing`, description: 'Campaign page with saved content and assets.', version, archive: 'landing.zip', preview: 'preview.html', sha256: checksum }] });
const repository = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Cache-Control', 'no-store');
  if (request.url.endsWith('index.json')) {
    if (delayed) await new Promise(resolve => { releaseIndex = resolve; });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(broken ? { schemaVersion: 99 } : catalog(request.url.includes('/two/') ? 'Team Two' : 'Team One')));
  } else if (request.url.endsWith('.zip')) {
    archiveRequests++; response.writeHead(brokenZip ? 404 : 200, { 'Content-Type': 'application/zip' }); response.end(brokenZip ? 'not found' : zip);
  } else if (request.url.endsWith('preview.html')) {
    response.setHeader('Content-Type', 'text/html'); response.end('<h1>Team preview</h1><script>parent.postMessage("UNSAFE_PREVIEW_RAN", "*")</script>');
  } else { response.writeHead(404); response.end('Not found'); }
});
await Promise.all([new Promise(resolve => app.listen(0, '127.0.0.1', resolve)), new Promise(resolve => repository.listen(0, '127.0.0.1', resolve))]);
const base = `http://127.0.0.1:${app.address().port}`, repo = `http://127.0.0.1:${repository.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow' });
  await installFolderPicker(context);
  await context.addInitScript(() => { window.unsafePreviewRan = false; addEventListener('message', event => { if (event.data === 'UNSAFE_PREVIEW_RAN') window.unsafePreviewRan = true; }); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000);
  await page.goto(`${base}/?studio=1`);
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Template repositories', exact: true });
  await settings.getByRole('article', { name: 'TrafficOps starters' }).waitFor();
  async function add(path) {
    await settings.getByLabel('Repository index URL').fill(`${repo}/${path}/index.json`);
    await settings.getByRole('button', { name: 'Add repository', exact: true }).click();
  }
  await add('one'); await settings.getByRole('article', { name: 'Team One', exact: true }).waitFor();
  await add('one'); await settings.getByRole('alert').filter({ hasText: 'already added' }).waitFor();
  await add('two'); await settings.getByRole('article', { name: 'Team Two', exact: true }).waitFor();
  assert.equal(archiveRequests, 0, 'browsing indexes must not download ZIPs');
  await page.reload(); await settings.getByRole('article', { name: 'Team One', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  await page.getByRole('region', { name: 'Team One', exact: true }).getByRole('heading', { name: 'Team One landing' }).waitFor();
  await page.getByRole('region', { name: 'Team Two', exact: true }).getByRole('heading', { name: 'Team Two landing' }).waitFor();
  const teamPreview = page.getByRole('region', { name: 'Team One', exact: true }).locator('.library-thumbnail');
  await teamPreview.scrollIntoViewIfNeeded();
  await teamPreview.frameLocator('iframe').getByRole('heading', { name: 'Team preview' }).waitFor();
  assert.equal(await page.evaluate(() => window.unsafePreviewRan), false, 'repository previews cannot execute JavaScript');
  await page.screenshot({ path: '/tmp/studio-repositories-library.png', fullPage: true });
  await page.getByRole('button', { name: 'Use Team One landing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.waitFor();
  await dialog.getByLabel('Project name', { exact: true }).fill('Repository project');
  await usePicker(page, 'repository-project');
  await dialog.getByRole('button', { name: 'Create landing', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' }); await editorReady(page);
  const meta = JSON.parse(await readOpfs(page, 'picker/repository-project/.trafficops/project.json'));
  assert.equal(meta.name, 'Repository project'); assert.match(meta.sourceTemplateId, /^repository:/);
  assert.equal(JSON.parse(await readOpfs(page, 'picker/repository-project/.trafficops/values.json')).headline, 'Value from repository');
  assert.equal(await readOpfs(page, 'picker/repository-project/images/logo.svg'), files['images/logo.svg']);
  assert.equal(await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); const picker = await root.getDirectoryHandle('picker'); const project = await picker.getDirectoryHandle('repository-project'); return Boolean(await project.getDirectoryHandle('empty-assets')); }), true);
  console.log('PASS: cross-origin add, duplicate detection, persistence, grouping, sandboxed preview and independent project copy.');

  // Settings while a project is mounted; preserve it while refreshing/disabling/removing its source repository.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  broken = true;
  await settings.getByRole('button', { name: 'Refresh Team One' }).click();
  await settings.getByRole('article', { name: 'Team One', exact: true }).getByRole('alert').filter({ hasText: 'Showing the last saved catalog' }).waitFor();
  broken = false; version = '2.0';
  await settings.getByRole('button', { name: 'Refresh Team One' }).click();
  await until(async () => page.evaluate(() => JSON.parse(localStorage.getItem('trafficops-template-repositories-v1')).repositories.find(record => record.index?.repository.name === 'Team One')?.index.templates[0].version === '2.0'), 'refreshed version');
  await settings.getByRole('checkbox', { name: 'Enable Team Two' }).uncheck();
  const secondTab = await context.newPage();
  await secondTab.goto(`${base}/?studio=1#settings`);
  const secondToggle = secondTab.getByRole('checkbox', { name: 'Enable Team Two' });
  await secondToggle.waitFor(); assert.equal(await secondToggle.isChecked(), false);
  await settings.getByRole('checkbox', { name: 'Enable Team Two' }).check();
  await until(() => secondToggle.isChecked(), 'repository preference sync between tabs');
  await settings.getByRole('checkbox', { name: 'Enable Team Two' }).uncheck();
  await secondTab.close();
  await page.screenshot({ path: '/tmp/studio-repositories-settings.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settings.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'settings fit mobile');
  await page.screenshot({ path: '/tmp/studio-repositories-settings-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Back to project', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'Team Two', exact: true }).count(), 0);
  brokenZip = true;
  await page.getByRole('button', { name: 'Use Team One landing', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'HTTP 404' }).waitFor();
  assert.equal(await dialog.count(), 0, 'failed ZIP never opens a destination picker');
  brokenZip = false;
  await page.getByRole('button', { name: 'Use Team One landing', exact: true }).click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Change template' }).click();
  await dialog.getByRole('region', { name: 'Team One', exact: true }).waitFor();
  await dialog.getByLabel('Project name', { exact: true }).fill('Keep my project name');
  await dialog.getByRole('button', { name: 'Manage repositories' }).click();
  await until(() => page.evaluate(() => document.activeElement?.id === 'repositories-title'), 'repository settings focus');
  await page.getByRole('button', { name: 'Back to new project', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Project name', { exact: true }).inputValue(), 'Keep my project name');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'template picker fits mobile');
  await page.screenshot({ path: '/tmp/studio-repositories-picker-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS: refresh recovery, disabled repository, failed ZIP retry, and responsive settings/template picker.');

  // Wait for the real service worker, then reload offline as an installed PWA and create another copy.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await until(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'service worker control');
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
  await context.setOffline(true); await page.reload();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Use Team One landing', exact: true }).click(); await dialog.waitFor();
  await dialog.getByLabel('Project name', { exact: true }).fill('Offline repository copy');
  await usePicker(page, 'repository-offline');
  await dialog.getByRole('button', { name: 'Create landing', exact: true }).click(); await editorReady(page);
  assert.equal(JSON.parse(await readOpfs(page, 'picker/repository-offline/.trafficops/values.json')).headline, 'Value from repository');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Use Independent studio', exact: true }).click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Manage repositories' }).click();
  delayed = true;
  await settings.getByRole('button', { name: 'Refresh Team One' }).click();
  await until(() => Boolean(releaseIndex), 'pending refresh');
  await settings.getByRole('button', { name: 'Remove Team One' }).click();
  delayed = false; releaseIndex();
  await settings.getByRole('article', { name: 'Team One', exact: true }).waitFor({ state: 'detached' });
  assert.equal(JSON.parse(await readOpfs(page, 'picker/repository-project/.trafficops/project.json')).name, 'Repository project');
  await page.reload(); assert.equal(await settings.getByRole('article', { name: 'Team One', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: cached remote and unvisited included ZIPs work offline in PWA; removal during refresh cannot resurrect a repository or remove projects.');
} finally { await browser?.close(); await Promise.all([new Promise(resolve => app.close(resolve)), new Promise(resolve => repository.close(resolve))]); }
