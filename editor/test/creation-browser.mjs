import { revealConversationTab } from './support/studio-chat.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { httpServer } from './support/http-server.js';
import { conversationHandler, fetchRequest, sendResponse } from './support/conversation-endpoints.js';
import { starterProject } from '../src/starter.js';
import { studioChat } from './support/studio-chat.js';
import { createZip, readZipProject } from '@trafficops/template-editor-core';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('editor/embedded/dist'), api = httpServer({ aiEnabled: true, conversationsEnabled: true });
// The embed keeps AI history on the host: the conversation endpoints under /project share the mock's store.
const conversations = conversationHandler(api.conversations), conversationCalls = [];
api.state().files = starterProject(true);
api.state().draftHistory = [{ revision: 1, created_at: '2026-09-18T10:00:00Z' }];
api.state().revisions = [{ id: 'publication-previous', number: 7, createdAt: '2026-09-18T10:00:00Z', current: true, locales: ['en'] }];
const prompt = 'Create a botanical landing page with warm green colors.';
let claimed = false, starts = 0, failedSave = false, lastSaved;
let failDownload = false;
const exports = [];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      // `?history` mounts without the creation request, so any dialogue shown comes from the server's history.
      const initial = url.searchParams.has('history') ? undefined : { id: 'creation-1', prompt, mode: claimed ? 'edit' : 'create', autoStart: !claimed };
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="editor"></div><script type="module">import { mountEditor } from '/editor.js';mountEditor(document.getElementById('editor'), { endpoint: location.origin + '/project', aiEndpoint: location.origin + '/ai', csrf: 'test'${initial ? `, initialAiRequest: ${JSON.stringify(initial)}` : ''} });</script></body></html>`);
      return;
    }
    if (url.pathname.startsWith('/project') || url.pathname.startsWith('/ai')) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), [, endpoint, ...segments] = url.pathname.split('/');
      const routed = endpoint === 'project' ? await conversations(fetchRequest(request, bytes), segments) : undefined;
      if (routed) {
        conversationCalls.push({ method: request.method, path: url.pathname, ifMatch: request.headers['if-match'], csrf: request.headers['x-csrf-token'], status: routed.status });
        await sendResponse(response, routed); return;
      }
      const body = bytes.toString(), input = body ? JSON.parse(body) : {};
      let result;
      if (url.pathname.endsWith('/ai-kickoff')) {
        assert.equal(input.requestId, 'creation-1');
        result = Response.json({ started: !claimed }); claimed = true;
      } else if (url.pathname === '/ai/chat') {
        result = Response.json({ error: { message: 'Mock provider unavailable' } }, { status: 422 });
      } else if (url.pathname.endsWith('/save-template') && !failedSave) {
        failedSave = true;
        result = Response.json({ message: 'Review the template name' }, { status: 422 });
      } else if (['/project/download', '/project/draft-download', '/project/history-download'].includes(url.pathname)) {
        exports.push({ path: url.pathname, input });
        if (failDownload) { failDownload = false; result = Response.json({ message: 'Export temporarily unavailable' }, { status: 422 }); }
        else if (url.pathname === '/project/download') result = await api.fetchImpl('http://localhost' + url.pathname, { method: request.method, body });
        else result = new Response(createZip({ 'historical.txt': `Saved ${input.draftRevision || input.revisionId}` }, { settings: { title: 'Historical title' } }));
      } else {
        if (url.pathname === '/ai/start') starts++;
        if (url.pathname.endsWith('/save-template')) lastSaved = input;
        result = await api.fetchImpl('http://localhost' + url.pathname, { method: request.method, ...(body ? { body } : {}) });
      }
      await sendResponse(response, result);
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file));
  } catch (error) { response.writeHead(404); response.end(String(error.message)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const chat = studioChat(page.locator('#editor'));
  await chat.status('failed').waitFor();
  await chat.status('failed').getByText('Mock provider unavailable').first().waitFor();
  assert.equal(starts, 1);
  assert.equal(await page.getByRole('tab', { name: 'Conversations', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await chat.user.first().innerText(), prompt);
  assert.equal(await page.getByRole('dialog', { name: 'Create new project', exact: true }).count(), 0, 'new-page generation needs no replace confirmation');
  // The dialogue is stored on the host through the conversation contract, not in browser storage.
  const storedDialogue = async () => (await api.conversations.listThreads()).find(thread => JSON.stringify(thread).includes(prompt) && JSON.stringify(thread).includes('Mock provider unavailable'));
  for (let tries = 0; tries < 100 && !await storedDialogue(); tries++) await page.waitForTimeout(100);
  const stored = await storedDialogue();
  assert.ok(stored, 'the failed creation dialogue is saved on the host');
  const writes = conversationCalls.filter(call => call.method === 'PUT' && call.path === `/project/conversations/${stored.id}`);
  assert.ok(writes.length > 0 && writes.every(call => /^"\d+"$/.test(call.ifMatch) && call.csrf === 'test' && call.status === 200), 'thread writes carry If-Match and CSRF and succeed');
  assert.equal(writes[0].ifMatch, '"0"', 'the first write creates the thread');

  const listsBeforeReload = conversationCalls.filter(call => call.method === 'GET' && call.path === '/project/conversations').length;
  await page.reload();
  await chat.status('failed').waitFor();
  assert.equal(starts, 1, 'reload must not restart paid generation');
  assert.equal(await chat.user.first().innerText(), prompt, 'failed prompt survives reload for recovery');
  assert.ok(conversationCalls.filter(call => call.method === 'GET' && call.path === '/project/conversations').length > listsBeforeReload, 'reload loads history from the host');
  // A fresh browser profile without the creation request still shows the dialogue: history lives on the server.
  const other = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  try {
    const fresh = await other.newPage(); fresh.on('pageerror', error => errors.push(error.message));
    await fresh.goto(`http://127.0.0.1:${server.address().port}/?history`);
    await revealConversationTab(fresh.locator('[data-testid=\"studio-chat\"]'));
    const freshChat = studioChat(fresh.locator('#editor'));
    await freshChat.status('failed').getByText('Mock provider unavailable').first().waitFor();
    assert.equal(await freshChat.user.first().innerText(), prompt, 'the server-stored dialogue reappears in another browser profile');
  } finally { await other.close(); }
  assert.equal(starts, 1, 'viewing history does not start a run');
  await chat.status('failed').getByRole('button', { name: 'Continue generation', exact: true }).click();
  for (let tries = 0; tries < 100 && starts < 2; tries++) await page.waitForTimeout(100);
  await chat.status('failed').getByText('Mock provider unavailable').first().waitFor();
  assert.equal(starts, 2, 'manual retry remains available');

