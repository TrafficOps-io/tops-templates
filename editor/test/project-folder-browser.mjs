import { workspaceUrl, reloadProject } from './support/workspace-url.js';
import { moreMenuItem } from './support/studio-chat.js';
import { revealConversationTab } from './support/studio-chat.js';
// Project folders, end to end with production storage (no filesystem mocks): a user-activation-gated folder picker
// returns real OPFS directories (support/studio-folders.js). Covers create into an empty folder, an existing project,
// a non-empty folder (subfolder), cancel, adopt, a Finder copy (Make independent), seeded binary assets, empty folders
// and history (ZIP export), ZIP import (D1 + D8), AI create with a brief, Save as template, user templates, Save a copy,
// duplicate (D8), delete semantics, OPFS mode and the unsupported screen.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { readZipProject } from '@trafficops/template-editor-core';
import { studioChat, saveNow, switchProject, newProjectControl } from './support/studio-chat.js';
import { copyFolder, editorReady, installFolderPicker, listOpfs, metaOf, openProject, pageSource, readOpfs, removeFolder, revokeAccess, seedProjectFolder, until, usePicker, writeOpfs } from './support/studio-folders.js';
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

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==', 'base64');
const generated = '@template "Smoke AI"\n@section content "Content"\n@param title String = "Smoke AI launch" label="Title"\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title></head><body><h1>{{title}}</h1></body></html>\n@endlayout\n';
// Synthetic OpenRouter: one agent loop (write index.tpl, then validate). No paid requests.
async function mockProvider(context, origin, counter) {
  let step = 0;
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith(`blob:${origin}/`)) return route.continue();
    if (!url.startsWith('https://openrouter.ai/api/v1/')) return route.abort();
    counter.requests++;
    if (!url.endsWith('/chat/completions')) return route.fulfill({ json: { data: [] } });
    const call = ++step % 2 === 1 ? ['set_file', { path: 'index.tpl', content: generated }] : ['validate_draft', {}];
    const value = { id: `smoke-${counter.requests}`, model: 'test/smoke', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${counter.requests}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }, finish_reason: 'tool_calls' }] };
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n` });
  });
}
const configureAi = page => page.evaluate(async () => {
  const db = await new Promise((done, reject) => { const request = indexedDB.open('trafficops-template-studio-ai', 1); request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'id' }); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  await new Promise((done, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-no-paid-requests', model: 'test/smoke', imageModel: '' }); tx.oncomplete = done; tx.onerror = () => reject(tx.error); }); db.close();
  window.dispatchEvent(new Event('trafficops-ai-settings'));
});
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await installFolderPicker(context);
  page = await context.newPage();
  const errors = [];
  await page.route('https://openrouter.ai/**', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(workspaceUrl(url));
  // Projects with conversations open on the AI tab; the checks read the Content form.
  const editorWithContent = async () => { await editorReady(page); await page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click(); };
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
  assert.equal(await listOpfs(page, 'picker'), null, 'a cancelled picker writes nothing');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Empty folder: a blank project is created in it and the editor mounts.
  await usePicker(page, 'smoke-1');
  await newBlank('Smoke project');
  await editorWithContent();
  const meta = await metaOf(page, 'picker/smoke-1');
  assert.equal(meta.name, 'Smoke project');
  assert.equal(meta.kind, 'landing');
  assert.match(await readOpfs(page, 'picker/smoke-1/index.tpl'), /@template "Untitled project"/);
  assert.equal((await listOpfs(page, 'projects'))?.length ?? 0, 0, 'folder mode never creates OPFS project roots');
  await page.getByText('Folder: smoke-1').first().waitFor();

  // An edit autosaves into the folder.
  await page.locator('#setting-title').fill('Hello from the smoke test');
  await until(async () => JSON.parse(await readOpfs(page, 'picker/smoke-1/.trafficops/values.json') || '{}').title === 'Hello from the smoke test', 'the edit autosaves to values.json');
  // project.json records the save after the content is written.
  await until(async () => (await metaOf(page, 'picker/smoke-1')).contentRevision >= 1, 'contentRevision is recorded');

  // Reload: the last project reopens without a prompt (its access is granted) and shows the saved value.
  await page.reload();
  await editorWithContent();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Hello from the smoke test');

  // The library lists it; opening the card reopens it.
  await openProject(page, 'Smoke project');
  await page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Hello from the smoke test');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();

  // A folder that already holds a project: the choice opens it instead of overwriting it.
  await usePicker(page, 'smoke-1');
  await newBlank('Another project');
  const existing = page.getByRole('dialog', { name: '“smoke-1” already holds a project' });
  await existing.getByRole('button', { name: 'Open Smoke project', exact: true }).click();
  await editorWithContent();
  assert.equal(await page.locator('#setting-title').inputValue(), 'Hello from the smoke test');
  assert.equal((await metaOf(page, 'picker/smoke-1')).projectId, meta.projectId, 'the existing project is never overwritten');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();

  // A folder with other files: create a subfolder named after the project.
  await writeOpfs(page, 'picker/busy/notes.txt', 'keep me');
  await usePicker(page, 'busy');
  await newBlank('Second project');
  const files = page.getByRole('dialog', { name: '“busy” already has files' });
  await files.getByRole('button', { name: 'Create subfolder second-project', exact: true }).click();
  await editorWithContent();
  assert.deepEqual(await listOpfs(page, 'picker/busy'), ['notes.txt', 'second-project']);
  assert.equal((await metaOf(page, 'picker/busy/second-project')).name, 'Second project');
  assert.equal(await readOpfs(page, 'picker/busy/notes.txt'), 'keep me');

  // Open folder: a Finder copy of a known project is offered "Make independent", which gives it its own projectId.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await copyFolder(page, 'smoke-1', 'smoke-copy');
  await usePicker(page, 'smoke-copy');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'This folder is a copy of Smoke project' });
  await duplicate.getByRole('button', { name: 'Make independent', exact: true }).click();
  await editorWithContent();
  const copyMeta = await metaOf(page, 'picker/smoke-copy');
  assert.notEqual(copyMeta.projectId, meta.projectId);
  assert.equal((await metaOf(page, 'picker/smoke-1')).projectId, meta.projectId);
  // Open folder on plain files adopts them in place: only .trafficops/ is added.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await writeOpfs(page, 'picker/plain/index.html', '<!doctype html><title>Plain</title><h1>Plain</h1>');
  await usePicker(page, 'plain');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await editorReady(page);
  assert.deepEqual(await listOpfs(page, 'picker/plain'), ['.trafficops', 'index.html']);
  assert.equal((await metaOf(page, 'picker/plain')).name, 'plain');
  assert.equal(await readOpfs(page, 'picker/plain/index.html'), '<!doctype html><title>Plain</title><h1>Plain</h1>', 'adopting never rewrites the files');
  // Switcher: opening a project whose folder is gone shows the reason in the editor; the open project stays.
  await removeFolder(page, 'busy/second-project');
  await page.locator('.studio-project-trigger').click();
  await page.getByRole('menuitem', { name: 'Second project' }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not open “Second project”' }).waitFor();
  await page.getByText('Folder: plain').first().waitFor();
  assert.deepEqual(await listOpfs(page, 'picker/busy'), ['notes.txt']);

  // A seeded folder with binary assets, an empty folder and two dialogues: the editor shows its files, and the editable
  // ZIP keeps its identity, bytes, folders and history.
  const now = Date.now();
  const seeded = await seedProjectFolder(page, { name: 'Folder continuity', files: { 'index.tpl': pageSource('Initial title'), 'notes.txt': 'Keep the same project and dialogues.', 'assets/pixel.png': new Uint8Array([0, 1, 255]) }, folders: ['empty', 'assets'], values: { title: 'Device content' },
    conversations: { threads: [
      { schema: 1, id: 'thread-alpha', title: 'Plan the page', archived: false, createdAt: now, updatedAt: now, messages: [{ id: 'message-alpha', role: 'user', prompt: 'Keep this conversation in the folder.', createdAt: now }, { id: 'answer-alpha', role: 'assistant', text: 'Saved conversations stay with the same project.', createdAt: now + 1 }], runs: [] },
      { schema: 1, id: 'thread-beta', title: 'Review typography', archived: true, createdAt: now + 2, updatedAt: now + 2, messages: [{ id: 'message-beta', role: 'user', prompt: 'A second saved conversation.', createdAt: now + 2 }], runs: [] },
    ] } });
  await openProject(page, 'Folder continuity');
  {
    const chat = studioChat(page); await revealConversationTab(chat.root); await chat.root.waitFor();
    if (await chat.threads.isVisible()) await chat.thread('Plan the page').waitFor(); else { const header = chat.root.locator('.studio-chat-header'); await header.getByRole('button', { name: 'Conversations', exact: true }).click(); await header.getByRole('menuitem', { name: 'Plan the page', exact: true }).waitFor(); await page.keyboard.press('Escape'); }
  }
  await page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
  assert.equal(await page.getByLabel('Page title', { exact: false }).inputValue(), 'Device content');
  await page.locator('.file-sidebar').getByText('notes.txt', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: /Editable project/ }).click();
  {
    const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
      const downloading = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: 'Download', exact: true }).click();
    const archive = readZipProject(new Uint8Array(await readFile(await (await downloading).path())), { history: true });
    assert.equal(archive.metadata.projectId, seeded.projectId);
    assert.deepEqual([...archive.files['assets/pixel.png']], [0, 1, 255]);
    assert.ok(archive.folders.includes('empty'), 'empty folders are kept');
    assert.equal(archive.settings.title, 'Device content');
    const threads = archive.conversationFiles?.threads || archive.conversations?.threads || [];
    assert.deepEqual(threads.map(thread => thread.id).sort(), ['thread-alpha', 'thread-beta']);
  }
  assert.deepEqual(await listOpfs(page, `${seeded.folder}/assets`), ['pixel.png']);
  assert.deepEqual(await listOpfs(page, `${seeded.folder}/empty`), [], 'the empty folder stays on disk');

  // Every opened folder is listed after a reload: the original and its independent copy, the adopted and the seeded
  // project.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open Second project', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open Smoke project', exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Open plain', exact: true }).waitFor();
  // A listed folder that was deleted: opening it marks the card "Folder unavailable"; Remove from list forgets it and
  // leaves the disk alone.
  await removeFolder(page, 'plain');
  await page.getByRole('button', { name: 'Open plain', exact: true }).click();
  await page.getByText('Folder unavailable', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reconnect plain', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove plain from list', exact: true }).click();
  await until(async () => await page.getByRole('button', { name: 'Open plain', exact: true }).count() === 0, 'the card is removed');
  await page.reload();
  await page.getByRole('button', { name: 'Open Second project', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open plain', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();

  // AI create, templates, copies, import and duplicate in the installed presentation (its toolbar holds the lifecycle
  // actions), with a mocked provider.
  {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), provider = { requests: 0 }, confirms = [];
    await installFolderPicker(context);
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
    await mockProvider(context, url, provider);
    const app = page = await context.newPage();
    app.on('pageerror', error => errors.push(error.message));
    app.on('dialog', dialog => { confirms.push(dialog.message()); dialog.accept(); });
    await app.goto(workspaceUrl(url));
    const contentTab = () => app.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
    const projects = async () => { await app.getByRole('button', { name: 'Projects', exact: true }).click(); await app.locator('.library button:not([disabled])', { hasText: 'Import ZIP' }).waitFor(); };
    await configureAi(app);

    // AI create from the home brief with an image: the picker opens in the submit, the attachments are read after it,
    // pendingAi is stored with the attachment blob, claimed exactly once, and the run starts.
    await usePicker(app, 'ai-1');
    await app.getByRole('button', { name: 'New project', exact: true }).click();
    const home = app.getByRole('dialog', { name: 'New project', exact: true });
    await home.getByRole('button', { name: 'With AI', exact: true }).click();
    const composer = home.locator('[data-testid="studio-chat-composer"]');
    await composer.getByRole('textbox', { name: 'Message to assistant', exact: true }).fill('Build a calm smoke-test launch page.');
    await composer.locator('input[type=file]').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: png });
    await composer.locator('.studio-chip-attachment', { hasText: 'hero.png' }).waitFor();
    await composer.getByRole('checkbox', { name: 'Use attached images on the page', exact: true }).check();
    await composer.locator('button[type=submit]').click();
    const chat = studioChat(app);
    await revealConversationTab(chat.root); await chat.root.waitFor({ timeout: 20000 });
    await chat.user.getByText('Build a calm smoke-test launch page.', { exact: true }).waitFor();
    await chat.status('ready').waitFor({ timeout: 20000 });
    assert.equal(provider.requests, 2, 'the kickoff run is one agent loop');
    const aiMeta = await metaOf(app, 'picker/ai-1');
    assert.equal(aiMeta.pendingAi, undefined, 'the brief is claimed');
    assert.equal(aiMeta.name, 'Build a calm smoke-test launch page.');
    assert.equal((await listOpfs(app, 'picker/ai-1/.trafficops/conversations/blobs')).length >= 1, true, 'the attachment is stored as a blob');
    assert.equal((await listOpfs(app, 'picker/ai-1/.trafficops/conversations')).filter(name => name.endsWith('.json')).length, 1);
    await chat.apply.click(); await chat.status('applied').waitFor();
    await reloadProject(app); await revealConversationTab(chat.root); await chat.root.waitFor({ timeout: 20000 }); await chat.status('applied').waitFor();
    await app.waitForTimeout(1000);
    assert.equal(provider.requests, 2, 'reopening never restarts a claimed brief');

    // Save as template: the dialog's submit opens the picker for the template's folder (D4).
    await usePicker(app, 'tpl-1');
    await (await moreMenuItem(app, 'Save as template')).click();
    const save = app.getByRole('dialog').filter({ has: app.getByRole('textbox', { name: 'Template name', exact: true }) });
    await save.getByRole('textbox', { name: 'Template name', exact: true }).fill('Smoke template');
    await save.getByRole('button', { name: 'Save as template', exact: true }).click();
    await until(async () => (await readOpfs(app, 'picker/tpl-1/.trafficops/project.json')) !== null, 'the template is written');
    const templateMeta = await metaOf(app, 'picker/tpl-1');
    assert.equal(templateMeta.kind, 'template');
    assert.match(await readOpfs(app, 'picker/tpl-1/index.tpl'), /Smoke AI launch/);
    assert.equal(await listOpfs(app, 'picker/tpl-1/.trafficops/conversations'), null, 'a template carries no history');
    assert.equal((await metaOf(app, 'picker/ai-1')).kind, 'landing', 'the source stays a landing');

    // Export the AI project with its history, for the import checks below.
    await app.locator('.studio-toolbar').getByRole('button', { name: 'Export', exact: true }).click();
    await app.getByRole('menuitem', { name: /Editable project/ }).click();
    const downloading = app.waitForEvent('download');
    await app.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Download', exact: true }).click();
    const archivePath = await (await downloading).path();

    // A user template: its card click asks for access and reads it (D2); Create then picks the new folder.
    await projects();
    await app.getByRole('button', { name: 'Project actions: Smoke template', exact: true }).click();
    await app.getByRole('menuitem', { name: 'Use template', exact: true }).click();
    const create = app.getByRole('dialog', { name: 'New project' });
    await create.getByRole('textbox', { name: 'Project name', exact: true }).fill('From my template');
    await usePicker(app, 'from-tpl');
    await create.getByRole('button', { name: 'Create landing', exact: true }).click();
    await editorReady(app);
    const fromTemplate = await metaOf(app, 'picker/from-tpl');
    assert.equal(fromTemplate.sourceTemplateId, templateMeta.projectId);
    assert.equal(fromTemplate.kind, 'landing');
    assert.match(await readOpfs(app, 'picker/from-tpl/index.tpl'), /Smoke AI launch/);
    // The create dialog lists user templates as buttons; choosing one asks for access in that click and reads it (D2).
    await (await newProjectControl(app)).click();
    const pick = app.getByRole('dialog', { name: 'New project' });
    await pick.getByRole('button', { name: 'From template', exact: true }).click();
    await pick.getByRole('group', { name: 'Starting template' }).getByRole('button', { name: /Smoke template/ }).click();
    await pick.getByText('Creates an independent copy', { exact: false }).waitFor();
    await pick.getByRole('textbox', { name: 'Project name', exact: true }).fill('Picked template');
    await usePicker(app, 'from-tpl-2');
    await pick.getByRole('button', { name: 'Create landing', exact: true }).click();
    await until(async () => (await readOpfs(app, 'picker/from-tpl-2/.trafficops/project.json')) !== null, 'the project from the chosen template is written');
    await pick.waitFor({ state: 'detached' }); await editorReady(app);
    assert.equal((await metaOf(app, 'picker/from-tpl-2')).sourceTemplateId, templateMeta.projectId);
    await openProject(app, 'From my template');

    // Save a copy…: the folder disappears while open; the copy keeps the unsaved edit and opens.
    await contentTab();
    await copyFolder(app, 'from-tpl', 'from-tpl-backup', { remove: true });
    await app.locator('#setting-title').fill('Rescued edit');
    await app.getByRole('alert').filter({ hasText: 'Folder unavailable' }).waitFor({ timeout: 10000 });
    await usePicker(app, 'rescued');
    await app.getByRole('button', { name: 'Save a copy…', exact: true }).click();
    await until(async () => (await readOpfs(app, 'picker/rescued/.trafficops/project.json')) !== null, 'the copy is written');
    await editorReady(app); await contentTab();
    assert.equal(await app.locator('#setting-title').inputValue(), 'Rescued edit');
    const rescued = await metaOf(app, 'picker/rescued');
    assert.equal(rescued.name, 'From my template (copy)');
    assert.notEqual(rescued.projectId, fromTemplate.projectId);
    assert.equal(JSON.parse(await readOpfs(app, 'picker/rescued/.trafficops/values.json')).title, 'Rescued edit');

    // Import a ZIP whose projectId Studio knows: a copy under a new id, with the dialogue (D1). The dialog's button
    // picks the folder (D8).
    await projects();
    await usePicker(app, 'imported-copy');
    await app.locator('input[aria-label="Import project ZIP"]').setInputFiles(archivePath);
    const importDialog = app.getByRole('dialog', { name: `Import ${aiMeta.name}` });
    const picksBeforeImport = await app.evaluate(() => window.__pickerCalls || 0);
    await importDialog.waitFor();
    assert.equal(await app.evaluate(() => window.__pickerCalls || 0), picksBeforeImport, 'reading the archive opens no picker');
    await importDialog.getByRole('button', { name: 'Choose folder…', exact: true }).click();
    await revealConversationTab(chat.root); await chat.root.waitFor({ timeout: 20000 });
    await chat.user.getByText('Build a calm smoke-test launch page.', { exact: true }).waitFor();
    const importedCopy = await metaOf(app, 'picker/imported-copy');
    assert.notEqual(importedCopy.projectId, aiMeta.projectId);
    assert.equal(importedCopy.name, `${aiMeta.name} (copy)`);

    // Delete (folder): only the list entry goes; the folder stays on disk. Re-importing then keeps the projectId.
    await projects();
    await app.getByRole('button', { name: `Project actions: ${aiMeta.name}`, exact: true }).click();
    await app.getByRole('menuitem', { name: `Delete ${aiMeta.name}`, exact: true }).click();
    assert.match(confirms.at(-1), /The folder stays on your disk/);
    await until(async () => await app.getByRole('button', { name: `Open ${aiMeta.name}`, exact: true }).count() === 0, 'the project leaves the list');
    assert.notEqual(await readOpfs(app, 'picker/ai-1/.trafficops/project.json'), null);
    await usePicker(app, 'imported-same');
    await app.locator('input[aria-label="Import project ZIP"]').setInputFiles(archivePath);
    await app.getByRole('dialog', { name: `Import ${aiMeta.name}` }).getByRole('button', { name: 'Choose folder…', exact: true }).click();
    await revealConversationTab(chat.root); await chat.root.waitFor({ timeout: 20000 });
    await chat.user.getByText('Build a calm smoke-test launch page.', { exact: true }).waitFor();
    assert.equal((await metaOf(app, 'picker/imported-same')).projectId, aiMeta.projectId);

    // Duplicate with granted access: one click picks the destination.
    await projects();
    await usePicker(app, 'dup-1');
    await app.getByRole('button', { name: 'Project actions: Smoke template', exact: true }).click();
    await app.getByRole('menuitem', { name: 'Duplicate Smoke template', exact: true }).click();
    await app.getByRole('button', { name: 'Open Smoke template (copy)', exact: true }).waitFor();
    const duplicated = await metaOf(app, 'picker/dup-1');
    assert.equal(duplicated.kind, 'template');
    assert.notEqual(duplicated.projectId, templateMeta.projectId);
    // Duplicate without granted access (D8): the first click grants the source, "Choose destination…" picks.
    await revokeAccess(app, { request: 'granted' });
    await app.reload();
    await app.getByText('Needs permission', { exact: true }).first().waitFor();
    const picksBefore = await app.evaluate(() => window.__pickerCalls || 0);
    await usePicker(app, 'dup-2');
    await app.getByRole('button', { name: 'Project actions: From my template (copy)', exact: true }).click();
    await app.getByRole('menuitem', { name: 'Duplicate From my template (copy)', exact: true }).click();
    const destination = app.getByRole('dialog', { name: 'Duplicate From my template (copy)' });
    await destination.waitFor();
    assert.equal(await app.evaluate(() => window.__pickerCalls || 0), picksBefore, 'the granting click opens no picker');
    await destination.getByRole('button', { name: 'Choose destination…', exact: true }).click();
    await until(async () => (await readOpfs(app, 'picker/dup-2/.trafficops/project.json')) !== null, 'the second duplicate is written');
    assert.equal((await metaOf(app, 'picker/dup-2')).name, 'From my template (copy) (copy)');
    await context.close();
  }
  assert.deepEqual(errors, []);

  // OPFS mode (no folder picker): projects are created under OPFS projects/ and the storage note warns about backups.
  {
    const opfsContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await opfsContext.addInitScript(() => { delete window.showDirectoryPicker; });
    const opfsPage = page = await opfsContext.newPage();
    opfsPage.on('pageerror', error => errors.push(error.message));
    await opfsPage.goto(workspaceUrl(url));
    await opfsPage.getByText('Stored in this browser — export a backup ZIP regularly', { exact: false }).first().waitFor();
    assert.equal(await opfsPage.getByRole('button', { name: 'Open folder', exact: true }).count(), 0);
    await (await newProjectControl(opfsPage)).click();
    const create = opfsPage.getByRole('dialog', { name: 'New project' });
    await create.getByRole('button', { name: 'From scratch', exact: true }).click();
    await create.getByRole('textbox', { name: 'Project name', exact: true }).fill('Browser project');
    await create.getByRole('button', { name: 'Create landing', exact: true }).click();
    await editorReady(opfsPage);
    assert.match(await opfsPage.locator('.studio-toolbar-status').getAttribute('title'), /Stored in this browser/);
    const roots = await listOpfs(opfsPage, 'projects');
    assert.equal(roots.length, 1);
    assert.equal((await metaOf(opfsPage, `projects/${roots[0]}`)).name, 'Browser project');
    // A seeded OPFS project is listed from projects/ without any recent entry.
    await seedProjectFolder(opfsPage, { name: 'Seeded in browser', opfs: true, values: { title: 'From OPFS' } });
    await openProject(opfsPage, 'Seeded in browser');
    await opfsPage.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
    assert.equal(await opfsPage.getByLabel('Page title', { exact: false }).inputValue(), 'From OPFS');
    await opfsPage.reload();
    await editorReady(opfsPage);
    // Delete (OPFS): after confirming, the project's folder is removed from browser storage.
    const asked = [];
    let acceptDialogs = true;
    opfsPage.on('dialog', dialog => { asked.push(dialog.message()); if (acceptDialogs) dialog.accept(); else dialog.dismiss(); });
    await opfsPage.getByRole('button', { name: 'Projects', exact: true }).click();
    await opfsPage.getByRole('button', { name: 'Project actions: Browser project', exact: true }).click();
    await opfsPage.getByRole('menuitem', { name: 'Delete Browser project', exact: true }).click();
    await until(async () => (await listOpfs(opfsPage, 'projects')).length === 1, 'the OPFS root is deleted');
    assert.match(asked[0], /from this browser\? This cannot be undone/);
    await opfsPage.getByRole('button', { name: 'Open Seeded in browser', exact: true }).waitFor();
    // A create that stops before writing removes the OPFS root it made. Here: the open project lost its folder, and
    // the user refuses to leave its unsaved edits.
    await openProject(opfsPage, 'Seeded in browser');
    await opfsPage.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
    await opfsPage.evaluate(async () => { const projects = await (await navigator.storage.getDirectory()).getDirectoryHandle('projects'); for await (const name of projects.keys()) await projects.removeEntry(name, { recursive: true }); });
    await opfsPage.getByLabel('Page title', { exact: false }).fill('Unsaved');
    await opfsPage.getByRole('alert').filter({ hasText: 'Folder unavailable' }).waitFor({ timeout: 10000 });
    await (await newProjectControl(opfsPage)).click();
    const refused = opfsPage.getByRole('dialog', { name: 'New project' });
    await refused.getByRole('button', { name: 'From scratch', exact: true }).click();
    await refused.getByRole('textbox', { name: 'Project name', exact: true }).fill('Never written');
    acceptDialogs = false;
    await refused.getByRole('button', { name: 'Create landing', exact: true }).click();
    await until(async () => asked.some(message => /Leave the project anyway/.test(message)), 'the leave question');
    await until(async () => (await listOpfs(opfsPage, 'projects')).length === 0, 'the abandoned OPFS root is removed');
    acceptDialogs = true;
    await opfsContext.close();
  }
  // Neither folders nor OPFS: the update-your-browser screen.
  {
    const bareContext = await browser.newContext();
    await bareContext.addInitScript(() => { delete window.showDirectoryPicker; Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined }); });
    const barePage = page = await bareContext.newPage();
    await barePage.goto(workspaceUrl(url));
    await barePage.getByRole('heading', { name: "Studio can't save projects in this browser" }).waitFor();
    await bareContext.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: project folders: create (empty / existing / non-empty / cancel), adopt, Make independent, seeded assets + history ZIP, AI brief claim, Save as template, user template, Save a copy, ZIP import (D1/D8), duplicate (D8), delete, OPFS mode, unsupported screen.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: '/tmp/studio-project-folder-failure.png', fullPage: true }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000)); }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
