import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { generateProject } from '@trafficops/template-runtime';
import { createStudioProject } from '../src/studio-library.js';
import { createSyntheticOpenRouter } from './ai-live-check.mjs';
import { OPTIHEART_BRIEF, optiheartInitialProject, optiheartCompletedValues, inspectOptiheartDraft } from './support/optiheart-ai-case.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist'), initial = optiheartInitialProject();
const fixture = { ...createStudioProject({ kind: 'landing', name: 'Synthetic OptiHeart full brief QA', files: initial.files, settings: initial.values }), revision: 1 };
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
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
const errors = [], requests = [], screenshots = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const syntheticFetch = createSyntheticOpenRouter({ initial, mode: 'edit' });
  async function syntheticResponse({ url, method, body }) {
    if (method !== 'POST' || !url.endsWith('/chat/completions')) return { status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Unexpected API endpoint blocked by synthetic browser test.' } }) };
    const metadata = JSON.parse(body);
    requests.push({ model: metadata.model, toolChoice: metadata.tool_choice, tools: metadata.tools.map(tool => tool.function.name) });
    if (reflectProviderError) return { status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: `Provider reflected input: ${key} ${privateMarkers.join(' ')}`, metadata: { provider_name: 'SyntheticProvider' } } }) };
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
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url, options);
      const response = await window.syntheticOpenRouterResponse({ url: String(url), method: options.method || 'GET', body: options.body });
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.contentType } });
    };
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin); await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await page.evaluate(async ({ fixture, key }) => {
    async function open(name, initialize) {
      return new Promise((resolve, reject) => { const request = indexedDB.open(name, 1); request.onupgradeneeded = () => initialize?.(request.result); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    }
    const library = await open('trafficops-studio-library');
    await new Promise((resolve, reject) => { const transaction = library.transaction(['projects', 'preferences'], 'readwrite'); transaction.objectStore('projects').put(fixture); transaction.objectStore('preferences').put(fixture.id, 'active-project'); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); library.close();
    const connection = await open('trafficops-template-studio-ai', db => db.createObjectStore('settings', { keyPath: 'id' }));
    await new Promise((resolve, reject) => { const transaction = connection.transaction('settings', 'readwrite'); transaction.objectStore('settings').put({ id: 'openrouter', apiKey: key, model: 'xiaomi/mimo-v2.6-flash', imageModel: '' }); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); connection.close();
  }, { fixture, key });
  await page.reload();
  const collapse = page.getByRole('button', { name: 'Collapse editor', exact: true }); if (await collapse.count()) await collapse.click();
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.locator('.ai-prompt textarea').fill(OPTIHEART_BRIEF);
  await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
  await page.getByText('Changes ready', { exact: true }).waitFor();
  const frame = page.locator('.browser-frame iframe.is-visible').contentFrame();
  await frame.getByRole('heading', { name: optiheartCompletedValues.headline, exact: true }).waitFor();
  assert.equal(await frame.locator('[data-video-placeholder]').count(), 3);
  assert.equal(await frame.locator('html').getAttribute('lang'), 'pl');
  const readSaved = () => page.evaluate(id => new Promise((resolve, reject) => { const open = indexedDB.open('trafficops-studio-library', 1); open.onsuccess = () => { const db = open.result, tx = db.transaction('projects'), get = tx.objectStore('projects').get(id); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close(); }; open.onerror = () => reject(open.error); }), fixture.id);
  assert.deepEqual((await readSaved()).settings, initial.values, 'reviewing generated source and values must not autosave before Apply');
  assert.deepEqual((await readSaved()).files, initial.files);
  await page.locator('.ai-diagnostics summary').click();
  const diagnosticDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostic log', exact: true }).click();
  const diagnosticText = await readFile(await (await diagnosticDownload).path(), 'utf8'), diagnosticLog = JSON.parse(diagnosticText);
  assert.equal(diagnosticText.includes(key), false); assert.equal(diagnosticText.includes(OPTIHEART_BRIEF), false);
  assert.equal(diagnosticText.includes(initial.files['index.tpl']), false); assert.equal(diagnosticText.includes(optiheartCompletedValues.intro), false);
  assert.equal(diagnosticLog.model, 'xiaomi/mimo-v2.6-flash'); assert.equal(diagnosticLog.events.at(-1).type, 'run-finished');
  assert.ok(diagnosticLog.events.some(event => event.type === 'request-start' && event.requestBytes > 0));
  await writeFile('/tmp/studio-optiheart-browser-diagnostics.json', diagnosticText);
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const saveDeadline = Date.now() + 10000;
  while ((await readSaved()).settings.headline !== optiheartCompletedValues.headline && Date.now() < saveDeadline) await page.waitForTimeout(100);
  const saved = await readSaved(); assert.deepEqual(saved.settings, optiheartCompletedValues); assert.equal(saved.files['script.js'], initial.files['script.js']);
  assert.equal(inspectOptiheartDraft({ files: saved.files, values: saved.settings }).checks.noMissingLocalAssets, true);
  const count = requests.length;
  await page.reload(); await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: optiheartCompletedValues.headline, exact: true }).waitFor();
  assert.deepEqual((await readSaved()).settings, optiheartCompletedValues); assert.equal(requests.length, count, 'reload does not restart generation');
  generated = generateProject(saved.files, saved.settings, { locale: 'pl' });
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
  assert.ok(requests.length <= 6);
  // An upstream provider may reflect input in its freeform error. The UI can
  // present the provider explanation, but downloadable logs must stay private.
  reflectProviderError = true;
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.locator('.ai-prompt textarea').fill(OPTIHEART_BRIEF);
  await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.locator('.ai-diagnostics summary').click();
  const failureDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostic log', exact: true }).click();
  const failureText = await readFile(await (await failureDownload).path(), 'utf8'), failureLog = JSON.parse(failureText);
  assert.equal(failureText.includes(key), false);
  for (const marker of privateMarkers) assert.equal(failureText.includes(marker), false, 'provider-reflected prompt/source fragments are excluded from diagnostic export');
  assert.ok(failureLog.events.some(event => event.statusCode === 403 || event.status === 403));
  assert.equal(requests.length, count + 1, 'a terminal 403 is never retried');
  assert.deepEqual((await readSaved()).settings, saved.settings, 'provider failure preserves saved content');
  await writeFile('/tmp/studio-optiheart-browser-error-diagnostics.json', failureText);
  assert.deepEqual(errors, []);
  await writeFile('/tmp/studio-optiheart-browser-report.json', JSON.stringify({ passed: true, kind: 'synthetic isolated PWA browser integration', paidRequests: 0, providerCalls: requests.length, requests, viewports: viewportResults, screenshots }, null, 2));
  console.log('PASS: complete OptiHeart brief, source + saved Polish values, independent review, 3 video placeholders, Apply/autosave/reload, private success/error diagnostic downloads, terminal 403, 390/1280px layout. Zero paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path: '/tmp/studio-optiheart-browser-failure.png', fullPage: true }); console.error((await page.locator('.ai-panel').innerText().catch(() => page.locator('body').innerText())).slice(-10000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