// StudioChat popups (mention menu, menus, confirm dialog) must render inside the editor's shadow root,
// where the adopted stylesheet applies, and never in the light DOM of the host page.
const inShadow = locator => locator.evaluate(node => node.getRootNode() === document.getElementById('editor').shadowRoot);
const lightDomPopups = () => page.evaluate(() => document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],.studio-popover').length);
await chat.prompt.click(); await chat.prompt.pressSequentially('@');
const mentions = chat.composer.getByRole('listbox', { name: 'Mention targets', exact: true });
await mentions.waitFor();
assert.equal(await inShadow(mentions), true, 'mention menu renders inside the shadow root');
assert.equal(await lightDomPopups(), 0);
await chat.prompt.press('Escape'); await chat.prompt.fill('');
await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'Conversations', exact: true }).click();
const headerMenu = chat.root.locator('.studio-chat-header').getByRole('menu', { name: 'Conversations', exact: true });
await headerMenu.waitFor();
assert.equal(await inShadow(headerMenu), true, 'header menu renders inside the shadow root');
// Narrow management is another native surface inside the same shadow root. Its nested confirmation owns Tab/Escape.
await headerMenu.getByRole('menuitem', { name: 'Manage conversations', exact: true }).click();
const management = chat.root.getByTestId('studio-chat-management'); await management.waitFor();
assert.equal(await inShadow(management), true); assert.equal(await lightDomPopups(), 0);
assert.equal(await management.getByRole('searchbox', { name: 'Search conversations' }).evaluate(node => node === node.getRootNode().activeElement), true);
const rowAction = management.locator('.studio-chat-threads-more').first();
await rowAction.click(); await management.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
const managementConfirm = management.getByRole('dialog', { name: 'Delete conversation?', exact: true }); await managementConfirm.waitFor();
assert.equal(await inShadow(managementConfirm), true);
for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Shift+Tab']) { await page.keyboard.press(key); assert.equal(await managementConfirm.evaluate(node => node.contains(node.getRootNode().activeElement)), true); }
await page.keyboard.press('Escape'); await managementConfirm.waitFor({ state: 'hidden' });
assert.equal(await management.isVisible(), true); await page.waitForFunction(() => document.getElementById('editor').shadowRoot.activeElement?.classList.contains('studio-chat-threads-more'));
await rowAction.click(); await management.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
await managementConfirm.getByRole('button', { name: 'Cancel', exact: true }).click(); await managementConfirm.waitFor({ state: 'hidden' });
await page.waitForFunction(() => document.getElementById('editor').shadowRoot.activeElement?.classList.contains('studio-chat-threads-more'));
await management.getByRole('button', { name: 'Close', exact: true }).click(); await management.waitFor({ state: 'hidden' });
await page.waitForFunction(() => document.getElementById('editor').shadowRoot.activeElement?.getAttribute('aria-label') === 'Conversations');
assert.equal(await lightDomPopups(), 0);
// The thread list (with its delete confirmation) is shown once the chat is at least 560 px wide.
await page.setViewportSize({ width: 2400, height: 1100 });
await chat.threads.waitFor();
await chat.threads.locator('[aria-haspopup="menu"]').first().click();
const threadMenu = chat.threads.getByRole('menu');
await threadMenu.waitFor();
assert.equal(await inShadow(threadMenu), true, 'thread menu renders inside the shadow root');
await threadMenu.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
const confirm = page.getByRole('dialog', { name: 'Delete conversation?', exact: true });
await confirm.waitFor();
assert.equal(await inShadow(confirm), true, 'confirm dialog renders inside the shadow root');
assert.equal(await lightDomPopups(), 0);
await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
await confirm.waitFor({ state: 'hidden' });
await page.setViewportSize({ width: 1500, height: 1100 });

  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await page.locator('#setting-title').fill('Unsaved botanical content');
  await page.locator('.hosted-heading').getByRole('button', { name: 'Save as team template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as team template', exact: true });
  await dialog.getByRole('textbox', { name: 'Template name', exact: true }).fill('Reusable botanical');
  await dialog.getByRole('button', { name: 'Save as team template', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Review the template name' }).waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: 'Template name', exact: true }).inputValue(), 'Reusable botanical');
  await dialog.getByRole('button', { name: 'Save as team template', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(lastSaved.templateName, 'Reusable botanical');
  assert.equal(lastSaved.translations.en.title, 'Unsaved botanical content');
  await page.getByRole('status').filter({ hasText: 'Saved to your team.' }).waitFor();

  // The embedded shortcut chooses source once; review preserves current edits and never asks for the format again.
  const collapse = page.getByRole('button', { name: 'Collapse editor', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.locator('.hosted-more > summary').click();
  await page.getByRole('button', { name: 'Download project', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Export', exact: true }); await review.waitFor();
  assert.equal(await review.getByRole('heading', { name: 'Editable project', exact: true }).count(), 1);
  assert.equal(await review.getByRole('combobox', { name: 'Export destination' }).count(), 0);
  assert.equal(await review.getByRole('textbox', { name: /^Continue URL/ }).count(), 0);
  assert.equal(await review.getByRole('checkbox', { name: 'Include conversation history', exact: true }).isChecked(), true);
  await review.getByText('EN · Current edits', { exact: true }).waitFor();
  const directDownload = page.waitForEvent('download'); await review.getByRole('button', { name: 'Download', exact: true }).click();
  const directBytes = readZipProject(new Uint8Array(await readFile(await (await directDownload).path())));
  assert.equal(directBytes.settings.title, 'Unsaved botanical content'); assert.equal(exports.at(-1).input.format, 'source');

  // Historical row actions keep their predetermined version/format instead of falling back to current edits.
  const history = page.getByRole('region', { name: 'Versions', exact: true });
  await history.getByRole('button', { name: /^Drafts/ }).click();
  await history.getByRole('button', { name: 'Download source ZIP', exact: true }).click(); await review.waitFor();
  await review.getByText('EN · Saved version', { exact: true }).waitFor();
  assert.equal(await review.getByRole('heading', { name: 'Editable project', exact: true }).count(), 1);
  assert.equal(await review.getByRole('combobox', { name: 'Export destination' }).count(), 0);
  const historicalSource = page.waitForEvent('download'); await review.getByRole('button', { name: 'Download', exact: true }).click();
  const sourceBytes = readZipProject(new Uint8Array(await readFile(await (await historicalSource).path())));
  assert.equal(sourceBytes.files['historical.txt'], 'Saved 1'); assert.equal(exports.at(-1).path, '/project/draft-download'); assert.equal(exports.at(-1).input.draftRevision, 1); assert.equal(exports.at(-1).input.format, 'source');

  await history.getByRole('button', { name: /^Publications/ }).click();
  await history.getByRole('button', { name: 'Download HTML ZIP', exact: true }).click(); await review.waitFor();
  assert.equal(await review.getByRole('heading', { name: 'Landing for hosting', exact: true }).count(), 1);
  assert.equal(await review.getByRole('combobox', { name: 'Export destination' }).count(), 0);
  assert.equal(await review.getByRole('checkbox', { name: 'Include conversation history', exact: true }).count(), 0);
  const continueUrl = review.getByRole('textbox', { name: /^Continue URL/ }); await continueUrl.fill('https://example.test/continue');
  failDownload = true; await review.getByRole('button', { name: 'Download', exact: true }).click();
  await review.getByRole('alert').filter({ hasText: 'Export temporarily unavailable' }).waitFor();
  assert.equal(await continueUrl.inputValue(), 'https://example.test/continue');
  const historicalHtml = page.waitForEvent('download'); await review.getByRole('button', { name: 'Download', exact: true }).click();
  const htmlBytes = readZipProject(new Uint8Array(await readFile(await (await historicalHtml).path())));
  assert.equal(htmlBytes.files['historical.txt'], 'Saved publication-previous'); assert.equal(exports.at(-1).path, '/project/history-download');
  assert.equal(exports.at(-1).input.revisionId, 'publication-previous'); assert.equal(exports.at(-1).input.format, 'html'); assert.equal(exports.at(-1).input.continueUrl, 'https://example.test/continue');
  assert.deepEqual(errors, []);
  console.log('PASS: automatic AI kickoff, host-stored chat history across reloads and browser profiles, chat popups inside the shadow root, no repeat on reload, retained prompt/manual retry, named team template from unsaved state, dialog error recovery.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
