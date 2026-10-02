import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { studioChat, moreMenuItem } from './support/studio-chat.js';

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
  // A fresh installed app exposes Conversations before any key has been saved.
  await page.getByRole('button', { name: 'Use A fresh beginning', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create landing', exact: true }).click();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  const chat = studioChat(page), keyNotice = chat.root.getByRole('status').filter({ hasText: 'Set up OpenRouter' });
  await keyNotice.waitFor(); assert.equal(await chat.composer.count(), 0, 'the connection card replaces the composer');
  await keyNotice.getByRole('button', { name: 'Connect OpenRouter', exact: true }).click();
  const inlineSettings = page.locator('.author-panel .ai-settings');
  await inlineSettings.getByRole('heading', { name: 'AI connection settings', exact: true }).waitFor();
  await inlineSettings.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  await keyNotice.waitFor();
  const open = async () => {
    await (await moreMenuItem(page, 'OpenRouter')).click();
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
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await keyNotice.waitFor(); assert.equal(await chat.composer.count(), 0, 'the connection card replaces the composer');
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
  // Without a key the connection card replaces the composer again, so nothing can be sent to a provider.
  await keyNotice.waitFor();
  assert.equal(await chat.composer.count(), 0);
  assert.equal(await chat.user.count(), 0);
  // The typed message stays in StudioChat's state while the card is shown; it is not sent anywhere.
  assert.deepEqual(keys, ['Bearer sk-or-second-test'], 'No provider request without a key');
  const tab = await browser.newPage();
  await tab.goto(url);
  assert.equal(await tab.getByRole('button', { name: 'OpenRouter', exact: true }).count(), 0);
  await tab.getByRole('button', { name: 'Use A fresh beginning', exact: true }).click();
  await tab.getByRole('dialog').getByRole('button', { name: 'Create landing', exact: true }).click();
  assert.equal(await tab.getByRole('tab', { name: 'Conversations', exact: true }).count(), 0);
  // Simulate this open window entering installed mode: preserve its project
  // and expose connection setup immediately, without a navigation or reload.
  await tab.evaluate(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.dispatchEvent(new Event('appinstalled'));
  });
  await tab.getByRole('tab', { name: 'Conversations', exact: true }).click();
  const installedChat = studioChat(tab);
  await installedChat.root.getByRole('button', { name: 'Connect OpenRouter', exact: true }).waitFor();
  await tab.evaluate(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
    window.dispatchEvent(new Event('appinstalled'));
  });
  await tab.getByRole('tab', { name: 'Conversations', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await tab.getByRole('button', { name: 'OpenRouter', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('OpenRouter settings: fresh-install Conversations, inline setup, save, reload, cancel replacement, replace, verify, remove, persistence, live chat key gating and installed-mode transitions without reload passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
