// Folder-first smoke: a user-activation-gated folder picker that returns real OPFS directories (production code, no
// filesystem mocks). Creates a blank project, checks that saves land in its folder, reloads (auto-reopen), reopens from
// the library, and walks the cancel / existing-project / non-empty-folder choices.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), file = resolve(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + '/')) throw Error('path');
    const value = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(value);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

// The picker throws SecurityError without transient user activation, like Chromium. Folder names come from
// localStorage `test-folder-picker` ('!abort' cancels); folders live under OPFS picker/, never listed as OPFS projects.
const installPicker = () => {
  window.showDirectoryPicker = async () => {
    if (!navigator.userActivation.isActive) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError');
    window.__pickerCalls = (window.__pickerCalls || 0) + 1;
    const name = localStorage.getItem('test-folder-picker') || 'default';
    if (name === '!abort') throw new DOMException('The user aborted a request.', 'AbortError');
    const opfs = await navigator.storage.getDirectory(), picker = await opfs.getDirectoryHandle('picker', { create: true });
    return picker.getDirectoryHandle(name, { create: true });
  };
};
const readOpfs = (page, path) => page.evaluate(async path => {
  let directory = await navigator.storage.getDirectory();
  const parts = path.split('/'), name = parts.pop();
  try { for (const part of parts) directory = await directory.getDirectoryHandle(part); return await (await (await directory.getFileHandle(name)).getFile()).text(); } catch { return null; }
}, path);
const listOpfs = (page, path) => page.evaluate(async path => {
  let directory = await navigator.storage.getDirectory();
  try { for (const part of path.split('/')) directory = await directory.getDirectoryHandle(part); } catch { return null; }
  const names = []; for await (const name of directory.keys()) names.push(name); return names.sort();
}, path);
// Copies (and optionally removes) a folder under OPFS picker/, as a user would in Finder.
const copyFolder = (page, from, to, { remove = false } = {}) => page.evaluate(async ({ from, to, remove }) => {
  const picker = await (await navigator.storage.getDirectory()).getDirectoryHandle('picker');
  async function copy(source, target) {
    for await (const [name, handle] of source.entries()) {
      if (handle.kind === 'directory') { await copy(handle, await target.getDirectoryHandle(name, { create: true })); continue; }
      const writable = await (await target.getFileHandle(name, { create: true })).createWritable(); await writable.write(await handle.getFile()); await writable.close();
    }
  }
  let parent = picker;
  const parts = from.split('/'), last = parts.pop();
  for (const part of parts) parent = await parent.getDirectoryHandle(part);
  await copy(await parent.getDirectoryHandle(last), await picker.getDirectoryHandle(to, { create: true }));
  if (remove) await parent.removeEntry(last, { recursive: true });
}, { from, to, remove });
async function until(check, message, timeout = 10000) {
  for (const started = Date.now(); !(await check());) { if (Date.now() - started > timeout) throw new Error(`Timed out: ${message}`); await new Promise(done => setTimeout(done, 100)); }
}
const usePicker = (page, name) => page.evaluate(name => localStorage.setItem('test-folder-picker', name), name);

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.addInitScript(installPicker);
  const page = await context.newPage(), errors = [];
  await page.route('https://openrouter.ai/**', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  // Projects with conversations open on the AI tab; the checks read the Content form.
  const editorReady = async () => { await page.locator('.browser-frame iframe.is-visible').waitFor({ timeout: 20000 }); await page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click(); };
  const newBlank = async name => {
    await page.getByRole('button', { name: 'New project', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('button', { name: 'From scratch', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create landing', exact: true }).click();
  };

  // Folder mode in a plain tab: Open folder is offered, nothing is listed yet.
  await page.getByRole('button', { name: 'Open folder', exact: true }).waitFor();

  // Cancel: the dialog and its input stay, nothing is written.
  await usePicker(page, '!abort');
  await newBlank('Smoke project');
  await page.waitForFunction(() => window.__pickerCalls === 1);
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('button', { name: 'Create landing', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: 'Project name', exact: true }).inputValue(), 'Smoke project');
  assert.equal(await page.getByRole('alert').count(), 0, 'a cancelled picker is not an error');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Empty folder: a blank project is created in it and the editor mounts.
  await usePicker(page, 'smoke-1');
  await newBlank('Smoke project');
  await editorReady();
  const meta = JSON.parse(await readOpfs(page, 'picker/smoke-1/.trafficops/project.json'));
  assert.equal(meta.name, 'Smoke project');
  assert.equal(meta.kind, 'landing');
  assert.match(await readOpfs(page, 'picker/smoke-1/index.tpl'), /@template "Untitled project"/);
  assert.equal((await listOpfs(page, 'projects'))?.length ?? 0, 0, 'folder mode never creates OPFS project roots');
  await page.getByText('Saved to folder smoke-1').first().waitFor();

  // An edit autosaves into the folder.
  await page.locator('#setting-title').fill('Hello from the smoke test');
  await until(async () => JSON.parse(await readOpfs(page, 'picker/smoke-1/.trafficops/values.json') || '{}').title === 'Hello from the smoke test', 'the edit autosaves to values.json');
  // project.json records the save after the content is written.
  await until(async () => JSON.parse(await readOpfs(page, 'picker/smoke-1/.trafficops/project.json')).contentRevision >= 1, 'contentRevision is recorded');

  // Reload: the last project reopens without a prompt (its access is granted) and shows the saved value.
  await page.reload();
  await editorReady();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Hello from the smoke test');

  // The library lists it; opening the card reopens it.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open Smoke project', exact: true }).click();
  await editorReady();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Hello from the smoke test');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();

  // A folder that already holds a project: the choice opens it instead of overwriting it.
  await usePicker(page, 'smoke-1');
  await newBlank('Another project');
  const existing = page.getByRole('dialog', { name: '“smoke-1” already holds a project' });
  await existing.getByRole('button', { name: 'Open Smoke project', exact: true }).click();
  await editorReady();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Hello from the smoke test');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();

  // A folder with other files: create a subfolder named after the project.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory(), folder = await (await opfs.getDirectoryHandle('picker', { create: true })).getDirectoryHandle('busy', { create: true });
    const writable = await (await folder.getFileHandle('notes.txt', { create: true })).createWritable(); await writable.write('keep me'); await writable.close();
  });
  await usePicker(page, 'busy');
  await newBlank('Second project');
  const files = page.getByRole('dialog', { name: '“busy” already has files' });
  await files.getByRole('button', { name: 'Create subfolder second-project', exact: true }).click();
  await editorReady();
  assert.deepEqual(await listOpfs(page, 'picker/busy'), ['notes.txt', 'second-project']);
  assert.equal(JSON.parse(await readOpfs(page, 'picker/busy/second-project/.trafficops/project.json')).name, 'Second project');
  assert.equal(await readOpfs(page, 'picker/busy/notes.txt'), 'keep me');

  // In-editor access loss: the folder is moved away while open. The next save fails, the editor pauses with
  // "Folder unavailable", and Reconnect to the moved folder writes the unsaved edit there.
  await copyFolder(page, 'busy/second-project', 'moved', { remove: true });
  await page.locator('#setting-title').fill('Edited while the folder was gone');
  await page.getByRole('alert').filter({ hasText: 'Folder unavailable' }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByText('Saving stopped because the project changed elsewhere', { exact: false }).count(), 0, 'a lost folder is not reported as a conflict');
  await usePicker(page, 'moved');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await editorReady();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Edited while the folder was gone');
  await until(async () => JSON.parse(await readOpfs(page, 'picker/moved/.trafficops/values.json') || '{}').title === 'Edited while the folder was gone', 'the pending edit is written to the reconnected folder');
  assert.equal(await page.getByRole('alert').filter({ hasText: 'Folder unavailable' }).count(), 0);
  await page.getByText('Saved to folder moved').first().waitFor();

  // Open folder: a Finder copy of a known project is offered "Make independent", which gives it its own projectId.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await copyFolder(page, 'smoke-1', 'smoke-copy');
  await usePicker(page, 'smoke-copy');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'This folder is a copy of Smoke project' });
  await duplicate.getByRole('button', { name: 'Make independent', exact: true }).click();
  await editorReady();
  const copyMeta = JSON.parse(await readOpfs(page, 'picker/smoke-copy/.trafficops/project.json'));
  assert.notEqual(copyMeta.projectId, meta.projectId);
  assert.equal(JSON.parse(await readOpfs(page, 'picker/smoke-1/.trafficops/project.json')).projectId, meta.projectId);
  // Open folder on plain files adopts them in place: only .trafficops/ is added.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.evaluate(async () => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('picker')).getDirectoryHandle('plain', { create: true });
    const writable = await (await folder.getFileHandle('index.html', { create: true })).createWritable(); await writable.write('<!doctype html><title>Plain</title><h1>Plain</h1>'); await writable.close();
  });
  await usePicker(page, 'plain');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await page.locator('.browser-frame iframe.is-visible').waitFor({ timeout: 20000 });
  assert.deepEqual(await listOpfs(page, 'picker/plain'), ['.trafficops', 'index.html']);
  assert.equal(JSON.parse(await readOpfs(page, 'picker/plain/.trafficops/project.json')).name, 'plain');

  // Every opened folder is listed after a reload: the original and its independent copy, the reconnected and the
  // adopted project.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open Second project', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open Smoke project', exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Open plain', exact: true }).waitFor();
  // A listed folder that was deleted: opening it marks the card "Folder unavailable"; Remove from list forgets it and
  // leaves the disk alone.
  await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle('picker')).removeEntry('plain', { recursive: true }));
  await page.getByRole('button', { name: 'Open plain', exact: true }).click();
  await page.getByText('Folder unavailable', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reconnect plain', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove plain from list', exact: true }).click();
  await until(async () => await page.getByRole('button', { name: 'Open plain', exact: true }).count() === 0, 'the card is removed');
  await page.reload();
  await page.getByRole('button', { name: 'Open Second project', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open plain', exact: true }).count(), 0);

  assert.deepEqual(errors, []);

  // OPFS mode (no folder picker): projects are created under OPFS projects/ and the storage note warns about backups.
  {
    const opfsContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await opfsContext.addInitScript(() => { delete window.showDirectoryPicker; });
    const opfsPage = await opfsContext.newPage();
    opfsPage.on('pageerror', error => errors.push(error.message));
    await opfsPage.goto(url);
    await opfsPage.getByText('Stored in this browser — export a backup ZIP regularly', { exact: false }).first().waitFor();
    assert.equal(await opfsPage.getByRole('button', { name: 'Open folder', exact: true }).count(), 0);
    await opfsPage.getByRole('button', { name: 'New project', exact: true }).first().click();
    const create = opfsPage.getByRole('dialog', { name: 'New project' });
    await create.getByRole('button', { name: 'From scratch', exact: true }).click();
    await create.getByRole('textbox', { name: 'Project name', exact: true }).fill('Browser project');
    await create.getByRole('button', { name: 'Create landing', exact: true }).click();
    await opfsPage.locator('.browser-frame iframe.is-visible').waitFor({ timeout: 20000 });
    await opfsPage.getByText('Stored in this browser').first().waitFor();
    const roots = await listOpfs(opfsPage, 'projects');
    assert.equal(roots.length, 1);
    assert.equal(JSON.parse(await readOpfs(opfsPage, `projects/${roots[0]}/.trafficops/project.json`)).name, 'Browser project');
    await opfsPage.reload();
    await opfsPage.locator('.browser-frame iframe.is-visible').waitFor({ timeout: 20000 });
    await opfsContext.close();
  }
  // Neither folders nor OPFS: the update-your-browser screen.
  {
    const bareContext = await browser.newContext();
    await bareContext.addInitScript(() => { delete window.showDirectoryPicker; Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined }); });
    const barePage = await bareContext.newPage();
    await barePage.goto(url);
    await barePage.getByRole('heading', { name: "Studio can't save projects in this browser" }).waitFor();
    await bareContext.close();
  }
  assert.deepEqual(errors, []);
  console.log('folder-first smoke: ok');
} finally {
  await browser?.close();
  server.close();
}
