import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createStudioProject } from '../src/studio-library.js';
import { generateEditorPreview } from '@trafficops/template-runtime';
import { build } from 'vite';

// Bundled real PWA with conversations disabled at the host boundary. This keeps
// the supported OpenRouterPanel fallback covered without changing app source.
// Disposable browser storage and fully synthetic providers: zero paid calls.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || '/tmp/studio-block-ai-legacy-dist'), out = '/tmp/studio-block-ai-legacy-browser';
await mkdir(out, { recursive: true });
if (!process.argv[2]) await build({
  configFile: resolve('editor/vite.config.js'), root: resolve('editor'),
  build: { outDir: root, emptyOutDir: true },
  plugins: [{ name: 'synthetic-legacy-host', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/editor/src/hosts/LibraryHost.js')) return;
    assert.ok(code.includes('export function createLibraryHost('));
    return code.replace('export function createLibraryHost(', 'function createConversationLibraryHost(')
      + '\nexport function createLibraryHost(options) { const host = createConversationLibraryHost(options); return { ...host, conversations: undefined }; }\n';
  } }],
});
const source = `@template "Selected-block QA"
@type Comment
@param author String
@param body String
@endtype
@param headline String
@param comments Comment[]
@param email String
@block commentBody(comment: Comment)
<p data-block="Comment body">{{comment.body}}</p>
@endblock
@block commentCard(comment: Comment)
<article data-block="Comment">
<h2>{{comment.author}}</h2>
@render commentBody(comment)
</article>
@endblock
@layout
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body>
<script>addEventListener('message',event=>{if(event.data?.type==='trafficops-preview-selection-control')parent.postMessage({testSelectionControl:event.data},'*')});</script>
<h1>{{headline}}</h1>
<section data-block="Comments list">
@each comment in comments:
@render commentCard(comment)
@endeach
</section>
<form data-block="order_form"><label>Email <input value="{{email}}"></label><button type="submit">Order</button></form>
</body></html>
@endlayout
`;
const initialValues = { headline: 'Synthetic block preview', comments: [{ author: 'Ada', body: 'First saved comment' }, { author: 'Ben', body: 'Second saved comment' }, { author: 'Cy', body: 'Third saved comment' }], email: 'original@example.test', legacy: { preserve: 7 } };
const fixture = { ...createStudioProject({ kind: 'landing', name: 'Synthetic selected blocks QA', files: {
  'index.tpl': source, 'styles.css': 'body{margin:0;padding:20px;font:16px/1.5 system-ui;color:#26334a}article,form{padding:12px;border:1px solid #ccd3de;border-radius:8px;margin:10px 0}h1{font-size:24px}h2{font-size:18px;margin:0}p{margin:8px 0}input{max-width:100%}button{min-height:44px}',
  'private.txt': 'PRIVATE_OUTSIDE_BLOCK: keep this neighboring source untouched.',
}, settings: initialValues }), revision: 1 };
assert.equal(generateEditorPreview(fixture.files, initialValues).blockInstances.filter(block => block.label === 'Comment body').length, 3);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const report = { passed: false, paidRequests: 0, providerRequests: [], screenshots: [], states: [], errors: [], blockedExternalRequests: [] };
let intent = 'content', contentValue = 'Second comment edited in selected scope', failAfterWrite = false, clarifyNextPlan = false;
const userTexts = body => body.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text || '').join('\n'));
function responseTool(body, name, input) {
  const id = `synthetic-block-${report.providerRequests.length}`, call = { id, type: 'function', function: { name, arguments: JSON.stringify(input) } };
  if (!body.stream) return { status: 200, contentType: 'application/json', body: JSON.stringify({ id, model: body.model, choices: [{ index: 0, message: { role: 'assistant', tool_calls: [call] }, finish_reason: 'tool_calls' }] }) };
  return { status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ id, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n` };
}
async function syntheticResponse({ url, method, body: encoded }) {
  if (method !== 'POST' || !url.endsWith('/chat/completions')) return { status: 400, contentType: 'application/json', body: '{"error":{"message":"Unexpected API endpoint blocked by synthetic selected-block test"}}' };
  const body = JSON.parse(encoded), names = (body.tools || []).map(tool => tool.function.name);
  report.providerRequests.push({ intent, tools: names, messages: body.messages });
  if (names.includes('submit_plan')) {
    if (clarifyNextPlan) { clarifyNextPlan = false; return responseTool(body, 'submit_plan', { summary: 'Clarify how to finish the retained selected comment.', tasks: ['Confirm the final selected comment wording'], intent: 'clarify', clarification: 'What final wording should replace the retained comment draft?' }); }
    return responseTool(body, 'submit_plan', { summary: intent === 'source' ? 'Improve the selected shared comment body markup.' : 'Update only the selected second comment content.', tasks: ['Edit the selected block', 'Validate scope', 'Review changes'], intent });
  }
  if (names.includes('submit_review')) return responseTool(body, 'submit_review', { approved: true, summary: 'The requested change is present and unrelated source and saved values are preserved.', issues: [] });
  const prior = body.messages.some(message => message.role === 'assistant' && message.tool_calls?.some(call => ['set_block_value', 'replace_block'].includes(call.function.name)));
  if (prior) {
    if (failAfterWrite) return { status: 403, contentType: 'application/json', body: '{"error":{"message":"Synthetic terminal failure after completed selected-block write"}}' };
    return responseTool(body, 'validate_draft', {});
  }
  if (intent === 'content') return responseTool(body, 'set_block_value', { path: '/comments/1/body', value: contentValue });
  const prefix = 'Fixed selected-block context:\n', prompt = userTexts(body).find(text => text.includes(prefix));
  assert.ok(prompt, 'Selected source writer receives the fixed scoped context');
  const context = JSON.parse(prompt.slice(prompt.indexOf(prefix) + prefix.length).split('\n')[0]);
  const target = context.sources.find(source => source.label === 'Comment body');
  assert.ok(target, 'Synthetic source writer receives the selected source fragment');
  return responseTool(body, 'replace_block', { id: target.id, content: target.content.replace('<p ', '<p class="source-improved" ') });
}
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser, page;
const saved = () => page.evaluate(id => new Promise((resolve, reject) => {
  const open = indexedDB.open('trafficops-studio-library', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, request = db.transaction('projects', 'readonly').objectStore('projects').get(id);
    request.onerror = () => { db.close(); reject(request.error); };
    request.onsuccess = () => { db.close(); resolve({ files: request.result.files, settings: request.result.settings }); };
  };
}), fixture.id);
async function pollSaved(matches, label) {
  const deadline = Date.now() + 15000;
  do { const value = await saved(); if (matches(value)) return value; await page.waitForTimeout(100); } while (Date.now() < deadline);
  assert.fail('Durable autosave did not finish: ' + label);
}
const preview = () => page.locator('iframe.is-visible').contentFrame();
const previewSettled = () => page.locator('.preview-frame-stack[aria-busy="false"]').waitFor();
async function editorReady() {
  await page.locator('.preview-selection-toggle').waitFor();
  const collapse = page.getByRole('button', { name: 'Collapse editor', exact: true });
  if (await collapse.count()) await collapse.click();
  // Chromium defers opaque iframe animation frames while its mobile panel is
  // below the viewport; bring the preview into view before its ready handshake.
  await page.locator('.preview-panel').scrollIntoViewIfNeeded();
  await preview().getByRole('heading', { name: initialValues.headline, exact: true }).waitFor();
  await previewSettled();
  assert.ok((await page.locator('iframe.is-visible').boundingBox()).height > 200, 'The responsive preview has a drawable and clickable viewport');
}
async function selectBlocks({ multiple = false } = {}) {
  const toggle = page.getByRole('button', { name: 'Select elements', exact: true });
  await toggle.waitFor();
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  if (await page.getByRole('button', { name: 'Clear selection', exact: true }).count()) await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await previewSettled();
  await preview().locator('[data-block="Comment body"]').nth(1).click();
  await page.locator('.preview-selection-chip').filter({ hasText: 'Comment body' }).waitFor();
  await previewSettled();
  if (multiple) await preview().locator('[data-block="order_form"]').click({ position: { x: 5, y: 5 } });
  if (multiple) { await page.locator('.preview-selection-chip').filter({ hasText: 'order_form' }).waitFor(); assert.equal(await page.locator('.preview-selection-chip').count(), 2); }
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await page.getByRole('group', { name: 'Selected blocks', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create new project', exact: true }).count(), 0, 'Scoped mode hides global creation controls');
  assert.equal(await page.getByLabel('Generate images requested in the brief', { exact: true }).count(), 0, 'Scoped mode exposes no image-generation action');
}
async function generate(prompt) {
  await page.locator('.ai-prompt textarea').fill(prompt);
  await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
  const ready = page.getByRole('heading', { name: 'Changes ready', exact: true }), stopped = page.getByRole('heading', { name: 'Generation stopped', exact: true });
  await ready.or(stopped).waitFor({ timeout: 20000 });
  assert.equal(await stopped.count(), 0, await page.locator('.ai-run-summary').innerText());
  await page.getByRole('button', { name: 'Apply changes', exact: true }).waitFor();
  await page.locator('.preview-panel').scrollIntoViewIfNeeded();
}
async function capture(width, phase) {
  await page.locator('.preview-panel').scrollIntoViewIfNeeded();
  await previewSettled();
  await preview().locator('body').evaluate(() => window.scrollTo(0, 0));
  await preview().getByRole('heading', { name: initialValues.headline, exact: true }).waitFor();
  if (phase === 'source-ready') assert.equal(await preview().locator('.source-improved').count(), 3);
  if (['content-ready', 'recovered-draft', 'clarified-ready'].includes(phase)) await preview().getByText(contentValue, { exact: true }).waitFor();
  await preview().locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, chips: document.querySelectorAll('.preview-selection-chip').length, scopeVisible: Boolean(document.querySelector('.ai-block-scope')) }));
  assert.ok(metrics.documentWidth <= width + 1, `No horizontal overflow at ${width}px ${phase}`);
  const screenshot = `${out}/${width}-${phase}.png`; await page.screenshot({ path: screenshot, fullPage: true });
  report.screenshots.push(screenshot); report.states.push({ width, phase, ...metrics });
}
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390, 1280]) {
    intent = 'content'; contentValue = 'Second comment edited in selected scope'; failAfterWrite = false; clarifyNextPlan = false;
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', locale: 'en-US' });
    await context.route('**/*', async route => {
      const request = route.request(), url = request.url();
      if (url.startsWith(origin + '/')) return route.continue();
      if (url.startsWith('https://openrouter.ai/')) return route.fulfill({ ...await syntheticResponse({ url, method: request.method(), body: request.postData() }), headers: { 'Access-Control-Allow-Origin': '*' } });
      report.blockedExternalRequests.push(url); return route.abort();
    });
    page = await context.newPage(); page.on('pageerror', error => report.errors.push({ width, message: error.message }));
    await page.exposeFunction('blockSyntheticResponse', syntheticResponse);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
      window.blockBridgeLog = [];
      addEventListener('message', event => { if (event.data?.type?.startsWith('trafficops-preview-') || event.data?.testSelectionControl) window.blockBridgeLog.push({ data: event.data, visible: event.source === document.querySelector('iframe.is-visible')?.contentWindow }); });
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (url, options = {}) => {
        if (!String(url).startsWith('https://openrouter.ai/')) return nativeFetch(url, options);
        const response = await window.blockSyntheticResponse({ url: String(url), method: options.method || 'GET', body: options.body });
        return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.contentType } });
      };
    });
    await page.goto(origin); await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
    await page.evaluate(async fixture => {
      const open = (name, initialize) => new Promise((resolve, reject) => { const request = indexedDB.open(name, 1); request.onupgradeneeded = () => initialize?.(request.result); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
      const library = await open('trafficops-studio-library');
      await new Promise((resolve, reject) => { const tx = library.transaction(['projects', 'preferences'], 'readwrite'); tx.objectStore('projects').put(fixture); tx.objectStore('preferences').put(fixture.id, 'active-project'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); library.close();
      const connection = await open('trafficops-template-studio-ai', db => db.createObjectStore('settings', { keyPath: 'id' }));
      await new Promise((resolve, reject) => { const tx = connection.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-block-key-zero-paid-requests', model: 'test/block-language-model', imageModel: '' }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); connection.close();
    }, fixture);
    await page.reload(); await editorReady();
    const baseline = await saved();
    assert.equal(await page.locator('.preview-selection-toggle').getAttribute('aria-pressed'), 'false');
    await selectBlocks({ multiple: true });
    const frozenLabels = await page.locator('.ai-block-scope li').allTextContents();
    await preview().locator('[data-block="Comment body"]').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.preview-selection-chip').length === 1);
    assert.deepEqual(await page.locator('.ai-block-scope li').allTextContents(), frozenLabels, 'Changing preview selection retains the explicit assistant restriction');
    assert.equal(await page.getByRole('button', { name: 'Edit project', exact: true }).count(), 0, 'Preview selection changes never silently switch to ordinary editing');
    await previewSettled();
    await preview().locator('[data-block="Comment body"]').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.preview-selection-chip').length === 2);
    await capture(width, 'content-prompt');
    const callStart = report.providerRequests.length;
    await generate('Change only the second comment body to the requested new text. Preserve all other comments, the form and template.');
    await preview().getByText(contentValue, { exact: true }).waitFor();
    assert.deepEqual(await saved(), baseline, 'Reviewed content remains a draft until Apply');
    const contentRequests = report.providerRequests.slice(callStart);
    assert.deepEqual(contentRequests.map(request => request.tools.includes('submit_plan') ? 'plan' : request.tools.includes('submit_review') ? 'review' : 'write'), ['plan', 'write', 'write', 'review']);
    assert.ok(contentRequests[1].tools.includes('set_block_value') && !contentRequests[1].tools.includes('replace_block'), 'Content intent exposes only scoped leaf writes');
    await capture(width, 'content-ready');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    const contentSaved = await pollSaved(value => value.settings.comments[1].body === contentValue, 'selected content Apply');
    const expectedValues = structuredClone(initialValues); expectedValues.comments[1].body = contentValue;
    assert.deepEqual(contentSaved.settings, expectedValues); assert.deepEqual(contentSaved.files, baseline.files);
    const beforeReload = report.providerRequests.length;
    await page.reload(); await editorReady(); await preview().getByText(contentValue, { exact: true }).waitFor();
    assert.equal(report.providerRequests.length, beforeReload, 'Reload never resumes generation automatically');
    assert.equal(await page.locator('.preview-selection-toggle').getAttribute('aria-pressed'), 'false');

    // A source fragment is shared: editing one rendered body updates all three.
    intent = 'source'; await selectBlocks();
    await generate('Add the source-improved class to the shared comment body template for every instance. Preserve all content.');
    await page.waitForFunction(() => document.querySelector('iframe.is-visible'));
    await preview().locator('.source-improved').nth(2).waitFor();
    assert.equal(await preview().locator('.source-improved').count(), 3);
    assert.deepEqual(await saved(), contentSaved, 'Reviewed source is not saved before Apply');
    await capture(width, 'source-ready');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    const sourceSaved = await pollSaved(value => value.files['index.tpl'].includes('class="source-improved"'), 'shared source Apply');
    assert.deepEqual(sourceSaved.settings, expectedValues);
    assert.equal(sourceSaved.files['styles.css'], baseline.files['styles.css']); assert.equal(sourceSaved.files['private.txt'], baseline.files['private.txt']);
    assert.equal(sourceSaved.files['index.tpl'], source.replace('<p data-block="Comment body">', '<p class="source-improved" data-block="Comment body">'));

    // Recovery must retain the frozen block scope and keep the saved project intact.
    await page.reload(); await editorReady();
    intent = 'content'; contentValue = 'Recoverable selected comment draft'; failAfterWrite = true; await selectBlocks();
    await page.locator('.ai-prompt textarea').fill('Change only the second selected comment body to a recoverable draft.');
    await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
    await page.getByRole('heading', { name: 'Draft needs attention', exact: true }).waitFor({ timeout: 20000 });
    await page.getByText('Completed draft saved on this device for recovery after reload.', { exact: true }).waitFor();
    assert.deepEqual(await saved(), sourceSaved);
    const recoveryCalls = report.providerRequests.length;
    await page.reload(); await editorReady();
    await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
    await page.getByRole('heading', { name: 'Draft needs attention', exact: true }).waitFor();
    await page.getByRole('group', { name: 'Selected blocks', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Remove editing restriction', exact: true }).isDisabled(), true);
    assert.equal(report.providerRequests.length, recoveryCalls, 'Recovery restores the scoped draft without provider calls');
    await page.locator('.preview-panel').scrollIntoViewIfNeeded();
    await preview().getByText(contentValue, { exact: true }).waitFor(); await capture(width, 'recovered-draft');
    // A clarifying continuation retains completed work and its original scope.
    failAfterWrite = false; clarifyNextPlan = true;
    await page.getByRole('button', { name: 'Continue generation', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'What final wording should replace the retained comment draft?' }).waitFor();
    await page.getByLabel('Clarify the retained draft', { exact: true }).waitFor();
    await page.locator('.preview-panel').scrollIntoViewIfNeeded();
    await preview().getByText(contentValue, { exact: true }).waitFor();
    await page.getByRole('group', { name: 'Selected blocks', exact: true }).waitFor();
    assert.deepEqual(await saved(), sourceSaved, 'Clarifying a retained draft preserves durable source and values');
    contentValue = 'Confirmed selected comment after clarification';
    const answer = 'Keep the same selected second comment and use the confirmed final wording.';
    await page.getByLabel('Clarify the retained draft', { exact: true }).fill(answer);
    await page.getByRole('button', { name: 'Send clarification', exact: true }).click();
    await page.getByRole('heading', { name: 'Changes ready', exact: true }).waitFor({ timeout: 20000 });
    await page.locator('.preview-panel').scrollIntoViewIfNeeded(); await preview().getByText(contentValue, { exact: true }).waitFor();
    assert.ok(report.providerRequests.some(request => JSON.stringify(request.messages).includes(answer)), 'Continuation receives the clarification inside the frozen scope');
    await capture(width, 'clarified-ready');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.locator('.preview-panel').scrollIntoViewIfNeeded();
    await previewSettled();
    await preview().getByText(expectedValues.comments[1].body, { exact: true }).waitFor();
    assert.deepEqual(await saved(), sourceSaved, 'Discard preserves saved source and raw values');
    await page.reload(); await editorReady(); await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: 'Changes ready', exact: true }).count(), 0, 'Discard clears durable recovery');
    await context.close(); page = null;
  }
  assert.deepEqual(report.errors, []);
  assert.equal(JSON.stringify(report.providerRequests).includes('PRIVATE_OUTSIDE_BLOCK'), false, 'Unrelated file contents do not enter initial scoped context');
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: legacy-host scoped multi-selection, nested @each/@render values, content/source tools, independent review, shared source instances, Apply/autosave/reload, frozen scope retention/recovery/clarification, Discard, and 390/1280px screenshots. Zero paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }); console.error((await page.locator('body').innerText()).slice(-12000)); console.error(JSON.stringify(await page.evaluate(() => ({ bridgeLog: window.blockBridgeLog, frames: [...document.querySelectorAll('.preview-frame-stack,iframe')].map(element => ({ tag: element.tagName, class: element.className, rect: JSON.stringify(element.getBoundingClientRect()), style: ['display','opacity','height','width'].map(key => [key,getComputedStyle(element)[key]]) })) })))); console.error(JSON.stringify(await Promise.all(page.frames().slice(1).map(async frame => ({ url: frame.url(), text: (await frame.locator('body').innerText().catch(String)).slice(0,1000), headings: await frame.locator('h1').evaluateAll(elements => elements.map(element => ({ text:element.textContent, rect:JSON.stringify(element.getBoundingClientRect()), display:getComputedStyle(element).display }))).catch(String) }))))); }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
