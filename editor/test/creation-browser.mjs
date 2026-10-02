import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { httpServer } from './support/http-server.js';
import { conversationHandler, fetchRequest, sendResponse } from './support/conversation-endpoints.js';
import { starterProject } from '../src/starter.js';
import { studioChat } from './support/studio-chat.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('editor/embedded/dist'), api = httpServer({ aiEnabled: true, conversationsEnabled: true });
// The embed keeps AI history on the host: the conversation endpoints under /project share the mock's store.
const conversations = conversationHandler(api.conversations), conversationCalls = [];
api.state().files = starterProject(true);
const prompt = 'Create a botanical landing page with warm green colors.';
let claimed = false, starts = 0, failedSave = false, lastSaved;
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
    await fresh.getByRole('tab', { name: 'Conversations', exact: true }).click();
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
await page.keyboard.press('Escape'); await headerMenu.waitFor({ state: 'hidden' });
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
  assert.deepEqual(errors, []);
  console.log('PASS: automatic AI kickoff, host-stored chat history across reloads and browser profiles, chat popups inside the shadow root, no repeat on reload, retained prompt/manual retry, named team template from unsaved state, dialog error recovery.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
