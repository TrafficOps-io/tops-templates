import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

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
let browser, currentPage;
const providerCalls = [], errors = [];
async function openTestPage() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage(); currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('captureProviderCall', value => providerCalls.push(value));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const realFetch = window.fetch.bind(window);
    window.libraryAiTest = { step: 0, outcome: 'success', release: null };
    window.readStudioRecords = async () => {
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('trafficops-studio-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = database.transaction('projects').objectStore('projects').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
      finally { database.close(); }
    };
    window.fetch = async (url, options = {}) => {
      if (!String(url).includes('openrouter.ai/api/v1/')) return realFetch(url, options);
      if (!String(url).endsWith('/chat/completions')) return Response.json({ data: {} });
      const test = window.libraryAiTest, step = ++test.step, body = JSON.parse(options.body);
      const records = await window.readStudioRecords();
      await window.captureProviderCall({ step, outcome: test.outcome, body, records });
      if (test.outcome === 'error' && step === 2) return Response.json({ error: { message: 'Mock provider unavailable after completed file', code: 503 } }, { status: 503 });
      const content = '@template "AI studio"\n@section content "Content"\n@param title String = "AI studio launch" label="Title" required\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title></head><body><main><h1>{{title}}</h1><p>Created from the saved brief.</p></main></body></html>\n@endlayout\n';
      const call = step === 1 ? ['set_file', { path: 'index.tpl', content }] : step === 2 ? ['validate_draft', {}] : null;
      return new Response(new ReadableStream({ start(controller) {
        const send = value => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
        const delta = value => send({ id: `library-${step}`, model: 'test/model', choices: [{ index: 0, delta: value, finish_reason: null }] });
        const finish = reason => { send({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }); controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); };
        options.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Aborted', 'AbortError')); } catch {} }, { once: true });
        if (!call) { delta({ content: 'The requested landing is ready to review.' }); finish('stop'); return; }
        const input = JSON.stringify(call[1]);
        delta({ role: 'assistant', tool_calls: [{ index: 0, id: `library-call-${step}`, type: 'function', function: { name: call[0], arguments: '' } }] });
        if (step === 1) {
          delta({ tool_calls: [{ index: 0, function: { arguments: input.slice(0, -2) } }] });
          test.release = () => { delta({ tool_calls: [{ index: 0, function: { arguments: input.slice(-2) } }] }); finish('tool_calls'); };
        } else { delta({ tool_calls: [{ index: 0, function: { arguments: input } }] }); finish('tool_calls'); }
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  return page;
}
async function createAiProject(page, name, prompt) {
  await page.getByRole('button', { name: 'Create with AI Describe it. Build it together.', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: /^Describe your project/ }).fill(prompt);
  await dialog.getByRole('button', { name: 'Create with AI', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.ai-prompt textarea').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
}
async function configureTestKey(page) {
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('trafficops-template-studio-ai', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { await new Promise((resolve, reject) => { const transaction = database.transaction('settings', 'readwrite'); transaction.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-key-never-sent-to-provider', model: 'test/model', imageModel: '' }); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); }
    finally { database.close(); }
  });
}
const records = page => page.evaluate(() => window.readStudioRecords());
async function waitForSaved(page, name, expected) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const record = (await records(page)).find(record => record.name === name);
    if (record?.files['index.tpl'].includes(expected)) return record;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${name} to autosave.`);
}
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });

  // Missing credentials still creates a recoverable draft and keeps its brief.
  const unconfigured = await openTestPage(), pendingPrompt = 'A calm ceramics landing with a gallery and booking link.';
  await createAiProject(unconfigured, 'Pending ceramics', pendingPrompt);
  await unconfigured.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await unconfigured.locator('.ai-prompt textarea').inputValue(), pendingPrompt);
  assert.equal(providerCalls.length, 0);
  let pending = (await records(unconfigured))[0];
  assert.equal(pending.aiPrompt, pendingPrompt); assert.equal(pending.aiStarted, false); assert.equal(pending.kind, 'landing');
  await unconfigured.getByRole('button', { name: 'Settings', exact: true }).click();
  await unconfigured.locator('.ai-settings input[type=password]').waitFor();
  await unconfigured.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  await unconfigured.reload();
  await unconfigured.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await unconfigured.locator('.ai-prompt textarea').waitFor();
  assert.equal(await unconfigured.locator('.ai-prompt textarea').inputValue(), pendingPrompt);
  assert.equal(providerCalls.length, 0);
  await unconfigured.context().close();

  // The creation handoff claims storage before the first provider fetch.
  const page = await openTestPage(); await configureTestKey(page);
  const prompt = 'Create a studio launch landing with a clear heading and introductory copy.';
  await createAiProject(page, 'AI launch', prompt);
  await page.getByLabel('Live file changes', { exact: true }).filter({ hasText: 'AI studio launch' }).waitFor();
  assert.equal(providerCalls.length, 1);
  const claimed = providerCalls[0].records.find(record => record.name === 'AI launch');
  assert.equal(claimed.aiStarted, true); assert.equal(claimed.revision, 2); assert.equal(claimed.aiPrompt, prompt);
  assert.ok(providerCalls[0].body.messages.some(message => JSON.stringify(message.content).includes(prompt)));
  assert.equal(await page.getByRole('dialog', { name: 'Create new project', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Apply changes', exact: true }).count(), 0);
  assert.ok((await records(page))[0].files['index.tpl'].includes('Your next idea'), 'partial stream never replaces the stored starter');
  await page.evaluate(() => window.libraryAiTest.release());
  await page.getByText('Changes ready', { exact: true }).waitFor();
  await page.locator('.browser-frame iframe').contentFrame().getByRole('heading', { name: 'AI studio launch', exact: true }).waitFor();
  assert.equal(providerCalls.length, 3);
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const saved = await waitForSaved(page, 'AI launch', 'AI studio launch'); assert.equal(saved.revision, 3);
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.locator('.ai-prompt textarea').waitFor();
  await page.waitForTimeout(800);
  assert.equal(providerCalls.length, 3, 'reload never restarts a paid generation');
  assert.equal(await page.locator('.ai-prompt textarea').inputValue(), prompt);
  await page.locator('.browser-frame iframe').contentFrame().getByRole('heading', { name: 'AI studio launch', exact: true }).waitFor();

  // Cancelling first-generation streaming keeps the original independent draft.
  await page.getByRole('button', { name: 'Library', exact: true }).first().click();
  await page.evaluate(() => { Object.assign(window.libraryAiTest, { step: 0, outcome: 'cancel' }); });
  await createAiProject(page, 'Cancelled creation', 'A project whose creation will be cancelled.');
  await page.getByLabel('Live file changes', { exact: true }).filter({ hasText: 'AI studio launch' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Generation cancelled. Your project is unchanged.' }).waitFor();
  const cancelled = (await records(page)).find(record => record.name === 'Cancelled creation');
  assert.equal(cancelled.aiStarted, true); assert.equal(cancelled.revision, 2);
  assert.ok(cancelled.files['index.tpl'].includes('Your next idea'));
  assert.equal(providerCalls.length, 4);

  // A later provider failure retains completed generated source for review.
  await page.getByRole('button', { name: 'Library', exact: true }).first().click();
  await page.evaluate(() => { Object.assign(window.libraryAiTest, { step: 0, outcome: 'error' }); });
  await createAiProject(page, 'Recovered creation', 'Keep completed files when the mocked provider fails.');
  await page.getByLabel('Live file changes', { exact: true }).filter({ hasText: 'AI studio launch' }).waitFor();
  await page.evaluate(() => window.libraryAiTest.release());
  await page.getByText('Draft needs attention', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Keep draft in editor', exact: true }).waitFor();
  assert.ok((await records(page)).find(record => record.name === 'Recovered creation').files['index.tpl'].includes('Your next idea'));
  await page.getByRole('button', { name: 'Keep draft in editor', exact: true }).click();
  await waitForSaved(page, 'Recovered creation', 'AI studio launch');
  assert.equal(providerCalls.length, 6, 'provider failures do not automatically repeat requests');
  assert.deepEqual(errors, []);
  console.log('PASS: library AI creation, persisted one-shot claim before fetch, streamed review/apply/autosave, reload without requests, missing-key Settings recovery, cancel and retained failed draft.');
} catch (error) {
  await currentPage?.screenshot({ path: '/tmp/library-ai-browser-error.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
