import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { studioChat } from './support/studio-chat.js';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

// Disposable browser profile and synthetic provider responses; no paid requests.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist'), out = '/tmp/studio-home-chat-browser';
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + '/')) throw Error('Path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==', 'base64');
const generated = '@template "Home chat"\n@section content "Content"\n@param title String = "Home chat launch" label="Title"\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title></head><body><h1>{{title}}</h1><p>Created from the home chat.</p></body></html>\n@endlayout\n';
const report = { checks: [], providerRequests: 0, errors: [] };
let browser, page;
async function readStored(target, database, store) {
  return target.evaluate(async ({ database, store }) => {
    const db = await new Promise((done, reject) => { const request = indexedDB.open(database); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((done, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }, { database, store });
}
async function openPage(installed = true) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let step = 0;
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith(`blob:${origin}/`)) return route.continue();
    if (!url.startsWith('https://openrouter.ai/api/v1/')) return route.abort();
    report.providerRequests++;
    if (!url.endsWith('/chat/completions')) return route.fulfill({ json: { data: [] } });
    const body = route.request().postDataJSON(), stage = body.tools?.length === 1 ? body.tools[0].function.name : null;
    const call = stage === 'submit_plan' ? ['submit_plan', { summary: 'Create the requested landing.', tasks: ['Create the landing', 'Review it'] }]
      : stage === 'submit_review' ? ['submit_review', { approved: true, summary: 'The requested landing is ready.', issues: [] }]
        : ++step === 1 ? ['set_file', { path: 'index.tpl', content: generated }] : ['validate_draft', {}];
    const value = { id: `home-${report.providerRequests}`, model: 'test/home-chat', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${report.providerRequests}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }, finish_reason: 'tool_calls' }] };
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n` });
  });
  const target = await context.newPage(); page = target;
  target.on('pageerror', error => report.errors.push(error.message));
  if (installed) await target.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await target.goto(origin); await target.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  return target;
}
// The editor opens on the latest conversation (the creation thread), as the former conversation panel did.
async function showLatestThread(page) {
  await studioChat(page).root.waitFor();
}
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const manual = await openPage(false);
  assert.equal(await manual.locator('.home-project-chat').count(), 0);
  assert.equal(await manual.locator('.topbar').count(), 1);
  await manual.context().close(); report.checks.push('browser manual workflows keep the site header and PWA-only AI gating');

  const pending = await openPage(), home = pending.locator('.home-project-chat');
  await pending.screenshot({ path: `${out}/home-empty-desktop.png` });
  await home.getByRole('button', { name: 'Product launch', exact: true }).click();
  // The brief is a standalone StudioComposer (no chat port: no mentions, no scopes), loaded as a separate chunk.
  const composer = home.locator('[data-testid="studio-chat-composer"]');
  const input = composer.getByRole('textbox', { name: 'Message to assistant', exact: true });
  await input.waitFor();
  assert.equal(await composer.locator('.studio-chat-scope').count(), 0, 'the home brief has no scope chips');
  assert.equal(await composer.getByRole('button', { name: 'Mention', exact: true }).count(), 0, 'the home brief has no mentions');
  assert.equal(await composer.getByRole('checkbox', { name: 'Generate images requested in the brief', exact: true }).isDisabled(), true, 'image generation needs an image model');
  assert.match(await input.inputValue(), /value proposition/);
  await input.fill('A reusable ceramics template'); await input.press('Shift+Enter');
  assert.match(await input.inputValue(), /\n$/);
  assert.equal(await pending.locator('.editor-shell').count(), 0, 'Shift+Enter keeps editing the brief');
  await input.fill('Create a reusable ceramics template with editable content.');
  await home.getByRole('button', { name: 'Reusable template', exact: true }).click();
  await composer.locator('input[type=file]').setInputFiles({ name: 'ceramics.png', mimeType: 'image/png', buffer: png });
  await composer.locator('.studio-chip-attachment', { hasText: 'ceramics.png' }).waitFor();
  await composer.getByRole('checkbox', { name: 'Use attached images on the page', exact: true }).check();
  await pending.locator('.starter-grid').scrollIntoViewIfNeeded();
  for (const card of await pending.locator('.starter-grid .library-thumbnail').all()) await card.frameLocator('iframe').locator('h1').waitFor();
  await pending.evaluate(() => scrollTo(0, 0));
  await pending.screenshot({ path: `${out}/home-desktop.png`, fullPage: true });
  for (const width of [390, 320]) {
    await pending.setViewportSize({ width, height: 900 });
    assert.ok(await pending.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home fits ${width}px`);
    await pending.screenshot({ path: `${out}/home-${width}.png`, fullPage: true });
  }
  await pending.setViewportSize({ width: 1440, height: 1000 });
  await composer.locator('button[type=submit]').click();
  await home.getByRole('status').filter({ hasText: 'Creating project…' }).waitFor();
  await home.locator('form[aria-busy="true"]').waitFor();
  const chat = studioChat(pending); await showLatestThread(pending);
  await chat.user.getByText('Create a reusable ceramics template with editable content.', { exact: true }).waitFor();
  await chat.root.getByRole('button', { name: 'AI settings', exact: true }).waitFor();
  const record = (await readStored(pending, 'trafficops-studio-library', 'projects'))[0];
  assert.equal(record.kind, 'template'); assert.equal(record.aiAttachments[0].name, 'ceramics.png'); assert.equal(record.aiAttachments[0].useOnPage, true);
  assert.equal(record.aiGenerateImages, undefined); assert.equal(report.providerRequests, 0);
  assert.equal(await pending.locator('.topbar').count(), 0); assert.equal(await pending.locator('.studio-toolbar').count(), 1);
  const shell = await pending.locator('.editor-shell.is-app').boundingBox(); assert.equal(shell.y, 0); assert.equal(shell.height, 1000);
  await pending.getByRole('button', { name: 'Open quick start guide', exact: true }).click();
  const tour = pending.getByRole('dialog', { name: 'From template to finished pages', exact: true });
  await tour.getByRole('link', { name: 'Read full docs ↗', exact: true }).waitFor();
  await tour.getByRole('button', { name: 'Start creating', exact: true }).click();
  await pending.reload(); await showLatestThread(pending); await chat.user.getByText(record.aiPrompt, { exact: true }).waitFor();
  assert.equal(report.providerRequests, 0); report.checks.push('home template brief + attachment persist without credentials; one full-height PWA header; help/docs retained');
  await pending.getByRole('button', { name: 'Projects', exact: true }).click(); await pending.locator('.home-project-chat').waitFor();
  assert.equal(await pending.locator('.topbar').count(), 1); report.checks.push('returning to library restores the home header');
  await pending.context().close();

  const configured = await openPage();
  await configured.evaluate(async () => {
    const db = await new Promise((done, reject) => { const request = indexedDB.open('trafficops-template-studio-ai', 1); request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'id' }); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    await new Promise((done, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-no-paid-requests', model: 'test/home-chat', imageModel: '' }); tx.oncomplete = done; tx.onerror = () => reject(tx.error); }); db.close(); window.dispatchEvent(new Event('trafficops-ai-settings'));
  });
  const configuredComposer = configured.locator('.home-project-chat [data-testid="studio-chat-composer"]');
  await configuredComposer.getByRole('textbox', { name: 'Message to assistant', exact: true }).fill('Build a calm product launch landing.');
  await configuredComposer.locator('button[type=submit]').click();
  const configuredChat = studioChat(configured); await showLatestThread(configured);
  await configuredChat.status('ready').waitFor(); await configuredChat.cards('diff').first().waitFor();
  await configuredChat.apply.click(); await configuredChat.status('applied').waitFor();
  await configured.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Home chat launch', exact: true }).waitFor();
  assert.equal((await readStored(configured, 'trafficops-studio-library', 'projects'))[0].kind, 'landing');
  assert.equal(report.providerRequests, 4, 'home generation follows the normal plan/write/validate/review workflow');
  await configured.screenshot({ path: `${out}/chat-desktop.png`, fullPage: true });
  report.checks.push('home landing brief → mocked generation → review → apply → rendered landing');
  assert.deepEqual(report.errors, []); await configured.context().close();
} catch (error) { await page?.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
