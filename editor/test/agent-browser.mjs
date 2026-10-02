import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const { studioChat } = await import('./support/studio-chat.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), file = resolve(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + '/')) throw Error('path');
    const value = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(value);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const realFetch = window.fetch.bind(window);
    window.aiTest = { step: 0, requests: [], outcome: 'success', release: null };
    window.fetch = async (url, options) => {
      if (!String(url).includes('openrouter.ai/api/v1/')) return realFetch(url, options);
      const state = window.aiTest, body = JSON.parse(options.body);
      const stage = body.tools?.length === 1 ? body.tools[0].function.name : null;
      // The conversation runtime routes a project-scope request first; this request changes the source.
      if (stage === 'select_intent') {
        const call = { id: 'route', type: 'function', function: { name: 'select_intent', arguments: JSON.stringify({ intent: 'source' }) } };
        if (!body.stream) return Response.json({ id: 'route', object: 'chat.completion', created: 0, model: 'test/model', choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        return new Response(`data: ${JSON.stringify({ id: 'route', model: 'test/model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (stage === 'submit_plan' || stage === 'submit_review') {
        const value = stage === 'submit_plan' ? { summary: 'Plan the requested changes.', tasks: ['Make the requested changes', 'Review the result'] } : { approved: true, summary: 'The requested changes are present.', issues: [] };
        const payload = { id: stage, model: 'test/model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: stage, type: 'function', function: { name: stage, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }] };
        return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      state.requests.push(body);
      const step = ++state.step;
      const call = step === 1 ? ['edit_file', { path: 'index.tpl', search: '<h1>{{ headline }}</h1>', replace: '<h1>First title</h1>' }]
        : step === 2 ? ['edit_file', { path: 'index.tpl', search: 'First title', replace: 'Corrected title' }]
        : step === 3 ? ['delete_file', { path: 'styles.css' }]
        : step === 4 ? ['validate_draft', {}] : null;
      return new Response(new ReadableStream({ start(controller) {
        const send = payload => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
        const delta = value => send({ id: `mock-${step}`, model: 'test/model', choices: [{ index: 0, delta: value, finish_reason: null }] });
        const finish = reason => { send({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }); controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); };
        options.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Aborted', 'AbortError')); } catch {} }, { once: true });
        if (!call) { delta({ content: 'The corrected page is ready.' }); finish('stop'); return; }
        const input = JSON.stringify(call[1]);
        delta({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name: call[0], arguments: '' } }] });
        if (step === 1) {
          const split = input.indexOf('First title') + 'First title</h1>'.length;
          delta({ tool_calls: [{ index: 0, function: { arguments: input.slice(0, split) } }] });
          state.release = () => {
            if (state.outcome === 'error') { send({ error: { message: 'Mock provider failed', code: 503 } }); controller.close(); return; }
            delta({ tool_calls: [{ index: 0, function: { arguments: input.slice(split) } }] }); finish('tool_calls');
          };
        } else { delta({ tool_calls: [{ index: 0, function: { arguments: input } }] }); finish('tool_calls'); }
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'From template', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Browser test');
  await page.getByRole('button', { name: 'Create landing', exact: true }).click();
  await page.locator('.browser-frame iframe.is-visible').waitFor();
  const collapse = page.getByRole('button', { name: 'Collapse editor', exact: true }); if (await collapse.count()) await collapse.click();
  const inspectSource = async text => {
    const visible = page.locator('.view-lines').filter({ hasText: text });
    for (let scroll = 0; scroll < 15 && !(await visible.count()); scroll++) {
      await page.locator('.monaco-editor').hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(180);
    }
    await visible.waitFor({ timeout: 3000 });
  };  const chat = studioChat(page); await chat.root.waitFor();
  const header = chat.root.locator('.studio-chat-header');
  await header.getByRole('button', { name: 'More actions', exact: true }).click();
  await chat.root.getByRole('menuitem', { name: 'AI settings', exact: true }).click();
  await page.locator('.ai-settings input[type=password]').fill('mock-key-no-paid-calls');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  const preview = () => page.locator('.browser-frame iframe.is-visible').contentFrame();
  // Each attempt starts in a new conversation, so a retained draft of the previous attempt is not continued.
  const newConversation = async () => {
    if (await chat.threads.isVisible()) await chat.threads.getByRole('button', { name: 'New conversation', exact: true }).click();
    else { await header.getByRole('button', { name: 'Conversations', exact: true }).click(); await header.getByRole('menuitem', { name: 'New conversation', exact: true }).click(); }
    await header.getByRole('heading', { name: 'New conversation', exact: true }).waitFor();
    await chat.feed.locator('[data-role]').first().waitFor({ state: 'detached' });
  };
  const start = async outcome => {
    await page.evaluate(outcome => { Object.assign(window.aiTest, { step: 0, requests: [], outcome, release: null }); }, outcome);
    await chat.prompt.fill('Replace the page and remove its obsolete stylesheet.');
    await chat.send.click();
    const running = chat.status('running'); await running.waitFor();
    // The first tool call is held mid-stream. Conversations show completed checkpoints only (partial tool input is not
    // rendered, as in the former conversation panel; the live partial source/preview was the removed assistant panel).
    await page.waitForFunction(() => typeof window.aiTest.release === 'function');
    assert.equal(await chat.apply.count(), 0);
    return running;
  };
  // A focused partial edit is visible while the response is held open; the project files stay unchanged until Apply.
  let running = await start('success');
  // A message sent while the assistant works is queued for the next model step.
  if (!process.env.T7_SKIP_CLARIFY) { await chat.prompt.fill('Use Corrected title instead.'); await chat.send.click({ timeout: 5000 }); await chat.user.filter({ hasText: 'Use Corrected title instead.' }).waitFor(); } // T7_SKIP
  await page.screenshot({ path: '/tmp/agent-live-stream.png' });
  await page.evaluate(() => window.aiTest.release());
  const ready = chat.status('ready'); await ready.waitFor();
  // A completed diff card opens its file in the source editor.
  await ready.locator('[data-testid="studio-chat-card"][data-card="diff"]').filter({ hasText: 'index.tpl' }).getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('tab', { name: 'Files', selected: true, exact: true }).waitFor();
  await page.locator('.source-heading').getByText('index.tpl', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await ready.locator('[data-testid="studio-chat-card"][data-card="diff"]').filter({ hasText: 'styles.css' }).waitFor();
  await ready.getByRole('button', { name: 'Preview draft', exact: true }).click();
  await preview().getByRole('heading', { name: 'Corrected title', exact: true }).waitFor();
  const requests = await page.evaluate(() => window.aiTest.requests);
  if (!process.env.T7_SKIP_CLARIFY) { // T7_SKIP
    assert.equal(requests.length, 4, 'successful host validation goes straight to independent review');
    assert.ok(requests[1].messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('Use Corrected title instead.')));
  }
  await ready.getByRole('button', { name: 'Discard', exact: true }).click();
  await chat.status('discarded').waitFor();
  await preview().getByRole('heading', { name: 'Make room for something great.', exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole('button', { name: 'styles.css', exact: true }).count(), 1);
  // Stopping and provider failure leave the project unchanged and do not retry.
  await newConversation();
  running = await start('cancel');
  await running.getByRole('button', { name: 'Stop', exact: true }).click();
  await chat.status('cancelled').waitFor();
  assert.equal(await page.getByRole('button', { name: 'styles.css', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.aiTest.requests.length), 1);
  await newConversation();
  await start('error');
  await page.evaluate(() => window.aiTest.release());
  await chat.status('failed').locator('.studio-chat-run-message').filter({ hasText: 'Mock provider failed' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'styles.css', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.aiTest.requests.length), 1);
  // Apply retains the completed changes in the working project.
  await newConversation();
  await start('success');
  await page.evaluate(() => window.aiTest.release());
  await chat.status('ready').locator('[data-testid="studio-chat-apply"]').click();
  await chat.status('applied').waitFor();
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.locator('.file-sidebar').getByTitle('index.tpl', { exact: true }).click();
  await inspectSource('Corrected title');
  assert.equal(await page.getByRole('button', { name: 'styles.css', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: held tool stream on StudioChat, mid-run clarification, edit/delete, draft preview, discard, stop, provider failure without retries, apply and Monaco inspection.');
} catch (error) { await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: '/tmp/agent-browser-error.png' }); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
