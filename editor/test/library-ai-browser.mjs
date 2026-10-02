import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { studioChat } from './support/studio-chat.js';
import { configureAi, installFolderPicker, readProjectFolder, usePicker } from './support/studio-folders.js';
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
// Each AI project is created in its own picked folder; the provider mock records the folder's state (read with the
// production storage modules) at every request.
let folder = null;
async function openTestPage() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await installFolderPicker(context);
  const page = await context.newPage(); currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('captureProviderCall', async value => {
    const project = folder && await readProjectFolder(page, `picker/${folder}`);
    providerCalls.push({ ...value, project, document: project?.conversations });
  });
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.libraryAiTest = { step: 0, outcome: 'success', release: null };
    window.fetch = async (url, options = {}) => {
      if (!String(url).includes('openrouter.ai/api/v1/')) return realFetch(url, options);
      if (!String(url).endsWith('/chat/completions')) return Response.json({ data: {} });
      const test = window.libraryAiTest, body = JSON.parse(options.body), stageName = body.tools?.length === 1 ? body.tools[0].function.name : null;
      const step = stageName || ++test.step;
      await window.captureProviderCall({ step, outcome: test.outcome, body });

      const stage = stageName;
      if (stage === 'submit_plan' || stage === 'submit_review') {
        const value = stage === 'submit_plan' ? { summary: 'Plan the requested changes.', tasks: ['Make the requested changes', 'Review the result'] } : { approved: true, summary: 'The requested changes are present.', issues: [] };
        const payload = { id: stage, model: 'test/model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: stage, type: 'function', function: { name: stage, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }] };
        return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (test.outcome === 'error' && step >= 2) return Response.json({ error: { message: 'Mock provider unavailable after completed file', code: 503 } }, { status: 503 });
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
// The submit opens the folder picker (picker/<target>) in the same click.
async function createAiProject(page, name, prompt, target, withAttachment = false) {
  folder = target; await usePicker(page, target);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByRole('button', { name: 'With AI', exact: true }).click();
  await dialog.getByText('Project options', { exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Project name (optional)', exact: true }).fill(name);
  const composer = dialog.locator('[data-testid="studio-chat-composer"]');
  await composer.getByRole('textbox', { name: 'Message to assistant', exact: true }).fill(prompt);
  if (withAttachment) {
    await composer.locator('input[type=file]').setInputFiles({ name: 'brand-reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==', 'base64') });
    await composer.getByRole('checkbox', { name: 'Use attached images on the page', exact: true }).check();
  }
  await composer.locator('button[type=submit]').click();
  await dialog.waitFor({ state: 'hidden' });
  await showLatestThread(page);
  assert.equal(await page.getByRole('button', { name: 'Collapse editor', exact: true }).count(), 0, 'the editor stays open');
}
const configureTestKey = page => configureAi(page, { apiKey: 'mock-key-never-sent-to-provider', model: 'test/model' });
// The editor opens on the latest conversation (the creation thread), as the former conversation panel did.
async function showLatestThread(page) {
  await studioChat(page).root.waitFor();
}
const snapshot = name => readProjectFolder(currentPage, `picker/${name}`);
// The folder's project and the history document's latest run, once that run reaches `state`.
async function waitForRun(page, target, state) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const project = await readProjectFolder(page, `picker/${target}`), document = project?.conversations, run = document?.runs.at(-1);
    if (run?.state === state) return { project, document, run };
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${target} run to become ${state}: ${JSON.stringify((await readProjectFolder(page, `picker/${target}`))?.conversations)}`);
}
async function waitForSaved(page, target, expected) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const project = await readProjectFolder(page, `picker/${target}`);
    if (project?.files['index.tpl']?.includes(expected)) return project;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${target} to autosave.`);
}
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });

  // Missing credentials preserve the initial request in durable dialog history.
  const unconfigured = await openTestPage(), pendingPrompt = 'A calm ceramics landing with a gallery and booking link.';
  await createAiProject(unconfigured, 'Pending ceramics', pendingPrompt, 'pending-ceramics');
  const missing = await waitForRun(unconfigured, 'pending-ceramics', 'failed');
  const unconfiguredChat = studioChat(unconfigured);
  await unconfiguredChat.user.getByText(pendingPrompt, { exact: true }).waitFor();
  await unconfiguredChat.status('failed').waitFor();
  assert.equal(providerCalls.length, 0);
  // The brief is claimed into the dialogue: the request is kept in history, never left pending in project.json.
  assert.equal(missing.document.threads[0].messages[0].prompt, pendingPrompt); assert.equal(missing.project.meta.pendingAi, undefined); assert.equal(missing.project.meta.kind, 'landing');
  assert.equal(missing.project.meta.name, 'Pending ceramics');
  assert.match(missing.run.error, /connection|key/i);
  await unconfiguredChat.root.getByRole('button', { name: 'AI settings', exact: true }).click();
  await unconfigured.locator('.ai-settings input[type=password]').waitFor();
  await unconfigured.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  await unconfigured.reload(); await showLatestThread(unconfigured);
  await unconfiguredChat.user.getByText(pendingPrompt, { exact: true }).waitFor();
  assert.equal(providerCalls.length, 0, 'a missing-key request does not restart after reload');
  assert.equal((await waitForRun(unconfigured, 'pending-ceramics', 'failed')).document.threads.length, 1);
  await unconfigured.context().close();

  // Both the message and creation handoff are durable before any provider fetch.
  const page = await openTestPage(); await configureTestKey(page); const chat = studioChat(page);
  const prompt = 'Create a studio launch landing with a clear heading and introductory copy.';
  await createAiProject(page, 'AI launch', prompt, 'ai-launch', true);
  await page.waitForFunction(() => typeof window.libraryAiTest.release === 'function');
  assert.equal(providerCalls.length, 1, 'one agent loop: the held write is the first request');
  // At the first request the brief is already claimed from project.json and the message, its attachment and the
  // running run are on disk.
  const claimed = providerCalls[0].project, claimedDocument = providerCalls[0].document, claimedMessage = claimedDocument.threads[0].messages[0];
  assert.equal(claimed.meta.name, 'AI launch'); assert.equal(claimed.meta.pendingAi, undefined, 'the brief is claimed before the first request');
  assert.equal(claimedMessage.attachments.length, 1, JSON.stringify(claimedMessage)); assert.equal(claimedMessage.attachments[0].useOnPage, true);
  assert.equal(claimedDocument.runs[0].state, 'running');
  assert.equal(claimedMessage.prompt, prompt);
  assert.ok(providerCalls[0].body.messages.some(message => JSON.stringify(message.content).includes(prompt)));
  assert.ok(providerCalls[0].body.messages.some(message => message.content?.some?.(part => part.type === 'image_url')));
  await chat.status('running').waitFor();
  assert.equal(await chat.apply.count(), 0);
  assert.ok((await snapshot('ai-launch')).files['index.tpl'].includes('Your next idea'), 'partial streamed source never replaces the canonical starter');
  await page.evaluate(() => window.libraryAiTest.release());
  const ready = await waitForRun(page, 'ai-launch', 'ready');
  assert.equal(providerCalls.length, 2, `successful host validation skips a summary-only provider request: ${providerCalls.map(call => call.step)}`);
  assert.ok(ready.run.result.valid); assert.ok(ready.run.result.files['index.tpl'].includes('AI studio launch'));
  const assetPath = `images/reference-${claimedMessage.attachments[0].id}.png`;
  assert.ok(ready.run.result.files[assetPath] && typeof ready.run.result.files[assetPath] === 'object', 'an image marked Use on page is part of the independent draft');
  assert.ok(ready.project.files['index.tpl'].includes('Your next idea'), 'a ready draft still requires manual apply');
  await chat.run(ready.run.id).waitFor(); assert.equal(await chat.run(ready.run.id).getAttribute('data-run-status'), 'ready');
  await chat.cards('diff').filter({ hasText: 'index.tpl' }).waitFor();
  await chat.run(ready.run.id).getByRole('button', { name: 'Preview draft', exact: true }).click();
  await page.getByText('Conversation draft · Project files unchanged', { exact: true }).waitFor();
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'AI studio launch', exact: true }).waitFor();
  await chat.apply.click();
  const saved = await waitForSaved(page, 'ai-launch', 'AI studio launch');
  assert.ok(saved.files[assetPath], 'manual apply keeps the selected image asset');
  await waitForRun(page, 'ai-launch', 'applied');
  assert.ok((await snapshot('ai-launch')).meta.appliedAiRuns.includes(ready.run.id));
  await page.reload(); await showLatestThread(page);
  await chat.user.getByText(prompt, { exact: true }).waitFor(); await chat.status('applied').waitFor();
  await page.waitForTimeout(800);
  assert.equal(providerCalls.length, 2, 'reload never restarts a paid generation');
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'AI studio launch', exact: true }).waitFor();

  // Stopping an incomplete stream retains the canonical starter and dialog history.
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await page.evaluate(() => { Object.assign(window.libraryAiTest, { step: 0, outcome: 'cancel', release: null }); });
  await createAiProject(page, 'Cancelled creation', 'A project whose creation will be cancelled.', 'cancelled-creation');
  await page.waitForFunction(() => typeof window.libraryAiTest.release === 'function');
  await chat.status('running').getByRole('button', { name: 'Stop', exact: true }).click();
  const cancelled = await waitForRun(page, 'cancelled-creation', 'cancelled');
  assert.equal(cancelled.project.meta.pendingAi, undefined);
  assert.ok(cancelled.project.files['index.tpl'].includes('Your next idea'));
  assert.equal(cancelled.document.threads[0].messages[0].prompt, 'A project whose creation will be cancelled.');
  assert.equal(providerCalls.length, 3, 'a stopped creation made one request');

  // Later failure preserves each completed source operation for explicit review.
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await page.evaluate(() => { Object.assign(window.libraryAiTest, { step: 0, outcome: 'error', release: null }); });
  await createAiProject(page, 'Recovered creation', 'Keep completed files when the mocked provider fails.', 'recovered-creation');
  await page.waitForFunction(() => typeof window.libraryAiTest.release === 'function');
  await page.evaluate(() => window.libraryAiTest.release());
  const failed = await waitForRun(page, 'recovered-creation', 'failed');
  assert.ok(failed.project.files['index.tpl'].includes('Your next idea'));
  assert.ok(failed.run.result.files['index.tpl'].includes('AI studio launch'));
  assert.equal(failed.run.result.valid, false);
  // A failed run is not applicable: no Apply; its retained source is shown as a diff card with Continue generation and Keep draft in editor.
  const failedRun = chat.run(failed.run.id); await failedRun.waitFor(); assert.equal(await failedRun.getAttribute('data-run-status'), 'failed');
  assert.ok((await failedRun.locator('[data-testid="studio-chat-card"][data-card="diff"]').filter({ hasText: 'index.tpl' }).innerText()).includes('AI studio launch'));
  assert.equal(await chat.apply.count(), 0, 'an unvalidated failed draft cannot be applied');
  await failedRun.locator('[data-testid="studio-chat-continue"]').waitFor(); await failedRun.locator('[data-testid="studio-chat-keep-draft"]').waitFor();
  assert.equal(providerCalls.length, 8, `a persistent pre-tool 503 gets three retries without replaying completed writes: ${providerCalls.map(call => call.step)}`);
  await page.reload(); await showLatestThread(page);
  await chat.run(failed.run.id).locator('[data-testid="studio-chat-continue"]').waitFor();
  await page.waitForTimeout(800);
  const restored = await waitForRun(page, 'recovered-creation', 'failed');
  assert.ok(restored.run.result.files['index.tpl'].includes('AI studio launch'));
  assert.equal(providerCalls.length, 8, 'retained failed work never causes automatic payment after reload');
  assert.deepEqual(errors, []);
  console.log('PASS: library AI creation into project folders, durable message and claim before fetch, retained image asset, manual review/apply, reload without requests, missing-key history, stop, and retained failed source.');
} catch (error) {
  await currentPage?.screenshot({ path: '/tmp/library-ai-browser-error.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
