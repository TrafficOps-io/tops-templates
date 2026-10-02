import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { readZipProject } from '@trafficops/template-editor-core';
import { studioChat } from './support/studio-chat.js';

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page; const errors = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } }); page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); }); page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.mockAi = { stages: {}, release: {}, calls: [] };
    window.readStore = async (name, store) => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); }
    };
    const realFetch = fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      if (!String(url).includes('openrouter.ai/api/v1/')) return realFetch(url, options);
      if (!String(url).endsWith('/chat/completions')) return Response.json({ data: {} });
      const body = JSON.parse(options.body), source = JSON.stringify(body.messages), key = ['TASK_A', 'TASK_B', 'TASK_STOP', 'TASK_RELOAD'].find(key => source.includes(key)) || 'OTHER';
      const names = (body.tools || []).map(item => item.function.name), single = names.length === 1 ? names[0] : null;
      window.mockAi.calls.push({ key, single, names });
      const args = single === 'select_intent' ? { intent: 'source' } : single === 'submit_plan' ? { summary: `Plan ${key}`, tasks: ['Add the requested stylesheet'] } : single === 'submit_review' ? { approved: true, summary: `Reviewed ${key}`, issues: [] } : null;
      let call;
      if (args) call = [single, args];
      else {
        const step = window.mockAi.stages[key] = (window.mockAi.stages[key] || 0) + 1;
        call = step === 1 ? ['set_file', { path: key === 'TASK_B' ? 'b.css' : 'a.css', content: key === 'TASK_B' ? 'h2 { color: blue; }' : 'h1 { color: red; }' }] : step === 2 ? ['validate_draft', {}] : null;
      }
      if (body.stream !== true) return Response.json({ id: `${key}-response`, model: 'test/model', choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: `${key}-route`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
      return new Response(new ReadableStream({ start(controller) {
        const send = value => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
        const delta = value => send({ id: key, model: 'test/model', choices: [{ index: 0, delta: value, finish_reason: null }] });
        const finish = reason => { send({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }); controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); };
        options.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Stopped', 'AbortError')); } catch {} }, { once: true });
        if (!call) { delta({ content: `${key} is ready.` }); finish('stop'); return; }
        const encoded = JSON.stringify(call[1]);
        delta({ role: 'assistant', tool_calls: [{ index: 0, id: `${key}-${window.mockAi.calls.length}`, type: 'function', function: { name: call[0], arguments: '' } }] });
        if (call[0] === 'set_file') {
          delta({ tool_calls: [{ index: 0, function: { arguments: encoded.slice(0, -2) } }] });
          window.mockAi.release[key] = () => { delta({ tool_calls: [{ index: 0, function: { arguments: encoded.slice(-2) } }] }); finish('tool_calls'); };
        } else { delta({ tool_calls: [{ index: 0, function: { arguments: encoded } }] }); finish('tool_calls'); }
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.library').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('trafficops-template-studio-ai', 1); req.onupgradeneeded = () => req.result.createObjectStore('settings', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-key-never-sent', model: 'test/model', imageModel: '' }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  });
  async function newBlank(name) {
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
    await dialog.getByRole('button', { name: 'From scratch', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create landing', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.locator('.editor-shell.is-app').waitFor();
  }
  const records = () => page.evaluate(() => window.readStore('trafficops-studio-library', 'projects'));
  const docs = () => page.evaluate(() => window.readStore('trafficops-studio-conversations', 'documents'));
  async function waitDoc(predicate, label) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const documents = await docs(); if (predicate(documents)) return documents; await page.waitForTimeout(60); }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await docs())}`);
  }
  const chat = studioChat(page);
  // Opens a conversation whose title contains `text`: from the list when shown, otherwise from the header menu (chat narrower than 560 px).
  async function openThreadWith(text) {
    if (await chat.threads.isVisible()) return chat.threads.locator('.studio-chat-threads-open').filter({ hasText: text }).click();
    await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'Conversations', exact: true }).click();
    await chat.root.locator('.studio-chat-header').getByRole('menuitem').filter({ hasText: text }).click();
  }
  async function newConversation() {
    if (await chat.threads.isVisible()) return chat.threads.getByRole('button', { name: 'New conversation', exact: true }).click();
    await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'Conversations', exact: true }).click();
    await chat.root.locator('.studio-chat-header').getByRole('menuitem', { name: 'New conversation', exact: true }).click();
  }
  await newBlank('Parallel project');
  assert.equal(await page.getByRole('button', { name: 'Collapse editor', exact: true }).count(), 0);
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click(); await chat.root.waitFor();
  await chat.prompt.fill('TASK_A Add a.css and leave the page intact.');
  await chat.send.click();
  await page.waitForFunction(() => Boolean(window.mockAi.release.TASK_A));
  await newConversation(); await chat.root.getByRole('heading', { name: 'New conversation', exact: true }).waitFor();
  await chat.prompt.fill('TASK_B Add b.css and leave the page intact.');
  await chat.send.click();
  await page.waitForFunction(() => Boolean(window.mockAi.release.TASK_B));
  await waitDoc(list => list[0].runs.filter(run => run.state === 'running').length === 2, 'two concurrent runs');
  const originalId = (await records())[0].id;
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await page.getByRole('textbox', { name: /Page title/ }).fill('Manual title while AI runs');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.waitForFunction(async () => (await window.readStore('trafficops-studio-library', 'projects')).some(record => record.settings.title === 'Manual title while AI runs'));
  assert.equal((await records())[0].settings.title, 'Manual title while AI runs');
  await newBlank('Another project');
  await waitDoc(list => list.find(doc => doc.projectId === originalId).runs.filter(run => run.state === 'running').length === 2, 'runs survive project switch');
  await page.evaluate(() => { window.mockAi.release.TASK_A(); window.mockAi.release.TASK_B(); });
  await waitDoc(list => list.find(doc => doc.projectId === originalId).runs.every(run => run.state === 'ready'), 'independent completed drafts');
  await page.getByRole('combobox', { name: 'Switch project', exact: true }).selectOption(originalId);
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await chat.root.waitFor(); await openThreadWith('TASK_A');
  await chat.status('ready').waitFor(); await chat.cards('diff').filter({ hasText: 'a.css' }).waitFor();
  assert.equal((await records()).find(record => record.id === originalId).files['a.css'], undefined);
  await chat.apply.click();
  await page.getByRole('checkbox', { name: 'I reviewed the current files', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'I reviewed the current files', exact: true }).check();
  await page.getByRole('button', { name: 'Apply after reviewing updated context', exact: true }).click();
  await waitDoc(list => list.find(doc => doc.projectId === originalId).runs.some(run => run.state === 'applied'), 'first apply');
  let saved = (await records()).find(record => record.id === originalId);
  assert.equal(saved.files['a.css'], 'h1 { color: red; }'); assert.equal(saved.settings.title, 'Manual title while AI runs');
  await openThreadWith('TASK_B');
  await chat.status('ready').waitFor(); await chat.cards('diff').filter({ hasText: 'b.css' }).waitFor();
  await chat.apply.click();
  await page.getByRole('checkbox', { name: 'I reviewed the current files', exact: true }).check();
  await page.getByRole('button', { name: 'Apply after reviewing updated context', exact: true }).click();
  await waitDoc(list => list.find(doc => doc.projectId === originalId).runs.every(run => run.state === 'applied'), 'second merge apply');
  saved = (await records()).find(record => record.id === originalId);
  assert.equal(saved.files['a.css'], 'h1 { color: red; }'); assert.equal(saved.files['b.css'], 'h2 { color: blue; }');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Editable project' }).click();
  const sourceDownload = page.waitForEvent('download'); await page.getByRole('dialog', { name: 'Export', exact: true }).getByRole('button', { name: 'Download', exact: true }).click();
  const downloaded = await sourceDownload, bytes = new Uint8Array(await readFile(await downloaded.path())), portable = readZipProject(bytes);
  assert.equal(portable.metadata.projectId, originalId); assert.equal(portable.conversations.threads.length, 2); assert.equal(portable.metadata.kind, 'landing');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Import ZIP', exact: true }).click();
  await page.getByLabel('Import project ZIP', { exact: true }).setInputFiles({ name: 'continued-source.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await page.getByRole('dialog', { name: 'Continue this project or create a copy?', exact: true }).getByRole('button', { name: 'Continue project', exact: true }).click();
  assert.equal((await records()).length, 2); assert.equal((await records()).find(record => record.id === originalId).kind, 'landing');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click(); await chat.root.waitFor();
  await newConversation(); await chat.root.getByRole('heading', { name: 'New conversation', exact: true }).waitFor();
  await chat.prompt.fill('TASK_RELOAD Add a stylesheet and wait.');
  await chat.send.click(); await page.waitForFunction(() => Boolean(window.mockAi.release.TASK_RELOAD));
  await page.reload();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await waitDoc(list => list.find(doc => doc.projectId === originalId).runs.at(-1).state === 'interrupted', 'reload interruption');
  assert.equal(await page.evaluate(() => window.mockAi.calls.length), 0, 'reload must not replay paid provider calls');
  assert.equal((await records()).length, 2); assert.deepEqual(errors, []);
  console.log('Conversations browser passed: parallel runs, manual editing, project switching, reviewed merge, portable identity/history and no paid reload replay.');
} catch (error) {
  if (page) { await page.screenshot({ path: '/private/tmp/conversations-browser-failure.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(-10000)); }
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
