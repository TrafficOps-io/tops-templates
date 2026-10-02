// Browser scenario for StudioChat on FakeChatPort (test/fixtures/ChatPlayground.jsx): esbuild bundle, local server,
// system Chrome, external requests blocked. Run from the repository root:
//   PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/chat-browser.mjs .
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = path => fileURLToPath(new URL(path, import.meta.url));
const tokens = JSON.parse(readFileSync(here('../../studio-tokens/tokens.json'), 'utf8'));
// same map as studio-tokens/test/sync.test.js
const map = { page: '--color-base-200', surface: '--color-base-100', 'surface-raised': '--studio-surface-raised', overlay: '--studio-overlay', border: '--color-base-300', 'border-strong': '--studio-border-strong', text: '--color-base-content', muted: '--color-secondary', 'text-on-accent': '--color-primary-content', accent: '--color-primary', 'accent-hover': '--studio-accent-hover', focus: '--studio-focus', success: '--color-success', warning: '--color-warning', danger: '--color-error', info: '--color-info' };
const themeCss = Object.entries(tokens.themes).map(([name, theme]) => `[data-theme="${name}"] { ${Object.entries(map).map(([token, variable]) => `${variable}: ${theme[token]};`).join(' ')} }`).join('\n');
const screenshots = process.env.CHAT_BROWSER_SCREENSHOTS;

