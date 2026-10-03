import { workspaceUrl } from './support/workspace-url.js';
// Folder access and outside changes, with production storage over real OPFS folders (support/studio-folders.js):
// an edit made outside Studio stops saving (conflict) without overwriting the folder; Save a copy… keeps the unsaved
// edits, binary assets and empty folders; Reload saved project discards them. Revoked access and a moved folder pause
// the editor as "Folder unavailable"; Reconnect accepts only the same project and writes the pending edit; a listed
// folder without access asks in the Open click and offers Reconnect.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { copyFolder, editorFrame, editorReady, installFolderPicker, listOpfs, metaOf, openProject, pageSource, readOpfs, revokeAccess, seedProjectFolder, until, usePicker, writeOpfs } from './support/studio-folders.js';

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
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const source = pageSource('Disk title');
const valuesOf = async (page, folder) => JSON.parse(await readOpfs(page, `${folder}/.trafficops/values.json`) || '{}');
const bytesOf = (page, path) => page.evaluate(async path => {
  let directory = await navigator.storage.getDirectory();
  const parts = path.split('/'), name = parts.pop();
  for (const part of parts) directory = await window.__rawFs.dir(directory, part);
  return [...new Uint8Array(await (await window.__rawFs.read(await window.__rawFs.file(directory, name))).arrayBuffer())];
}, path);
let browser, page;
const errors = [];

