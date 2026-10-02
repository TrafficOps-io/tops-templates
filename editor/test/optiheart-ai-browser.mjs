import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { generateProject } from '@trafficops/template-runtime';
import { configureAi, installFolderPicker, readProjectFolder, seedAndOpen } from './support/studio-folders.js';
import { studioChat } from './support/studio-chat.js';
import { createSyntheticOpenRouter } from './ai-live-check.mjs';
import { OPTIHEART_BRIEF, optiheartInitialProject, optiheartCompletedValues, inspectOptiheartDraft } from './support/optiheart-ai-case.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist'), initial = optiheartInitialProject();
const fixture = { kind: 'landing', name: 'Synthetic OptiHeart full brief QA', files: initial.files, values: initial.values };
const key = 'mock-optiheart-browser-no-paid-requests';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
let generated, reflectProviderError = false;
const privateMarkers = ['SYNTHETIC_PRIVATE_PROMPT_FRAGMENT', 'SYNTHETIC_PRIVATE_SOURCE_FRAGMENT'];
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path.startsWith('/result/')) {
      const file = path.slice('/result/'.length), content = generated?.[file];
      if (content === undefined) throw new Error('Not generated');
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(content); return;
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(content);
  } catch { if (!response.headersSent) response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
const errors = [], requests = [], screenshots = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await installFolderPicker(context);
  const syntheticFetch = createSyntheticOpenRouter({ initial, mode: 'edit' });
  async function syntheticResponse({ url, method, body }) {
    if (method !== 'POST' || !url.endsWith('/chat/completions')) return { status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Unexpected API endpoint blocked by synthetic browser test.' } }) };
    const metadata = JSON.parse(body);
    requests.push({ model: metadata.model, toolChoice: metadata.tool_choice, tools: metadata.tools.map(tool => tool.function.name) });
    if (reflectProviderError) return { status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: `Provider reflected input: ${key} ${privateMarkers.join(' ')}`, metadata: { provider_name: 'SyntheticProvider' } } }) };
    // The conversation runtime routes a project-scope request first (select_intent); this brief needs source changes.
    if (metadata.tools.some(tool => tool.function.name === 'select_intent')) {
      const call = { id: 'route', type: 'function', function: { name: 'select_intent', arguments: JSON.stringify({ intent: 'source' }) } };
      if (!metadata.stream) return { status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'gen-synthetic-route', object: 'chat.completion', created: 0, model: metadata.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
      const payload = { id: 'gen-synthetic-route', model: metadata.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }] };
      return { status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` };
    }
    const response = await syntheticFetch(url, { body });
    return { status: response.status, contentType: response.headers.get('Content-Type'), body: await response.text() };
  }
  // Every OpenRouter URL is intercepted, including unexpected endpoints. A
  // request cannot escape to the real API even if production code changes.
  await context.route('https://openrouter.ai/**', async route => {
    const request = route.request();
    const response = await syntheticResponse({ url: request.url(), method: request.method(), body: request.postData() });
    await route.fulfill({ ...response, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('syntheticOpenRouterResponse', syntheticResponse);
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url, options);
      const response = await window.syntheticOpenRouterResponse({ url: String(url), method: options.method || 'GET', body: options.body });
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.contentType } });
    };
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin); await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await configureAi(page, { apiKey: key, model: 'xiaomi/mimo-v2.6-flash' });
  const seeded = await seedAndOpen(page, fixture);
  const collapse = page.getByRole('button', { name: 'Collapse editor', exact: true }); if (await collapse.count()) await collapse.click();
  // The former "Edit project" mode is the default "Project" scope of the composer.
  const chat = studioChat(page); await chat.root.waitFor();
  await chat.scope.getByRole('button', { name: 'Project', pressed: true, exact: true }).waitFor();
  await chat.prompt.fill(OPTIHEART_BRIEF);
  await chat.send.click();
  await chat.status('ready').waitFor({ timeout: 60000 }).catch(async error => { console.log('REQ', JSON.stringify(requests)); throw error; });
  await chat.status('ready').getByRole('button', { name: 'Preview draft', exact: true }).click();
  const frame = page.locator('.browser-frame iframe.is-visible').contentFrame();
  await frame.getByRole('heading', { name: optiheartCompletedValues.headline, exact: true }).waitFor();
  assert.equal(await frame.locator('[data-video-placeholder]').count(), 3);
  assert.equal(await frame.locator('html').getAttribute('lang'), 'pl');
  // The project folder as saved: { files, values, … }.
  const readSaved = () => readProjectFolder(page, seeded.folder);
  assert.deepEqual((await readSaved()).values, initial.values, 'reviewing generated source and values must not autosave before Apply');
  assert.deepEqual((await readSaved()).files, initial.files);
  await chat.status('ready').locator('[data-testid="studio-chat-apply"]').click();
  const saveDeadline = Date.now() + 10000;
  while ((await readSaved()).values.headline !== optiheartCompletedValues.headline && Date.now() < saveDeadline) await page.waitForTimeout(100);
  const saved = await readSaved(); assert.deepEqual(saved.values, optiheartCompletedValues); assert.equal(saved.files['script.js'], initial.files['script.js']);
  assert.equal(inspectOptiheartDraft({ files: saved.files, values: saved.values }).checks.noMissingLocalAssets, true);
  const count = requests.length;
  await page.reload(); await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: optiheartCompletedValues.headline, exact: true }).waitFor();
  assert.deepEqual((await readSaved()).values, optiheartCompletedValues); assert.equal(requests.length, count, 'reload does not restart generation');
  generated = generateProject(saved.files, saved.values, { locale: 'pl' });
  const viewportResults = [];
  // Render the saved output outside Studio's service-worker scope. Workbox's
  // SPA navigation fallback would otherwise replace /result/index.html.
  const renderContext = await browser.newContext();
  await renderContext.route('https://openrouter.ai/**', route => route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":{"message":"Unexpected API request blocked"}}' }));
  for (const width of [390, 1280]) {
    const renderedPage = await renderContext.newPage();
    await renderedPage.setViewportSize({ width, height: 900 });
    renderedPage.on('pageerror', error => errors.push(error.message));
    await renderedPage.goto(origin + '/result/index.html');
    const metrics = await renderedPage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, language: document.documentElement.lang, boxes: [...document.querySelectorAll('[data-video-placeholder]')].map(element => { const bounds = element.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, content: [...element.querySelectorAll('figcaption,p')].map(child => { const content = child.getBoundingClientRect(); return { top: content.top, right: content.right, bottom: content.bottom, left: content.left }; }) }; }), cta: [...document.querySelectorAll('a')].find(anchor => anchor.textContent.trim() === 'Dowiedz się więcej')?.getBoundingClientRect().height }));
    assert.equal(metrics.language, 'pl'); assert.equal(metrics.boxes.length, 3); assert.ok(metrics.scrollWidth <= width + 1, `no horizontal scrolling at ${width}px`);
    for (const box of metrics.boxes) {
      assert.ok(box.width > 100 && box.height > 100); assert.ok(box.left >= 0 && box.right <= width + 1);
      for (const content of box.content) assert.ok(content.top >= box.top && content.bottom <= box.bottom && content.left >= box.left && content.right <= box.right, `video placeholder caption and description stay inside their box at ${width}px`);
    }
    assert.ok(metrics.cta >= 44, 'CTA has a usable touch target');
    const screenshot = `/tmp/studio-optiheart-${width}.png`; await renderedPage.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot);
    viewportResults.push(metrics); await renderedPage.close();
  }
  await renderContext.close();
  assert.ok(requests.filter(request => !request.tools.includes('select_intent')).length <= 6, 'the generation workflow stays within six provider calls (routing excluded)');
  // An upstream provider may reflect input in its freeform error. The UI can
  // present the provider explanation, but downloadable logs must stay private.
  reflectProviderError = true;
  // Diagnostics of a failed run: status "failed" with the provider explanation as the run message (the downloadable
  // diagnostic log of the former assistant panel is gone); the API key never reaches the conversation.
  await chat.root.waitFor();
  await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'More actions', exact: true }).waitFor();
  await chat.prompt.fill(OPTIHEART_BRIEF);
  await chat.send.click();
  const failed = chat.status('failed'); await failed.waitFor({ timeout: 30000 });
  const failureMessage = await failed.locator('.studio-chat-run-message').innerText();
  assert.ok(failureMessage.length > 0, 'a failed run explains the provider error');
  assert.equal((await chat.root.innerText()).includes(key), false, 'the API key is never shown in the conversation');
  await writeFile('/tmp/studio-optiheart-browser-error-message.txt', failureMessage);
  assert.equal(requests.length, count + 1, 'a terminal 403 is never retried');
  assert.deepEqual((await readSaved()).values, saved.values, 'provider failure preserves saved content');
  assert.deepEqual(errors, []);
  await writeFile('/tmp/studio-optiheart-browser-report.json', JSON.stringify({ passed: true, kind: 'synthetic isolated browser integration', paidRequests: 0, providerCalls: requests.length, requests, viewports: viewportResults, screenshots }, null, 2));
  console.log('PASS: complete OptiHeart brief, source + saved Polish values, independent review, 3 video placeholders, Apply/autosave/reload, failed-run message without the API key, terminal 403, 390/1280px layout. Zero paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path: '/tmp/studio-optiheart-browser-failure.png', fullPage: true }); console.error((await page.locator('[data-testid="studio-chat"]').innerText().catch(() => page.locator('body').innerText())).slice(-10000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
