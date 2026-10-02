import { revealConversationTab } from './support/studio-chat.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { studioChat, moreMenuItem } from './support/studio-chat.js';
import { configureAi, installFolderPicker, metaOf, readProjectFolder, usePicker } from './support/studio-folders.js';
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
async function openPage(installed = true) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await installFolderPicker(context);
  let step = 0;
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith(`blob:${origin}/`)) return route.continue();
    if (!url.startsWith('https://openrouter.ai/api/v1/')) return route.abort();
    report.providerRequests++;
    if (!url.endsWith('/chat/completions')) return route.fulfill({ json: { data: [] } });
    // One agent loop: no intent, plan or review stage calls (plan_changes/review_draft are optional tools).
    const body = route.request().postDataJSON();
    assert.ok(!body.tools?.some(tool => ['select_intent', 'submit_plan', 'submit_review'].includes(tool.function.name)), 'no mandatory stage calls');
    const call = ++step === 1 ? ['set_file', { path: 'index.tpl', content: generated }] : ['validate_draft', {}];
    const value = { id: `home-${report.providerRequests}`, model: 'test/home-chat', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${report.providerRequests}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }, finish_reason: 'tool_calls' }] };
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n` });
  });
  const target = await context.newPage(); page = target;
  target.on('pageerror', error => report.errors.push(error.message));
  if (installed) await target.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await target.goto(origin); await target.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  return target;
}
// The editor opens on the latest conversation (the creation thread), as the former conversation panel did.
async function showLatestThread(page) {
  await revealConversationTab(studioChat(page).root); await studioChat(page).root.waitFor();
}
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  // AI is always enabled (D7): a plain tab offers the home brief and keeps the site header.
  const manual = await openPage(false);
  await manual.getByRole('button', { name: 'New project', exact: true }).click();
  await manual.getByRole('dialog', { name: 'New project' }).getByRole('button', { name: 'With AI', exact: true }).click();
  await manual.locator('.create-project-modal [data-testid="studio-chat-composer"]').waitFor();
  assert.equal(await manual.locator('.topbar').count(), 1);
  await manual.context().close(); report.checks.push('a plain tab keeps the site header and offers the home brief');

  const pending = await openPage();
  await pending.getByRole('tab', { name: 'Templates', exact: true }).click();
  await pending.locator('.starter-grid').scrollIntoViewIfNeeded();
  for (const card of await pending.locator('.starter-grid .library-thumbnail').all()) await card.frameLocator('iframe').locator('h1').waitFor();
  await pending.getByRole('tab', { name: 'Projects', exact: true }).click();
  await pending.getByRole('button', { name: 'New project', exact: true }).click();
  const home = pending.getByRole('dialog', { name: 'New project', exact: true });
  await home.getByRole('button', { name: 'With AI', exact: true }).click();
  await home.getByText('Example briefs', { exact: true }).click();
  await pending.screenshot({ path: `${out}/home-empty-desktop.png` });
  await home.getByRole('button', { name: 'Product launch', exact: true }).click();
  // The brief is a standalone StudioComposer (no chat port: no mentions, no scopes), loaded as a separate chunk.
  const composer = home.locator('[data-testid="studio-chat-composer"]');
  const input = composer.getByRole('textbox', { name: 'Message to assistant', exact: true });
  await input.waitFor();
  assert.equal(await composer.locator('.studio-chat-scope').count(), 0, 'the creation brief has no scope chips');
  assert.equal(await composer.getByRole('button', { name: 'Mention', exact: true }).count(), 0, 'the creation brief has no mentions');
  assert.equal(await composer.getByRole('checkbox', { name: 'Generate images requested in the brief', exact: true }).isDisabled(), true, 'image generation needs an image model');
  assert.match(await input.inputValue(), /value proposition/);
  await input.fill('A reusable ceramics template'); await input.press('Shift+Enter');
  assert.match(await input.inputValue(), /\n$/);
  assert.equal(await pending.locator('.editor-shell').count(), 0, 'Shift+Enter keeps editing the brief');
  await input.fill('Create a reusable ceramics template with editable content.');
  await home.getByText('Project options', { exact: true }).click();
  await home.getByRole('button', { name: /Reusable template/ }).click();
  await composer.locator('input[type=file]').setInputFiles({ name: 'ceramics.png', mimeType: 'image/png', buffer: png });
  await composer.locator('.studio-chip-attachment', { hasText: 'ceramics.png' }).waitFor();
  await composer.getByRole('checkbox', { name: 'Use attached images on the page', exact: true }).check();
  await pending.screenshot({ path: `${out}/home-desktop.png`, fullPage: true });
  for (const width of [390, 320]) {
    await pending.setViewportSize({ width, height: 900 });
    assert.ok(await pending.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home fits ${width}px`);
    await pending.screenshot({ path: `${out}/home-${width}.png`, fullPage: true });
  }
  await pending.setViewportSize({ width: 1440, height: 1000 });
  // The submit picks the project folder (picker/ceramics) in the same click.
  await usePicker(pending, 'ceramics');
  await composer.locator('button[type=submit]').click();
  await home.getByRole('status').filter({ hasText: 'Creating project…' }).waitFor();
  await home.locator('form[aria-busy="true"]').waitFor();
  const chat = studioChat(pending); await showLatestThread(pending);
  await chat.user.getByText('Create a reusable ceramics template with editable content.', { exact: true }).waitFor();
  await chat.root.getByRole('button', { name: 'Connect OpenRouter', exact: true }).waitFor();
  // The brief is claimed into the creation dialogue in the folder: the prompt and its attachment are kept in history.
  const stored = await readProjectFolder(pending, 'picker/ceramics'), brief = stored.conversations.threads[0].messages[0];
  assert.equal(stored.meta.kind, 'template'); assert.equal(stored.meta.pendingAi, undefined);
  assert.equal(brief.attachments[0].name, 'ceramics.png'); assert.equal(brief.attachments[0].useOnPage, true);
  assert.equal(report.providerRequests, 0);
  assert.equal(await pending.locator('.topbar').count(), 0); assert.equal(await pending.locator('.studio-toolbar').count(), 1);
  const shell = await pending.locator('.editor-shell.is-app').boundingBox(); assert.equal(shell.y, 0); assert.equal(shell.height, 1000);
  await (await moreMenuItem(pending, 'Quick start')).click();
  const tour = pending.getByRole('dialog', { name: 'From template to finished pages', exact: true });
  await tour.getByRole('link', { name: 'Read full docs ↗', exact: true }).waitFor();
  await tour.getByRole('button', { name: 'Start creating', exact: true }).click();
  await pending.reload(); await showLatestThread(pending); await chat.user.getByText(brief.prompt, { exact: true }).waitFor();
  assert.equal(report.providerRequests, 0); report.checks.push('creation template brief + attachment persist without credentials; one full-height PWA header; help/docs retained');
  await pending.getByRole('button', { name: 'Projects', exact: true }).click(); await pending.locator('.library-project-first').waitFor();
  assert.equal(await pending.locator('.topbar').count(), 1); report.checks.push('returning to library restores the home header');
  await pending.context().close();

  const configured = await openPage();
  await configureAi(configured, { model: 'test/home-chat' });
  await usePicker(configured, 'launch');
  await configured.getByRole('button', { name: 'New project', exact: true }).click();
  const configuredDialog = configured.getByRole('dialog', { name: 'New project', exact: true });
  await configuredDialog.getByRole('button', { name: 'With AI', exact: true }).click();
  const configuredComposer = configuredDialog.locator('[data-testid="studio-chat-composer"]');
  await configuredComposer.getByRole('textbox', { name: 'Message to assistant', exact: true }).fill('Build a calm product launch landing.');
  await configuredComposer.locator('button[type=submit]').click();
  const configuredChat = studioChat(configured); await showLatestThread(configured);
  await configuredChat.status('ready').waitFor(); await configuredChat.cards('diff').first().waitFor();
  await configuredChat.apply.click(); await configuredChat.status('applied').waitFor();
  await configured.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Home chat launch', exact: true }).waitFor();
  assert.equal((await metaOf(configured, 'picker/launch')).kind, 'landing');
  assert.equal(report.providerRequests, 2, 'brief generation is one agent loop: write, then validate');
  await configured.screenshot({ path: `${out}/chat-desktop.png`, fullPage: true });
  report.checks.push('creation landing brief → mocked generation (write, validate) → apply → rendered landing');
  assert.deepEqual(report.errors, []); await configured.context().close();
} catch (error) { await page?.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