async function newPage({ installed = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  await installFolderPicker(context);
  if (installed) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await context.route('**/*', route => route.request().url().startsWith(url + '/') || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(workspaceUrl(url));
  await page.locator('.library').waitFor();
  return page;
}
const contentTab = () => page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
const title = () => page.getByLabel('Page title', { exact: false });

try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

  // Outside changes, in the installed presentation (its toolbar shows the save status).
  await newPage({ installed: true });
  const conflictProject = await seedProjectFolder(page, { name: 'Conflict landing', files: { 'index.tpl': source, 'images/pixel.png': new Uint8Array([0, 1, 255]) }, folders: ['empty', 'images'], values: { title: 'Original value' } });
  await openProject(page, 'Conflict landing');
  await contentTab();
  assert.equal(await title().inputValue(), 'Original value');
  // Another program changes values.json; the next Studio save stops instead of overwriting it.
  await writeOpfs(page, `${conflictProject.folder}/.trafficops/values.json`, JSON.stringify({ title: 'Changed outside' }));
  await title().fill('Rescued unsaved value');
  await page.getByRole('alert').filter({ hasText: 'This project changed in another window or outside Studio' }).waitFor();
  const conflictStatus = page.locator('.studio-toolbar [role="status"]').filter({ hasText: 'Not saved: conflict' });
  await conflictStatus.waitFor();
  assert.equal(await conflictStatus.locator('.studio-badge-danger').count(), 1, 'the conflict badge uses the danger tone');
  assert.equal(await page.getByRole('alert').filter({ hasText: 'Folder unavailable' }).count(), 0, 'a conflict is not access loss');
  assert.equal((await valuesOf(page, conflictProject.folder)).title, 'Changed outside', 'the outside change is never overwritten');
  // Save a copy…: the unsaved edits, the binary asset and the empty folder go to a new folder, which opens.
  await usePicker(page, 'conflict-copy');
  await page.getByRole('button', { name: 'Save a copy…', exact: true }).click();
  await until(async () => (await readOpfs(page, 'picker/conflict-copy/.trafficops/project.json')) !== null, 'the copy is written');
  await page.locator('.studio-project-name').filter({ hasText: /^Conflict landing \(copy\)$/ }).waitFor();
  await contentTab();
  assert.equal(await title().inputValue(), 'Rescued unsaved value');
  const copy = await metaOf(page, 'picker/conflict-copy');
  assert.notEqual(copy.projectId, conflictProject.projectId);
  assert.equal(copy.kind, 'landing');
  assert.equal((await valuesOf(page, 'picker/conflict-copy')).title, 'Rescued unsaved value');
  assert.equal(await readOpfs(page, 'picker/conflict-copy/index.tpl'), source);
  assert.deepEqual(await bytesOf(page, 'picker/conflict-copy/images/pixel.png'), [0, 1, 255]);
  assert.deepEqual(await listOpfs(page, 'picker/conflict-copy/empty'), []);
  assert.equal((await valuesOf(page, conflictProject.folder)).title, 'Changed outside', 'the original keeps its folder state');
  // Reopening the original shows the folder's version.
  await openProject(page, 'Conflict landing');
  await contentTab();
  assert.equal(await title().inputValue(), 'Changed outside');
  // Reload saved project: a file edited outside Studio while it is also edited here stops saving; Reload discards the
  // edits shown and opens the folder's version, and saving resumes.
  await writeOpfs(page, `${conflictProject.folder}/index.tpl`, source.replace('<h1>{{title}}</h1>', '<h1>{{title}}</h1><p>Edited outside</p>'));
  await page.locator('.file-sidebar button[title="index.tpl"]').click();
  const code = page.locator('.monaco-editor .view-lines');
  await code.click({ position: { x: 60, y: 10 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.insertText('\n');
  await page.getByRole('alert').filter({ hasText: 'This project changed in another window or outside Studio' }).waitFor();
  assert.match(await readOpfs(page, `${conflictProject.folder}/index.tpl`), /Edited outside/);
  await page.getByRole('alert').filter({ hasText: 'Saving stopped; your edits are kept here' }).getByRole('button', { name: 'Reload saved project', exact: true }).click();
  const reload = page.getByRole('dialog', { name: 'Reload saved project', exact: true });
  await reload.getByRole('button', { name: 'Apply', exact: true }).click();
  await reload.waitFor({ state: 'detached' });
  await page.getByRole('alert').filter({ hasText: 'Saving stopped; your edits are kept here' }).waitFor({ state: 'detached' });
  await editorFrame(page).contentFrame().getByText('Edited outside', { exact: true }).waitFor();
  await contentTab();
  await title().fill('Saved after reload');
  await until(async () => (await valuesOf(page, conflictProject.folder)).title === 'Saved after reload', 'saving resumes after Reload');
  assert.match(await readOpfs(page, `${conflictProject.folder}/index.tpl`), /Edited outside/);
  // Another tab of the same project saves first: this tab's next save shows one conflict alert, with Reload only in it.
  {
    const first = page, second = await page.context().newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(workspaceUrl(url));
    await second.getByRole('button', { name: 'Open Conflict landing', exact: true }).click();
    await editorReady(second);
    await second.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
    await second.getByLabel('Page title', { exact: false }).fill('From the second tab');
    await until(async () => (await valuesOf(second, conflictProject.folder)).title === 'From the second tab', 'the second tab saves');
    await title().fill('From the first tab');
    await first.getByRole('alert').filter({ hasText: 'This project changed in another window or outside Studio' }).waitFor();
    // Monaco's empty live regions (role=alert) are not notices.
    const alerts = await first.getByRole('alert').evaluateAll(nodes => nodes.filter(node => !node.classList.contains('monaco-alert')).map(node => node.textContent.trim().slice(0, 120)));
    assert.equal(alerts.length, 1, `one conflict alert: ${JSON.stringify(alerts)}`);
    assert.equal(await first.getByRole('button', { name: 'Reload saved project', exact: true }).count(), 1, 'Reload is offered once, in the alert');
    assert.equal((await valuesOf(first, conflictProject.folder)).title, 'From the second tab', 'the other tab\'s save is kept');
    await second.close();
  }
  console.log('PASS: an outside edit stops saving without overwriting; Save a copy… keeps edits, assets and folders; Reload saved project opens the folder version and saving resumes.');
  await page.context().close();

  // Access loss, in a plain tab.
  await newPage();
  const revoked = await seedProjectFolder(page, { name: 'Revoked landing', values: { title: 'Before revoke' } });
  await seedProjectFolder(page, { name: 'Other landing', register: false });
  await openProject(page, 'Revoked landing');
  await contentTab();
  // The browser revokes access while the project is open: the next save fails, the editor pauses.
  await revokeAccess(page, { folder: 'revoked-landing' });
  await title().fill('Edited without access');
  const unavailable = page.getByRole('alert').filter({ hasText: 'Folder unavailable' });
  await unavailable.waitFor();
  assert.equal(await page.getByText('changed in another window or outside Studio', { exact: false }).count(), 0, 'access loss is not reported as a conflict');
  // Reconnect accepts only the folder of this project.
  await usePicker(page, 'other-landing');
  await unavailable.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This folder holds a different project' }).waitFor();
  assert.equal(await unavailable.count(), 1);
  assert.equal((await valuesOf(page, 'picker/other-landing')).title, undefined, 'a different project is never written');
  // Choosing the folder again grants access; the pending edit is written there.
  await usePicker(page, 'revoked-landing');
  await unavailable.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(async () => (await valuesOf(page, revoked.folder)).title === 'Edited without access', 'the pending edit is written after Reconnect');
  await unavailable.waitFor({ state: 'detached' });
  await page.getByText('Folder: revoked-landing').first().waitFor();
  await contentTab();
  assert.equal(await title().inputValue(), 'Edited without access');

  // After a restart without access: the project does not reopen by itself; Open asks in its click, a refusal marks
  // the card "Folder unavailable", and Reconnect picks the folder again.
  await revokeAccess(page, { folder: 'revoked-landing' });
  await page.reload();
  await page.locator('.library').waitFor();
  assert.equal(await editorFrame(page).count(), 0, 'a folder without access is not reopened without a click');
  const card = page.locator('.library-card').filter({ has: page.getByRole('heading', { name: 'Revoked landing', exact: true }) });
  await card.getByText('Needs permission', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open Revoked landing', exact: true }).click();
  await card.getByRole('status').filter({ hasText: 'Studio needs permission to use this folder' }).waitFor();
  assert.equal(await card.getByText('Folder unavailable', { exact: true }).count(), 0, 'a refused permission is not a missing folder');
  await usePicker(page, 'revoked-landing');
  await page.getByRole('button', { name: 'Reconnect Revoked landing', exact: true }).click();
  await editorReady(page);
  await contentTab();
  assert.equal(await title().inputValue(), 'Edited without access');

  // The folder is moved while open: Reconnect to its new place writes the unsaved edit there.
  await copyFolder(page, 'revoked-landing', 'moved', { remove: true });
  await title().fill('Edited while the folder was gone');
  await unavailable.waitFor();
  await usePicker(page, 'moved');
  await unavailable.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(async () => (await valuesOf(page, 'picker/moved')).title === 'Edited while the folder was gone', 'the pending edit is written to the moved folder');
  await page.getByText('Folder: moved').first().waitFor();
  assert.equal(await listOpfs(page, 'picker/revoked-landing'), null);

  // The folder's files changed while it was unavailable: Reconnect asks before discarding the unsaved edit.
  const confirms = [];
  page.on('dialog', dialog => { confirms.push(dialog.message()); dialog.accept(); });
  await revokeAccess(page, { folder: 'moved' });
  await contentTab();
  await title().fill('Edit that cannot apply');
  await unavailable.waitFor();
  await writeOpfs(page, 'picker/moved/index.tpl', pageSource('Disk title').replace('<h1>{{title}}</h1>', '<h1>{{title}}</h1><p>Changed while away</p>'));
  await unavailable.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(() => confirms.length === 1, 'Reconnect asks before discarding');
  assert.match(confirms[0], /files or values changed while it was unavailable/);
  await unavailable.waitFor({ state: 'detached' });
  await editorFrame(page).contentFrame().getByText('Changed while away', { exact: true }).waitFor();
  assert.equal((await valuesOf(page, 'picker/moved')).title, 'Edited while the folder was gone', 'the discarded edit is not written');
  assert.deepEqual(errors, []);
  console.log('PASS: revoked access and a moved folder pause the editor; Reconnect checks the project, grants access and writes the pending edit; a listed folder without access asks on Open and reconnects; a changed folder asks before discarding.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '/tmp/studio-folder-access-failure.png', fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
