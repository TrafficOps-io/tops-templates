import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioProject } from '../src/studio-library.js';
import { studioChat } from './support/studio-chat.js';

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
// Composer attachments are StudioChat chips; New project (library) keeps its own list until Task 8.
const chipsOf = scope => scope.locator('.studio-chip-attachment, .ai-attachment-list li');
async function expectAttachments(scope, count) {
  await chipsOf(scope).nth(count ? count - 1 : 0).waitFor({ state: count ? 'attached' : 'detached' });
  assert.equal(await chipsOf(scope).count(), count);
}
async function removeAll(scope) {
  const remove = scope.locator('.studio-chip-attachment .studio-chip-remove, .ai-attachment-list button');
  while (await remove.count()) await remove.first().click();
  await expectAttachments(scope, 0);
}
async function checkTextPaste(scope, prompt, expectedText) {
  const before = await chipsOf(scope).count();
  const result = await paste(prompt, [], 'Ordinary text from the clipboard');
  assert.equal(result.prevented, false, 'Text paste stays available to the textarea default behavior');
  assert.equal(await prompt.inputValue(), expectedText);
  assert.equal(await chipsOf(scope).count(), before);
}
// Sends the composer with its attachments; the synthetic provider holds the request until "Stop".
async function checkProviderAndRunningPaste(chat) {
  const requestIndex = await page.evaluate(() => window.clipboardQa.requests.length);
  const sent = await chipsOf(chat.composer).count();
  await chat.send.click();
  await page.waitForFunction(index => window.clipboardQa.requests.length > index, requestIndex);
  const request = await page.evaluate(index => window.clipboardQa.requests[index], requestIndex);
  assert.ok(JSON.stringify(request.messages).includes('data:image/png;base64,' + png.toString('base64')), 'Pasted image bytes reach the selected provider request');
  await expectAttachments(chat.composer, 0); assert.ok(sent > 0);
  await chat.user.last().locator('.studio-chip-attachment').first().waitFor();
  const running = chat.status('running').last(); await running.waitFor();
  // While the run works a pasted file waits in the composer for the next message.
  await paste(chat.prompt, [image('next-message.png')]);
  await expectAttachments(chat.composer, 1);
  await running.getByRole('button', { name: 'Stop', exact: true }).click();
  await chat.status('cancelled').last().waitFor({ timeout: 10000 });
  await removeAll(chat.composer);
  assert.equal(await page.evaluate(() => window.clipboardQa.requests.length), requestIndex + 1, 'Stop does not make another provider request');
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
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  const chat = studioChat(page); await chat.composer.waitFor();
  const assistant = chat.composer, prompt = chat.prompt;
  const promptText = 'Use the pasted screenshot as a visual reference.';
  await prompt.fill(promptText);
  await checkTextPaste(assistant, prompt, promptText);
  const firstPaste = await paste(prompt, [image('clipboard-reference.png')], 'Clipboard image description');
  assert.equal(firstPaste.prevented, true, 'Image paste consumes the image event rather than inserting clipboard HTML/text');
  await expectAttachments(assistant, 1);
  assert.equal(await prompt.inputValue(), promptText, 'Image paste preserves the existing prompt');
  await assistant.locator('.studio-chip-attachment').filter({ hasText: 'clipboard-reference.png' }).waitFor();
  await removeAll(assistant);

  const fallbackPaste = await prompt.evaluate((element, bytes) => {
    const file = new File([new Uint8Array(bytes)], 'files-only.png', { type: 'image/png' });
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [file] } });
    element.dispatchEvent(event); return event.defaultPrevented;
  }, [...png]);
  assert.equal(fallbackPaste, true, 'Files-only clipboard payloads also attach images');
  await expectAttachments(assistant, 1);
  await assistant.getByRole('button', { name: 'Remove files-only.png', exact: true }).waitFor();
  await removeAll(assistant);

  const rejected = assistant.getByRole('alert').filter({ hasText: 'Some files were not attached' });
  await paste(prompt, [{ name: 'unsupported.gif', mime: 'image/gif', bytes: [71,73,70,56,57,97] }]);
  await rejected.filter({ hasText: 'unsupported.gif — This file type is not supported.' }).waitFor();
  await expectAttachments(assistant, 0);
  await paste(prompt, [{ name: 'too-large.png', mime: 'image/png', size: 4 * 1024 * 1024 + 1 }]);
  await rejected.filter({ hasText: 'too-large.png — Empty or larger than 4.0 MB.' }).waitFor();
  await expectAttachments(assistant, 0);
  await paste(prompt, [image('one.png'), image('two.png'), image('three.png'), image('four.png')]);
  await expectAttachments(assistant, 4);
  await paste(prompt, [image('fifth.png')]);
  await rejected.filter({ hasText: 'fifth.png — Too many files: up to 4 per message.' }).waitFor();
  await expectAttachments(assistant, 4);
  await removeAll(assistant);
  // The attach button is also a paste target when it has focus (the composer form handles the event).
  assert.equal((await paste(assistant.getByRole('button', { name: 'Attach files', exact: true }), [image('button-paste.png')])).prevented, true);
  await expectAttachments(assistant, 1);
  await checkProviderAndRunningPaste(chat);
  report.states.push('assistant: text/image paste, files-only clipboard, remove, type/size/count validation, provider payload, paste while running');

  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.locator('.file-sidebar').getByTitle('styles.css', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit file with AI', exact: true }).click();
  await chat.scope.getByRole('button', { name: 'File', pressed: true, exact: true }).waitFor();
  await chat.composer.locator('.studio-chip-mention').filter({ hasText: '@styles.css' }).waitFor();
  await prompt.fill('Use this screenshot to update only the selected stylesheet.');
  await checkTextPaste(assistant, prompt, await prompt.inputValue());
  assert.equal((await paste(prompt, [image('file-reference.png')])).prevented, true);
  await expectAttachments(assistant, 1);
  await checkProviderAndRunningPaste(chat);
  report.states.push('selected-file scope: text/image paste, provider payload, paste while running');

  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByRole('button', { name: 'With AI', exact: true }).click();
  const createPrompt = create.locator('textarea'); // the home brief composer moves to StudioComposer in plan V Task 8
  await createPrompt.fill('Create a page matching my clipboard reference.');
  await checkTextPaste(create, createPrompt, await createPrompt.inputValue());
  assert.equal((await paste(createPrompt, [image('new-project-reference.png')])).prevented, true);
  await expectAttachments(create, 1);
  await create.getByRole('button', { name: 'Remove reference new-project-reference.png', exact: true }).click();
  await expectAttachments(create, 0);
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  report.states.push('New project AI brief: text/image paste, preview and removal');

  assert.deepEqual(report.pageErrors, [], 'No browser page errors');
  assert.deepEqual(report.blockedExternalRequests, [], 'No unexpected external requests');
  assert.equal(await page.evaluate(() => window.clipboardQa.requests.length), 2, 'Only the two explicit synthetic generations request a provider');
  report.passed = true; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('PASS: Clipboard image paste in the project chat (project and file scope) and New project AI prompt; text handling, image bytes, removal, type/size/count limits, single send while running. Zero paid requests.');
} catch (error) {
  report.passed = false; report.error = error.message;
  if (page && !page.isClosed()) {
    report.diagnostics = await page.evaluate(() => ({ requests: window.clipboardQa?.requests.length, attachments: [...document.querySelectorAll('.studio-chat-composer-attachments, .ai-attachment-list')].map(list => list.innerText), alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.innerText) }));
    await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
