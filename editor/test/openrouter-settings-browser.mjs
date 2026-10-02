import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { studioChat } from './support/studio-chat.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
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
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  const page = await context.newPage(), errors = [], keys = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://openrouter.ai/api/v1/**', route => {
    keys.push(route.request().headers().authorization);
    return route.fulfill({ json: { data: {} } });
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  const open = async () => {
    await page.getByRole('button', { name: 'OpenRouter', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'OpenRouter settings' });
    await dialog.getByLabel('API key', { exact: false }).waitFor();
    return dialog;
  };
  let dialog = await open();
  const input = () => dialog.locator('input[type="password"]');
  assert.equal(await dialog.getByRole('button', { name: 'Remove key', exact: true }).isDisabled(), true);
  await input().fill('sk-or-first-test');
  await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
  await dialog.getByText('Connection saved on this device.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  dialog = await open();
  assert.equal(await input().inputValue(), 'sk-or-first-test');
  await dialog.getByRole('button', { name: 'Replace key', exact: true }).click();
  assert.equal(await input().inputValue(), '');
  assert.equal(await input().evaluate(element => element === document.activeElement), true);
  assert.equal(await dialog.getByRole('button', { name: 'Check connection', exact: true }).isDisabled(), true);
  // Closing an unsaved replacement keeps the previously saved key.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await open();
  assert.equal(await input().inputValue(), 'sk-or-first-test');
  await dialog.getByRole('button', { name: 'Replace key', exact: true }).click();
  await input().fill('sk-or-second-test');
  await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
  await dialog.getByText('Connection saved on this device.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Check connection', exact: true }).click();
  await dialog.getByText('Connection works.', { exact: true }).waitFor();
  assert.deepEqual(keys, ['Bearer sk-or-second-test']);
  await page.reload();
  dialog = await open();
  assert.equal(await input().inputValue(), 'sk-or-second-test');
  await dialog.getByRole('button', { name: 'Remove key', exact: true }).click();
  await dialog.getByText('API key removed from this device.', { exact: true }).waitFor();
  assert.equal(await input().inputValue(), '');
  assert.equal(await dialog.getByRole('button', { name: 'Check connection', exact: true }).isDisabled(), true);
  await page.reload();
  dialog = await open();
  assert.equal(await input().inputValue(), '');
  assert.equal(await dialog.getByRole('button', { name: 'Remove key', exact: true }).isDisabled(), true);
  await page.screenshot({ path: '/tmp/openrouter-settings.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Use A fresh beginning', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create landing', exact: true }).click();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  const chat = studioChat(page), keyNotice = chat.root.getByRole('status').filter({ hasText: 'Connect your key in Settings to start.' });
  await chat.composer.waitFor(); await keyNotice.waitFor();
  dialog = await open();
  await input().fill('sk-or-editor-test');
  await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
  await dialog.getByText('Connection saved on this device.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await keyNotice.waitFor({ state: 'detached' });
  await chat.prompt.fill('Test prompt');
  assert.equal(await chat.send.isEnabled(), true);
  dialog = await open();
  await dialog.getByRole('button', { name: 'Remove key', exact: true }).click();
  await dialog.getByText('API key removed from this device.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  // Without a key the chat asks to connect one and a send is refused before any provider request.
  await keyNotice.waitFor();
  await chat.send.click();
  await chat.root.getByRole('alert').filter({ hasText: 'Connect your key in Settings to start.' }).waitFor();
  assert.equal(await chat.user.count(), 0);
  // A refused send keeps the typed message for a retry.
  if (!process.env.T7_SKIP_SEND_TEXT) assert.equal(await chat.prompt.inputValue(), 'Test prompt'); // T7_SKIP
  assert.deepEqual(keys, ['Bearer sk-or-second-test'], 'No provider request without a key');
  const tab = await browser.newPage();
  await tab.goto(url);
  assert.equal(await tab.getByRole('button', { name: 'OpenRouter', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('OpenRouter settings: save, reload, cancel replacement, replace, verify, remove, persistence, chat key gating and browser-tab gating passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
