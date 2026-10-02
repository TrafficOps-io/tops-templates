import { revealConversationTab } from './support/studio-chat.js';
// Regenerate, edit and branch switching on the actual App (spec 2.3, 2.6), over a pre-tree conversation document,
// plus the OpenRouter ModelPicker in AI settings. The provider and the model catalog are mocked in the page; no paid
// or external request leaves the browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openThread, studioChat } from './support/studio-chat.js';
import { configureAi, conversationsOf, installFolderPicker, seedAndOpen } from './support/studio-folders.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const source = '@template "Branches"\n@section page "Page"\n@param title String = "Hero" label="Title"\n@endsection\n@layout\n<html><body><h1>{{title}}</h1></body></html>\n@endlayout\n';
const fixture = { id: randomUUID(), name: 'Branches QA', files: { 'index.tpl': source }, settings: { title: 'Hero' } };
const base = { name: fixture.name, revision: 1, files: fixture.files, folders: [], entrypoint: 'index.html', locale: 'en', translations: { en: fixture.settings } };
const now = Date.now();
// Written before conversation trees: no parentId, no activeLeafId.
const document = { schema: 1, projectId: fixture.id, revision: 0, threads: [{ id: 'thread-branches', title: 'Branch QA', archived: false, createdAt: now, updatedAt: now, messages: [
  { id: 'message-hero', role: 'user', prompt: 'Describe the hero', parts: [{ type: 'text', text: 'Describe the hero' }], attachments: [], mentions: [], createdAt: now, status: 'completed', runId: 'run-hero' },
  { id: 'answer-hero', role: 'assistant', prompt: 'Answer zero', parts: [{ type: 'text', text: 'Answer zero' }], createdAt: now + 1, runId: 'run-hero', status: 'completed' },
] }], runs: [{ id: 'run-hero', threadId: 'thread-branches', messageId: 'message-hero', attempt: 0, state: 'completed', phase: 'answered', scope: { kind: 'project' }, locale: 'en', base, result: { files: fixture.files, values: fixture.settings, valid: true, discussion: true, summary: 'Answer zero', steps: 0, readSet: [] }, createdAt: now, updatedAt: now + 1 }] };
const catalog = { data: [
  { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', context_length: 400000, pricing: { prompt: '0.00000025', completion: '0.000002' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools', 'reasoning'] },
  { id: 'acme/no-tools', name: 'Acme: Chatter', context_length: 8192, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['temperature'] },
  { id: 'google/gemini-2.5-flash-image', name: 'Google: Nano Banana', context_length: 32768, pricing: { prompt: '0.0000003', completion: '0.0000025' }, architecture: { input_modalities: ['image', 'text'], output_modalities: ['image', 'text'] }, supported_parameters: [] },
] };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try { const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path)); if (!file.startsWith(root + '/')) throw new Error('Path'); response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const errors = [], blocked = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin + '/') || url.startsWith(`blob:${origin}/`) || url.startsWith('data:')) return route.continue(); blocked.push(url); return route.abort(); });
  await installFolderPicker(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(catalog => {
    const realFetch = window.fetch.bind(window);
    window.branchTest = { requests: [], catalogRequests: 0 };
    window.fetch = async (url, options = {}) => {
      if (String(url) === 'https://openrouter.ai/api/v1/models') { window.branchTest.catalogRequests++; return Response.json(catalog); }
      if (!String(url).includes('openrouter.ai/api/v1/')) return realFetch(url, options);
      const body = JSON.parse(options.body), state = window.branchTest; state.requests.push(body);
      const text = `Answer ${state.requests.length}`;
      // A text-only reply: the agent answers without changing the project.
      return new Response(`data: ${JSON.stringify({ id: `mock-${state.requests.length}`, model: 'test/model', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, catalog);
  await page.goto(origin); await page.locator('.library').waitFor();
  // The project folder holds the pre-tree history (.trafficops/conversations/).
  await configureAi(page, { apiKey: 'mock-no-provider-branches', model: 'test/text-model' });
  const seeded = await seedAndOpen(page, { name: fixture.name, projectId: fixture.id, files: fixture.files, values: fixture.settings, conversations: document });
  const chat = studioChat(page); await revealConversationTab(chat.root); await chat.root.waitFor();
  const conversations = page.getByRole('tab', { name: 'Conversations', exact: true }); if (await conversations.count()) await conversations.click();
  await openThread(chat, 'Branch QA');
  await chat.run('run-hero').waitFor();
  assert.deepEqual(await chat.feed.locator('[data-role]').evaluateAll(elements => elements.map(element => element.dataset.role)), ['user', 'assistant'], 'the pre-tree history shows unchanged');
  const picker = message => message.getByRole('group', { name: 'Versions', exact: true });
  assert.equal(await picker(chat.assistant.last()).count(), 0, 'no branch picker without siblings');

  // Regenerate the answer: a sibling of the same user message.
  await chat.assistant.last().hover();
  await chat.assistant.last().getByRole('button', { name: 'Regenerate response', exact: true }).click();
  await chat.feed.getByText('Answer 1', { exact: true }).waitFor();
  assert.equal(await chat.feed.getByText('Answer zero', { exact: true }).count(), 0, 'the replaced answer is hidden');
  await picker(chat.assistant.last()).getByText('2/2', { exact: true }).waitFor();
  const firstRequest = JSON.stringify((await page.evaluate(() => window.branchTest.requests))[0].messages);
  assert.ok(firstRequest.includes('Describe the hero'), 'the regenerated request repeats the user message');
  assert.ok(!firstRequest.includes('Answer zero'), 'the replaced answer is not history of its sibling');

  // Switch back and forth between the versions.
  await chat.assistant.last().hover();
  await picker(chat.assistant.last()).getByRole('button', { name: 'Previous version', exact: true }).click();
  await chat.feed.getByText('Answer zero', { exact: true }).waitFor();
  await picker(chat.assistant.last()).getByText('1/2', { exact: true }).waitFor();
  await chat.assistant.last().hover();
  await picker(chat.assistant.last()).getByRole('button', { name: 'Next version', exact: true }).click();
  await chat.feed.getByText('Answer 1', { exact: true }).waitFor();

  // Edit the question: a sibling user message with a new run.
  await chat.user.last().hover();
  await chat.user.last().getByRole('button', { name: 'Edit message', exact: true }).click();
  const editor = chat.feed.getByRole('textbox', { name: 'Edit message', exact: true });
  await editor.fill('Describe the footer');
  await chat.feed.getByRole('button', { name: 'Save', exact: true }).click();
  await chat.feed.getByText('Answer 2', { exact: true }).waitFor();
  await chat.user.last().getByText('Describe the footer', { exact: true }).waitFor();
  await picker(chat.user.last()).getByText('2/2', { exact: true }).waitFor();
  assert.equal(await picker(chat.assistant.last()).count(), 0, 'the new branch has one answer');
  const edited = JSON.stringify((await page.evaluate(() => window.branchTest.requests))[1].messages);
  assert.ok(edited.includes('Describe the footer') && !edited.includes('Describe the hero'), 'the edited request carries only the new text');

  // The tree and the visible branch are durable.
  await page.reload(); await revealConversationTab(chat.root); await chat.root.waitFor();
  if (await conversations.count()) await conversations.click();
  await openThread(chat, 'Branch QA');
  await chat.feed.getByText('Answer 2', { exact: true }).waitFor();
  const stored = await conversationsOf(page, seeded.folder);
  const thread = stored.threads[0], users = thread.messages.filter(message => message.role === 'user');
  assert.deepEqual(users.map(message => message.parentId), [null, null], 'the original and the edited question are root siblings');
  assert.equal(stored.runs.filter(run => run.messageId === 'message-hero').length, 2);
  assert.equal(thread.activeLeafId, users[1].id);
  await chat.user.last().hover();
  await picker(chat.user.last()).getByRole('button', { name: 'Previous version', exact: true }).click();
  await chat.feed.getByText('Answer 1', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.branchTest.requests.length), 0, 'reloading and switching versions never call the provider');

  // AI settings: the text model is chosen from the OpenRouter catalog, loaded on the first interaction.
  assert.equal(await page.evaluate(() => window.branchTest.catalogRequests), 0, 'the catalog is not requested before the picker is used');
  await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'More actions', exact: true }).click();
  await chat.root.getByRole('menuitem', { name: 'AI settings', exact: true }).click();
  const settings = page.locator('.ai-settings');
  await settings.getByRole('button', { name: 'Text model: test/text-model', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Text model', exact: true });
  await list.getByRole('option', { name: /GPT-5 Mini/ }).last().waitFor();
  assert.equal(await page.evaluate(() => window.branchTest.catalogRequests), 1);
  const noTools = list.getByRole('option', { name: /Chatter/ });
  assert.equal(await noTools.getAttribute('aria-disabled'), 'true');
  assert.ok((await noTools.innerText()).includes('Does not support tools — the agent cannot change the project'));
  assert.ok(await list.getByRole('option', { name: /test\/text-model/ }).count(), 'the saved model stays listed');
  await list.getByRole('option', { name: /GPT-5 Mini/ }).last().click();
  await settings.getByRole('button', { name: 'Text model: GPT-5 Mini', exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Image model: No image model', exact: true }).click();
  await page.getByRole('listbox', { name: 'Image model', exact: true }).getByRole('option', { name: /Nano Banana/ }).last().click();
  await settings.getByRole('button', { name: 'Save connection', exact: true }).click();
  await settings.getByText('Connection saved on this device.', { exact: true }).waitFor();
  const saved = await page.evaluate(() => new Promise((done, reject) => { const request = indexedDB.open('trafficops-template-studio-ai', 1); request.onsuccess = () => { const get = request.result.transaction('settings').objectStore('settings').get('openrouter'); get.onsuccess = () => { done(get.result); request.result.close(); }; get.onerror = () => reject(get.error); }; request.onerror = () => reject(request.error); }));
  assert.equal(saved.model, 'openai/gpt-5-mini'); assert.equal(saved.imageModel, 'google/gemini-2.5-flash-image');
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('trafficops-ai-recent-models'))), { text: ['openai/gpt-5-mini'], image: ['google/gemini-2.5-flash-image'] });
  // A typed ID remains possible.
  await settings.getByRole('button', { name: 'Enter model ID', exact: true }).first().click();
  assert.equal(await settings.getByLabel('Text model', { exact: true }).inputValue(), 'openai/gpt-5-mini');
  await page.screenshot({ path: '/tmp/branches-browser.png' });
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked.filter(url => url.includes('openrouter')), [], 'no request reached OpenRouter');
  console.log('PASS: pre-tree history, regenerate as a sibling, version switching, edit as a sibling branch, durable tree and active leaf, no provider call on switch, ModelPicker over the mocked catalog with no-tools reason, image model and recent ids.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