const bundle = await build({
  stdin: { contents: "import { createRoot } from 'react-dom/client'; import { createElement } from 'react'; import ChatPlayground from './ChatPlayground.jsx'; createRoot(document.getElementById('root')).render(createElement(ChatPlayground));", resolveDir: here('./fixtures/'), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [here('../node_modules'), here('../../../node_modules')],
});
const script = bundle.outputFiles[0].text;
const css = ['../../studio-tokens/tokens.css', '../styles.css'].map(file => readFileSync(here(file), 'utf8')).join('\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui,sans-serif}${themeCss}\n${css}</style></head><body><div id="root"></div><script src="/chat.js"></script></body></html>`;
const server = createServer((request, response) => {
  if (request.url === '/chat.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); }
  else if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); }
  else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="gray"/></svg>')}`;
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [], blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:')) return route.continue();
    blocked.push(url); return route.abort();
  });
  await page.goto(origin);
  const chat = page.getByTestId('studio-chat');
  await chat.waitFor();
  const feed = page.getByTestId('studio-chat-feed'), composer = chat.getByTestId('studio-chat-composer');
  const input = composer.getByRole('combobox');
  const fake = () => page.evaluate(() => window.fake.calls.map(([name]) => name));
  const lastCall = name => page.evaluate(target => window.fake.calls.filter(([call]) => call === target).at(-1), name);
  const assistant = () => feed.locator('[data-role="assistant"]').last();
  const send = async text => { await input.click(); await input.fill(text); await page.keyboard.press('Enter'); await page.waitForFunction(value => window.fake.calls.some(([name, , input]) => name === 'send' && input.text === value), text); };
  // Hit targets (spec 5.1): every interactive element measured here is at least 32 × 32 px.
  const assertTarget = async (locator, name) => {
    const box = await locator.boundingBox();
    assert.ok(box, `${name} is rendered`);
    assert.ok(box.height >= 32 && box.width >= 32, `${name} hit target ${Math.round(box.width)}×${Math.round(box.height)} ≥ 32 px`);
  };
  const focusedInComposer = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="studio-chat-composer"]')));

  // Empty thread: the empty state, no toast provider anywhere.
  await feed.getByText('What shall we create?').waitFor();
  assert.equal(await page.locator('.studio-toasts, .studio-toast').count(), 0);

  // Scope chips: one active chip, a non-default scope is removed by its cross; hit targets of chips, cross and archive toggle.
  const scope = composer.getByRole('group', { name: 'Assistant task' });
  for (const button of await scope.getByRole('button').all()) await assertTarget(button, `scope chip ${await button.textContent()}`);
  await scope.getByRole('button', { name: 'Scene', exact: true }).click();
  assert.equal(await scope.getByRole('button', { name: 'Scene', exact: true }).getAttribute('aria-pressed'), 'true');
  await assertTarget(scope.getByRole('button', { name: 'Remove Scene' }), 'scope remove');
  await scope.getByRole('button', { name: 'Remove Scene' }).click();
  assert.equal(await scope.getByRole('button', { name: 'Project', exact: true }).getAttribute('aria-pressed'), 'true');
  await assertTarget(page.getByTestId('studio-chat-threads').getByRole('button', { name: 'Archived' }), 'archive toggle');
  // A rejected attachment shows a notice whose Dismiss button is a full hit target.
  await composer.locator('input[type="file"]').setInputFiles({ name: 'tool.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('x') });
  await assertTarget(composer.getByRole('button', { name: 'Dismiss' }), 'composer dismiss');
  await composer.getByRole('button', { name: 'Dismiss' }).click();

  // Mention from the keyboard: @ → listbox with groups, ArrowDown + Enter insert a chip, Escape closes, Tab stays in the composer.
  await input.click();
  await page.keyboard.type('Make a video for @scene');
  const listbox = page.getByRole('listbox');
  await listbox.waitFor();
  assert.ok(await listbox.getByRole('group').count() >= 1, 'listbox has groups');
  assert.equal(await listbox.getByRole('option').count(), 2, 'Scene 1 and Scene 2');
  await page.keyboard.press('ArrowDown');
  assert.equal(await listbox.getByRole('option').nth(1).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Enter');
  await composer.locator('.studio-chip-mention', { hasText: 'Scene 2' }).waitFor();
  await assertTarget(composer.locator('.studio-chip-mention', { hasText: 'Scene 2' }).locator('.studio-chip-main'), 'mention chip');
  await assertTarget(composer.getByRole('button', { name: 'Remove Scene 2' }), 'mention chip remove');
  assert.equal(await page.getByRole('listbox').count(), 0, 'Enter picks the option and closes the menu');
  assert.equal((await input.inputValue()).includes('@scene'), false, 'the @query is removed from the text');
  await page.keyboard.type(' @');
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Tab');
  assert.ok(await focusedInComposer(), 'Tab with the menu open stays inside the composer');
  await input.focus();
  await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
  await page.keyboard.type('m');
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('listbox').count(), 0, 'Escape closes the mention menu');
  assert.ok((await input.inputValue()).startsWith('Make a video for'), 'Escape with the menu open keeps the text');
  // No matches: a status message outside any listbox, the input does not claim an expanded list.
  await input.fill('Make a video for @zzz');
  await composer.locator('.studio-mention-menu-empty[role="status"]').waitFor();
  assert.equal(await page.getByRole('listbox').count(), 0, 'no empty listbox');
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Escape');
  await input.fill('Make a video for');

  // New thread on the first send: createThread, then send into the created thread.
  await page.keyboard.press('Enter');
  await feed.locator('[data-role="user"]').waitFor();
  assert.deepEqual(await fake(), ['createThread', 'send']);
  const created = await page.evaluate(() => window.fake.calls[0][1]);
  await page.waitForFunction(id => window.threadId === id, created);
  const sent = await lastCall('send');
  assert.equal(sent[1], created, 'sent into the created thread');
  assert.deepEqual(sent[2].mentions.map(target => target.id), ['scene:s2'], 'the mention travels with the message');
  await feed.locator('[data-run-status="running"]').waitFor();
  await assertTarget(feed.getByRole('button', { name: 'Stop' }), 'run stop');
  await assertTarget(feed.locator('[data-role="user"] .studio-chip-main').first(), 'mention chip in a user message');
  assert.equal(await feed.locator('.studio-chat-run-status[data-status="running"]').count(), 1, 'run status carries data-status');
  assert.equal(await input.inputValue(), '', 'the composer is cleared after send');
  assert.equal(await composer.locator('.studio-chip-mention').count(), 0, 'mentions are cleared after send');
  const threadItem = title => page.getByTestId('studio-chat-threads').locator('.studio-chat-threads-open', { hasText: title });
  await threadItem('New chat').locator('.studio-chat-threads-running').waitFor();

  // Streaming: text-delta grows the text without duplicates and without recreating feed nodes.
  await page.evaluate(() => {
    window.removed = 0;
    window.observer = new MutationObserver(records => { for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1) window.removed++; });
    window.observer.observe(document.querySelector('[data-testid="studio-chat-feed"]'), { childList: true, subtree: true });
  });
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => window.fake.emitText('Готово '));
    await page.waitForFunction(count => (document.querySelector('[data-role="assistant"]:last-of-type .studio-chat-markdown')?.textContent.match(/Готово/g) || []).length === count, index + 1);
  }
  assert.equal(await page.evaluate(() => { window.observer.disconnect(); return window.removed; }), 0, 'no feed nodes were removed while streaming');

  // Result cards of all eight types; the streamed text survives the card snapshots.
  const video = await page.evaluate(() => window.fake.emitCard({ type: 'video', status: 'generating', progress: 0.4, name: 'scene.mp4' }));
  const videoCard = feed.locator('[data-card="video"]');
  await videoCard.waitFor();
  assert.ok((await videoCard.textContent()).includes('40%'), 'video card shows progress');
  await page.evaluate(([id, image]) => {
    const { fake } = window;
    fake.emitCard({ type: 'diff', path: 'index.tpl', added: 1, removed: 1, before: '<h1>Old</h1>', after: '<h1>New</h1>' });
    fake.emitCard({ type: 'values', section: 'Hero', changes: [{ path: 'title', before: 'Old', after: 'New' }] });
    fake.emitCard({ type: 'image', name: 'hero.png', after: image, width: 8, height: 8 });
    fake.emitCard({ type: 'audio', name: 'voice.mp3', status: 'generating', progress: 0.2 });
    fake.emitCard({ type: 'file', name: 'brief.txt', bytes: 2048 });
    fake.emitCard({ type: 'operation', label: 'Trim scene', target: { kind: 'scene', id: 'scene:s1', label: 'Scene 1' }, before: '0:05', after: '0:03' });
    fake.emitCard({ type: 'question', questionId: 'q0', text: 'Which voice?', options: ['Calm', 'Bright'] });
    fake.updateCard(id, { status: 'ready', url: 'data:video/mp4;base64,', durationMs: 4000 });
  }, [video, IMAGE]);
  for (const type of ['diff', 'values', 'image', 'audio', 'video', 'file', 'operation', 'question']) await feed.locator(`[data-card="${type}"]`).first().waitFor();
  for (const type of ['diff', 'values', 'image', 'audio', 'video', 'file', 'operation', 'question']) assert.equal(await feed.locator(`[data-card="${type}"]`).count(), 1, `${type} card`);
  await videoCard.locator('video').waitFor();
  assert.equal((await assistant().locator('.studio-chat-markdown').textContent()).match(/Готово/g).length, 3, 'streamed text kept once after card snapshots');
  await assertTarget(feed.locator('[data-card="values"] .studio-card-action').first(), 'card action');
  // Malformed results do not break the feed.
  await page.evaluate(() => { window.fake.emitCard({ type: 'values', section: 'Broken' }); });
  await feed.locator('[data-card="values"]', { hasText: 'Broken' }).waitFor();
  // A rejected card action is an inline notice in the feed.
  await page.evaluate(() => { window.fake.answer = async () => { throw new Error('Answer rejected by the port'); }; });
  await feed.locator('[data-card="question"]').getByRole('button', { name: 'Calm' }).click();
  await feed.getByRole('alert').filter({ hasText: 'Answer rejected by the port' }).waitFor();
  await feed.getByRole('alert').filter({ hasText: 'Answer rejected by the port' }).getByRole('button', { name: 'Dismiss' }).click();

  // Ready → Apply.
  await page.evaluate(() => window.fake.finish('ready', { cost: 0.12 }));
  await feed.locator('[data-run-status="ready"]').waitFor();
  await page.locator('.studio-chat-header-cost', { hasText: '$0.12' }).waitFor();
  await page.getByTestId('studio-chat-apply').click();
  await feed.locator('[data-run-status="applied"]').waitFor();
  assert.equal((await lastCall('apply'))[1], await assistant().getAttribute('data-run-id'));

  // Discard.
  await send('Second idea');
  await page.evaluate(() => window.fake.finish('ready'));
  await feed.locator('[data-role="assistant"][data-run-status="ready"]').waitFor();
  await assistant().getByRole('button', { name: 'Discard' }).click();
  await feed.locator('[data-role="assistant"][data-run-status="discarded"]').waitFor();
  assert.ok(await lastCall('discard'));

  // Failed → Keep draft and Continue generation.
  await send('Third idea');
  await page.evaluate(() => window.fake.finish('failed', { message: 'Render failed' }));
  await feed.locator('[data-role="assistant"][data-run-status="failed"]').waitFor();
  await page.getByTestId('studio-chat-keep-draft').click();
  await page.waitForFunction(() => window.fake.calls.some(([name]) => name === 'keepDraft'));
  await page.getByTestId('studio-chat-continue').click();
  await feed.locator('[data-role="assistant"][data-run-status="running"]').waitFor();
  assert.ok(await lastCall('continueRun'));

  // Conflict gate: Apply after reviewing is disabled until the checkbox is ticked.
  await page.evaluate(() => window.fake.emitCard({ type: 'question', kind: 'conflict', questionId: 'q1', text: 'The project changed while the assistant worked.', references: ['hero.tpl'], options: ['reviewed', 'rebase'] }));
  const gate = page.getByRole('button', { name: 'Apply after reviewing updated context' });
  await gate.waitFor();
  assert.equal(await gate.isDisabled(), true, 'disabled before review');
  await page.getByLabel('I reviewed the current files').check();
  assert.equal(await gate.isDisabled(), false, 'enabled after review');
  await gate.click();
  await page.waitForFunction(() => window.fake.calls.some(([name, , options]) => name === 'apply' && options?.allowStaleContext === true));

  // Policy error on send → InlineNotice (role=alert), no toasts.
  await page.evaluate(() => { window.fake.rejectSend = true; });
  await input.click(); await input.fill('This will fail'); await page.keyboard.press('Enter');
  const notice = page.getByRole('alert').filter({ hasText: 'AI key is not configured.' });
  await notice.waitFor();
  assert.ok((await notice.textContent()).includes('The message was not sent'));
  assert.equal(await page.locator('.studio-toasts, .studio-toast').count(), 0, 'no toasts');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await page.evaluate(() => { window.fake.rejectSend = false; });

  // Header actions menu: onSelect gets the composer text; Escape closes the menu.
  await input.fill('Draft for the action');
  const more = page.getByRole('button', { name: 'More actions' });
  await more.click();
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0, 'Escape closes the menu');
  await more.click();
  await page.getByRole('menuitem', { name: 'Create the project anew' }).click();
  assert.deepEqual(await page.evaluate(() => window.actionCalls), ['Draft for the action']);

  // External launch: a new launch.id fills text, mentions and files.
  await page.evaluate(() => window.launch({ id: crypto.randomUUID(), text: 'From the home screen', mentions: [{ kind: 'track', id: 'track:music', label: 'Music track' }], attachments: [new File(['brief'], 'brief.txt', { type: 'text/plain' })] }));
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea[role="combobox"]').value === 'From the home screen');
  await composer.locator('.studio-chip-mention', { hasText: 'Music track' }).waitFor();
  await composer.getByText('brief.txt').waitFor();

  // Thread list: create, rename, archive, delete.
  const threads = page.getByTestId('studio-chat-threads');
  await threads.getByRole('button', { name: 'New conversation' }).click();
  await page.waitForFunction(first => window.threadId && window.threadId !== first, created);
  const second = await page.evaluate(() => window.threadId);
  await feed.getByText('What shall we create?').waitFor();
  await threads.getByRole('button', { name: 'Conversation actions: New chat' }).first().click();
  await page.getByRole('menuitem', { name: 'Rename conversation' }).click();
  await threads.getByLabel('Conversation title').fill('Renamed');
  await page.keyboard.press('Enter');
  await threadItem('Renamed').waitFor();
  assert.equal((await lastCall('renameThread'))[2], 'Renamed');
  await threads.getByRole('button', { name: 'Conversation actions: Renamed' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.waitForFunction(() => window.fake.calls.some(([name, , archived]) => name === 'archiveThread' && archived === true));
  assert.equal(await threadItem('Renamed').count(), 0, 'archived thread leaves the list');
  await threads.getByRole('button', { name: 'Archived' }).click();
  await threads.getByRole('button', { name: 'Conversation actions: Renamed' }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await page.waitForFunction(id => window.fake.calls.some(([name, threadId]) => name === 'deleteThread' && threadId === id), second);
  await page.waitForFunction(() => window.threadId === '');
  await threads.getByRole('button', { name: 'Archived' }).click();
  await threadItem('New chat').click();
  await page.waitForFunction(id => window.threadId === id, created);
  await feed.locator('[data-card="video"]').waitFor();
  assert.equal(await feed.getByText('What shall we create?').count(), 0, 'switching back shows the thread messages');

  // Standalone composer: an async onSubmit blocks a second submit, a rejection keeps the text and shows a notice.
  await page.evaluate(() => { window.standaloneCalls = 0; window.standaloneSubmit = () => { window.standaloneCalls++; return new Promise((_, reject) => setTimeout(() => reject(new Error('Project creation failed')), 300)); }; });
  const standalone = page.locator('#standalone');
  await standalone.locator('textarea').fill('A landing for a bakery');
  await standalone.locator('textarea').press('Enter');
  await standalone.locator('textarea').press('Enter');
  const standaloneNotice = standalone.getByRole('alert').filter({ hasText: 'Project creation failed' });
  await standaloneNotice.waitFor();
  assert.equal(await page.evaluate(() => window.standaloneCalls), 1, 'second submit blocked while pending');
  assert.equal(await standalone.locator('textarea').inputValue(), 'A landing for a bakery', 'text kept after a rejection');
  await standaloneNotice.getByRole('button', { name: 'Dismiss' }).click();

  // Narrow chat (< 560 px): the list collapses into the header menu.
  if (screenshots) { mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: `${screenshots}/chat-dark.png`, fullPage: true }); }
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="studio-chat-threads"]')).display === 'none');
  assert.equal(await threads.isVisible(), false, 'thread list hidden');
  const conversations = page.locator('.studio-chat-header').getByRole('button', { name: 'Conversations' });
  assert.equal(await conversations.isVisible(), true, 'header conversations menu visible');
  await conversations.click();
  await page.getByRole('menuitem', { name: 'New chat' }).waitFor();
  await page.getByRole('menuitem', { name: 'New conversation' }).click();
  await page.waitForFunction(id => window.threadId && window.threadId !== id, created);
  if (screenshots) await page.screenshot({ path: `${screenshots}/chat-narrow.png` });
  await page.setViewportSize({ width: 1100, height: 900 });
  assert.equal(await threads.isVisible(), true, 'thread list back on a wide chat');

  // Both themes: the chat follows the theme tokens.
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="studio-chat"]')).backgroundColor);
  const dark = await background();
  await page.evaluate(() => window.setTheme('studio-light'));
  await page.waitForFunction(value => getComputedStyle(document.querySelector('[data-testid="studio-chat"]')).backgroundColor !== value, dark);
  const light = await background();
  const expected = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--ui-page)'; document.querySelector('.studio-root').append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; });
  assert.equal(light, expected, 'light background is --ui-page');
  await page.evaluate(() => window.setThreadId(window.fake.calls.find(([name]) => name === 'createThread')[1]));
  await feed.locator('[data-card="video"]').waitFor();
  if (screenshots) await page.screenshot({ path: `${screenshots}/chat-light.png`, fullPage: true });

  assert.deepEqual(blocked, [], 'no external requests');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('chat-browser: OK');
} finally { await browser.close(); server.close(); }
