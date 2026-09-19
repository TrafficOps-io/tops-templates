import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
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
      const state = window.aiTest, body = JSON.parse(options.body); state.requests.push(body);
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
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Browser test');
  await page.getByRole('button', { name: 'Create landing', exact: true }).click();
  await page.locator('.browser-frame iframe').waitFor();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await page.getByRole('button', { name: 'AI connection settings', exact: true }).click();
  await page.locator('.ai-settings input[type=password]').fill('mock-key-no-paid-calls');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  const start = async outcome => {
    await page.evaluate(outcome => { Object.assign(window.aiTest, { step: 0, requests: [], outcome }); }, outcome);
    await page.locator('.ai-prompt textarea').fill('Replace the page and remove its obsolete stylesheet.');
    await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
    await page.getByLabel('Live file changes', { exact: true }).filter({ hasText: 'First title' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Apply changes', exact: true }).count(), 0);
    await page.locator('.browser-frame iframe').contentFrame().getByRole('heading', { name: 'First title', exact: true }).waitFor();
  };
  const inspectSource = async text => {
    const visible = page.locator('.view-lines').filter({ hasText: text });
    for (let scroll = 0; scroll < 15 && !(await visible.count()); scroll++) {
      await page.locator('.monaco-editor').hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(180);
    }
    await visible.waitFor({ timeout: 3000 });
  };
  // A focused partial edit updates the preview, panel and Monaco while the response is held open.
  await start('success');
  await page.getByLabel('Clarify while the assistant works', { exact: true }).fill('Use Corrected title instead.');
  await page.getByRole('button', { name: 'Send clarification', exact: true }).click();
  await page.getByText('Queued for the next model step: 1', { exact: true }).waitFor();
  await page.locator('.ai-live-heading').getByRole('button', { name: 'index.tpl', exact: true }).click();
  await inspectSource('First title');
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await page.locator('.ai-steering').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/agent-live-stream.png' });
  await page.evaluate(() => window.aiTest.release());
  await page.getByText('Changes ready', { exact: true }).waitFor();
  await page.getByText('Deleted styles.css', { exact: true }).waitFor();
  await page.locator('.browser-frame iframe').contentFrame().getByRole('heading', { name: 'Corrected title', exact: true }).waitFor();
  const requests = await page.evaluate(() => window.aiTest.requests);
  assert.equal(requests.length, 5);
  assert.ok(requests[1].messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('Use Corrected title instead.')));
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.locator('.browser-frame iframe').contentFrame().getByRole('heading', { name: 'Make room for something great.', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'styles.css', exact: true }).count(), 1);
  // Cancelling and provider failure discard speculative source and do not retry.
  await start('cancel');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Generation cancelled. Your project is unchanged.', { exact: true }).waitFor();
  assert.equal(await page.locator('.ai-live-file').count(), 0);
  assert.equal(await page.evaluate(() => window.aiTest.requests.length), 1);
  await start('error');
  await page.evaluate(() => window.aiTest.release());
  await page.getByRole('alert').filter({ hasText: 'Mock provider failed' }).waitFor();
  assert.equal(await page.locator('.ai-live-file').count(), 0);
  assert.equal(await page.evaluate(() => window.aiTest.requests.length), 1);
  // Apply retains the completed changes in the working project.
  await start('success');
  await page.evaluate(() => window.aiTest.release());
  await page.getByText('Changes ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await inspectSource('Corrected title');
  assert.equal(await page.getByRole('button', { name: 'styles.css', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: partial source before tool completion, Monaco inspection, mid-run clarification, edit/delete, preview, discard, cancellation, provider failure without retries, apply.');
} catch (error) { await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: '/tmp/agent-browser-error.png' }); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
