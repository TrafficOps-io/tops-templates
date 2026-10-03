// Unified assistant in the production Landing Studio, with an offline text-only provider.
// PLAYWRIGHT_MODULE=/path/to/playwright node editor/test/ai-composer-browser.mjs [editor/dist]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { configureAi, installFolderPicker, seedAndOpen } from './support/studio-folders.js';
import { revealConversationTab, studioChat } from './support/studio-chat.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist'), out = '/tmp/landing-ai-composer';
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
try {
  const origin = `http://127.0.0.1:${server.address().port}`, page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (url.endsWith('/chat/completions')) {
      const body = route.request().postDataJSON(); requests.push(body);
      const payload = { id: 'offline', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'You can change this text in the editor.' }, finish_reason: 'stop' }] };
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` });
    }
    return route.abort();
  });
  await installFolderPicker(page);
  await page.goto(`${origin}/?studio=1`);
  await page.locator('.library').waitFor();
  await configureAi(page, { imageModel: 'offline/image' });
  await seedAndOpen(page, { name: 'Inline assistant QA', kind: 'template', files: {
    'index.tpl': '@template "Inline QA"\n@section page "Page"\n@param headline String = "Hello" label="Heading"\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><h1>{{ headline }}</h1></body></html>\n@endlayout\n',
  }, values: { headline: 'Hello' } });
  const chat = studioChat(page);
  await revealConversationTab(chat.root); await chat.root.waitFor();
  assert.equal(await chat.scope.count(), 0, 'no mode selector');
  const images = chat.composer.getByRole('button', { name: 'Generate images', exact: true });
  assert.equal(await images.getAttribute('aria-pressed'), 'true');
  await chat.prompt.fill('Explain @index');
  await chat.composer.getByRole('option', { name: 'index.tpl', exact: true }).click();
  await chat.prompt.pressSequentially(' please');
  assert.equal(await chat.prompt.inputValue(), 'Explain @index.tpl  please');
  assert.equal(await chat.composer.getByRole('listbox').count(), 0);
  await page.screenshot({ path: `${out}/inline-mention.png` });
  await chat.send.click();
  await chat.user.locator('.studio-chat-inline-mention').getByText('@index.tpl').waitFor();
  await chat.status('completed').waitFor();
  assert.ok(requests.at(-1).tools.some(item => item.function.name === 'generate_image'), 'images enabled in the agent tools');
  await images.click();
  await chat.prompt.fill('Explain @index');
  await chat.composer.getByRole('option', { name: 'index.tpl', exact: true }).click();
  await chat.send.click();
  await chat.user.nth(1).locator('.studio-chat-inline-mention').getByText('@index.tpl').waitFor();
  await chat.assistant.last().and(chat.status('completed')).waitFor();
  assert.ok(!requests.at(-1).tools.some(item => item.function.name === 'generate_image'), 'off removes the image tool');
  assert.equal(await images.getAttribute('aria-pressed'), 'false', 'sending does not reset the choice');
  await page.reload(); await revealConversationTab(chat.root);
  await chat.user.nth(1).locator('.studio-chat-inline-mention').getByText('@index.tpl').waitFor();
  assert.deepEqual(errors, []);
  console.log('ai-composer-browser: OK');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
