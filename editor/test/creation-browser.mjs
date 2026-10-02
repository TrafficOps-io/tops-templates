import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { httpServer } from './support/http-server.js';
import { starterProject } from '../src/starter.js';
import { studioChat } from './support/studio-chat.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('editor/embedded/dist'), api = httpServer({ aiEnabled: true });
api.state().files = starterProject(true);
const prompt = 'Create a botanical landing page with warm green colors.';
let claimed = false, starts = 0, failedSave = false, lastSaved;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      const initial = { id: 'creation-1', prompt, mode: claimed ? 'edit' : 'create', autoStart: !claimed };
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="editor"></div><script type="module">import { mountEditor } from '/editor.js';mountEditor(document.getElementById('editor'), { endpoint: location.origin + '/project', aiEndpoint: location.origin + '/ai', csrf: 'test', initialAiRequest: ${JSON.stringify(initial)} });</script></body></html>`);
      return;
    }
    if (url.pathname.startsWith('/project') || url.pathname.startsWith('/ai')) {
      let body = ''; for await (const chunk of request) body += chunk;
      const input = body ? JSON.parse(body) : {};
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
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
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

  await page.reload();
  await chat.status('failed').waitFor();
  assert.equal(starts, 1, 'reload must not restart paid generation');
  assert.equal(await chat.user.first().innerText(), prompt, 'failed prompt survives reload for recovery');
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
  console.log('PASS: automatic AI kickoff, chat popups inside the shadow root, no repeat on reload, retained prompt/manual retry, named team template from unsaved state, dialog error recovery.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
