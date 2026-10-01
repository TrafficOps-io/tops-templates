import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioProject } from '../src/studio-library.js';

// Uses an existing production build, DOM clipboard events and image decoding.
// All provider responses are synthetic; external network requests are blocked.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '../dist'));
const out = '/tmp/studio-clipboard-images-browser';
await mkdir(out, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==', 'base64');
const image = name => ({ name, mime: 'image/png', bytes: [...png] });
const fixture = createStudioProject({ kind: 'landing', name: 'Synthetic clipboard image QA', files: {
  'index.tpl': '@template "Clipboard QA"\n@section page "Page"\n@param headline String = "Original heading" label="Heading" required\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>{{ headline }}</h1></body></html>\n@endlayout\n',
  'styles.css': 'body{margin:0;padding:24px;font-family:system-ui;color:#234}\n',
}, settings: { headline: 'Original heading' } });
const report = { build: root, paidRequests: 0, states: [], pageErrors: [], blockedExternalRequests: [] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
let browser, page;

async function paste(target, files = [], text = '', copies = 1) {
  return target.evaluate((element, { files, text, copies }) => {
    const data = new DataTransfer();
    if (text) { data.setData('text/plain', text); data.setData('text/html', '<p>' + text + '</p>'); }
    for (const file of files) data.items.add(new File([file.size ? new Uint8Array(file.size) : new Uint8Array(file.bytes)], file.name, { type: file.mime }));
    let event;
    for (let index = 0; index < copies; index++) {
      event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
    }
    return { prevented: event.defaultPrevented, images: [...data.files].filter(file => file.type.startsWith('image/')).length };
  }, { files, text, copies });
}
async function expectAttachments(scope, count) {
  await scope.locator('.ai-attachment-list li').nth(count ? count - 1 : 0).waitFor({ state: count ? 'attached' : 'detached' });
  assert.equal(await scope.locator('.ai-attachment-list li').count(), count);
}
async function removeAll(scope) {
  const remove = scope.locator('.ai-attachment-list button');
  while (await remove.count()) await remove.first().click();
  await expectAttachments(scope, 0);
}
async function checkTextPaste(scope, prompt, expectedText) {
  const before = await scope.locator('.ai-attachment-list li').count();
  const result = await paste(prompt, [], 'Ordinary text from the clipboard');
  assert.equal(result.prevented, false, 'Text paste stays available to the textarea default behavior');
  assert.equal(await prompt.inputValue(), expectedText);
  assert.equal(await scope.locator('.ai-attachment-list li').count(), before);
}
async function expectReadLock(scope, prompt) {
  await page.evaluate(() => { window.clipboardQa.holdRead = true; window.clipboardQa.reads = 0; });
  await paste(prompt, [image('held-read.png')], '', 2);
  await page.waitForFunction(() => typeof window.clipboardQa.releaseRead === 'function');
  assert.equal(await page.evaluate(() => window.clipboardQa.reads), 1, 'Same-turn paste events cannot start duplicate reads');
  assert.equal(await scope.getByRole('button', { name: 'Reading images…', exact: true }).isDisabled(), true);
  assert.equal(await scope.getByRole('button', { name: 'Generate changes', exact: true }).isDisabled(), true);
  await paste(prompt, [image('ignored-while-reading.png')]);
  assert.equal(await page.evaluate(() => window.clipboardQa.reads), 1, 'Only one attachment read runs while the decoder is busy');
  await page.evaluate(() => window.clipboardQa.releaseRead());
  await expectAttachments(scope, 1);
  await scope.getByRole('button', { name: 'Remove image held-read.png', exact: true }).waitFor();
  await removeAll(scope);
}
async function checkProviderAndDisabledPaste(scope, prompt) {
  const before = await scope.locator('.ai-attachment-list li').count();
  const requestIndex = await page.evaluate(() => window.clipboardQa.requests.length);
  await scope.getByRole('button', { name: 'Generate changes', exact: true }).click();
  await page.waitForFunction(index => window.clipboardQa.requests.length > index, requestIndex);
  const request = await page.evaluate(index => window.clipboardQa.requests[index], requestIndex);
  assert.ok(JSON.stringify(request.messages).includes('data:image/png;base64,' + png.toString('base64')), 'Pasted image bytes reach the selected provider request');
  assert.equal(await prompt.isDisabled(), true);
  await paste(prompt, [image('ignored-during-generation.png')]);
  assert.equal(await scope.locator('.ai-attachment-list li').count(), before, 'Disabled prompt cannot add another attachment');
  await scope.getByRole('button', { name: 'Cancel', exact: true }).click();
  await scope.getByRole('button', { name: 'Generate changes', exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.evaluate(() => window.clipboardQa.requests.length), requestIndex + 1, 'Cancel does not make another provider request');
}

try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    const url = new URL(route.request().url()); report.blockedExternalRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.clipboardQa = { requests: [], holdRead: false, reads: 0, releaseRead: null };
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      const state = window.clipboardQa;
      if (!state.holdRead || this.name !== 'held-read.png') return read.call(this);
      state.reads++;
      return new Promise((resolve, reject) => { state.releaseRead = () => { state.holdRead = false; state.releaseRead = null; read.call(this).then(resolve, reject); }; });
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url, options);
      window.clipboardQa.requests.push(JSON.parse(options.body));
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Synthetic request cancelled', 'AbortError'));
        if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
      });
    };
  });
  await page.goto(origin); await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await page.evaluate(async fixture => {
    const open = (name, initialize) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1); request.onupgradeneeded = () => initialize?.(request.result);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const library = await open('trafficops-studio-library');
    await new Promise((resolve, reject) => {
      const tx = library.transaction(['projects', 'preferences'], 'readwrite');
      tx.objectStore('projects').put({ ...fixture, revision: 1 }); tx.objectStore('preferences').put(fixture.id, 'active-project');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); library.close();
    const connection = await open('trafficops-template-studio-ai', db => db.createObjectStore('settings', { keyPath: 'id' }));
    await new Promise((resolve, reject) => {
      const tx = connection.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'synthetic-clipboard-key-no-paid-requests', model: 'test/clipboard-model', imageModel: '' });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); connection.close();
  }, fixture);
  await page.reload();
  const collapse = page.getByRole('button', { name: 'Collapse editor', exact: true }); if (await collapse.count()) await collapse.click();
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  const assistant = page.locator('.ai-panel'), prompt = assistant.locator('.ai-prompt textarea');
  const promptText = 'Use the pasted screenshot as a visual reference.';
  await prompt.fill(promptText);
  await checkTextPaste(assistant, prompt, promptText);
  const firstPaste = await paste(prompt, [image('clipboard-reference.png')], 'Clipboard image description');
  assert.equal(firstPaste.prevented, true, 'Image paste consumes the image event rather than inserting clipboard HTML/text');
  await expectAttachments(assistant, 1);
  assert.equal(await prompt.inputValue(), promptText, 'Image paste preserves the existing prompt');
  assert.equal(await assistant.locator('.ai-attachment-list img').first().getAttribute('src'), 'data:image/png;base64,' + png.toString('base64'));
  const useOnPage = assistant.getByRole('checkbox', { name: 'Use on page', exact: true });
  assert.equal(await useOnPage.isChecked(), false, 'Pasted images begin as references');
  await useOnPage.check(); assert.equal(await useOnPage.isChecked(), true); await useOnPage.uncheck();
  await removeAll(assistant);
  await expectReadLock(assistant, prompt);

  const fallbackPaste = await prompt.evaluate((element, bytes) => {
    const file = new File([new Uint8Array(bytes)], 'files-only.png', { type: 'image/png' });
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [file] } });
    element.dispatchEvent(event); return event.defaultPrevented;
  }, [...png]);
  assert.equal(fallbackPaste, true, 'Files-only clipboard payloads also attach images');
  await expectAttachments(assistant, 1);
  await assistant.getByRole('button', { name: 'Remove image files-only.png', exact: true }).waitFor();
  await removeAll(assistant);

  await paste(prompt, [{ name: 'unsupported.gif', mime: 'image/gif', bytes: [71,73,70,56,57,97] }]);
  await assistant.getByRole('alert').filter({ hasText: 'Attach PNG, JPEG or WebP images, at most 4 MiB each.' }).waitFor();
  await expectAttachments(assistant, 0);
  await paste(prompt, [{ name: 'too-large.png', mime: 'image/png', size: 4 * 1024 * 1024 + 1 }]);
  await assistant.getByRole('alert').filter({ hasText: 'Attach PNG, JPEG or WebP images, at most 4 MiB each.' }).waitFor();
  await expectAttachments(assistant, 0);
  await paste(prompt, [image('one.png'), image('two.png'), image('three.png'), image('four.png')]);
  await expectAttachments(assistant, 4);
  await paste(prompt, [image('fifth.png')]);
  await assistant.getByRole('alert').filter({ hasText: 'Attach up to 4 reference images.' }).waitFor();
  await expectAttachments(assistant, 4);
  await removeAll(assistant);
  // The attachment area is also an explicit paste target when its button has focus.
  assert.equal((await paste(assistant.getByRole('button', { name: 'Attach images', exact: true }), [image('button-paste.png')])).prevented, true);
  await expectAttachments(assistant, 1);
  await checkProviderAndDisabledPaste(assistant, prompt);
  report.states.push('assistant: text/image paste, files-only clipboard, preview, page opt-in, remove, synchronous read lock, type/size/count validation, provider payload, disabled paste');

  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.locator('.file-sidebar').getByTitle('styles.css', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit file with AI', exact: true }).click();
  const fileDialog = page.getByRole('dialog', { name: 'Edit file with AI', exact: true });
  const filePrompt = fileDialog.getByLabel('Describe the changes', { exact: true });
  await filePrompt.fill('Use this screenshot to update only the selected stylesheet.');
  await checkTextPaste(fileDialog, filePrompt, await filePrompt.inputValue());
  assert.equal((await paste(filePrompt, [image('file-reference.png')])).prevented, true);
  await expectAttachments(fileDialog, 1);
  assert.equal(await fileDialog.getByRole('checkbox', { name: 'Use on page', exact: true }).count(), 0);
  await checkProviderAndDisabledPaste(fileDialog, filePrompt);
  await fileDialog.getByRole('button', { name: 'Close', exact: true }).click();
  report.states.push('selected-file assistant: text/image paste, reference preview, provider payload, disabled paste');

  await page.getByRole('button', { name: 'Library', exact: true }).first().click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByRole('button', { name: 'With AI', exact: true }).click();
  const createPrompt = create.getByRole('textbox', { name: /^Describe your project/ });
  await createPrompt.fill('Create a page matching my clipboard reference.');
  await checkTextPaste(create, createPrompt, await createPrompt.inputValue());
  assert.equal((await paste(createPrompt, [image('new-project-reference.png')])).prevented, true);
  await expectAttachments(create, 1);
  await create.getByRole('button', { name: 'Remove image new-project-reference.png', exact: true }).click();
  await expectAttachments(create, 0);
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  report.states.push('New project AI brief: text/image paste, preview and removal');

  assert.deepEqual(report.pageErrors, [], 'No browser page errors');
  assert.deepEqual(report.blockedExternalRequests, [], 'No unexpected external requests');
  assert.equal(await page.evaluate(() => window.clipboardQa.requests.length), 2, 'Only the two explicit synthetic generations request a provider');
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: Clipboard image paste in project, selected-file and New project AI prompts; text handling, image bytes, page opt-in, removal, type/size/count limits, read lock and disabled generation. Zero paid requests.');
} catch (error) {
  report.passed = false; report.error = error.message;
  if (page && !page.isClosed()) {
    report.diagnostics = await page.evaluate(() => ({ requests: window.clipboardQa?.requests.length, attachments: [...document.querySelectorAll('.ai-attachment-list')].map(list => list.innerText), alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.innerText) }));
    await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
