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
  else if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); }
  else if (request.url.split('?')[0] === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); }
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

  // composerExtra lands in the composer toolbar (a compact ModelPicker in the playground).
  await composer.locator('.studio-chat-composer-toolbar .studio-model-picker-compact').getByRole('button', { name: 'Assistant model: GPT-4o mini' }).waitFor();

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
  assert.deepEqual(await page.evaluate(() => window.scopes), [{ kind: 'scene' }, { kind: 'project' }], 'onScopeChange reports the chip and its removal, not the mount');
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
  // Without capabilities.clarifyWhileRunning the composer does not send during a run.
  await input.fill('Not yet');
  assert.equal(await composer.getByRole('button', { name: 'Send message' }).isDisabled(), true, 'send is disabled while running');
  await input.fill('');
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

  // Without capabilities.discardStopped a failed run with draft cards offers no Discard (Media Studio accepts discard for ready only).
  await send('Broken idea');
  await page.evaluate(() => { window.fake.emitCard({ type: 'diff', path: 'index.tpl', added: 1, removed: 0, before: '', after: '<p>Half</p>' }); window.fake.finish('failed', { message: 'Model timed out' }); });
  await assistant().and(page.locator('[data-run-status="failed"]')).waitFor();
  assert.equal(await assistant().getByTestId('studio-chat-discard').count(), 0, 'no Discard without capabilities.discardStopped');

  // Failed → Keep draft and Continue generation.
  await send('Third idea');
  await page.evaluate(() => window.fake.finish('failed', { message: 'Render failed' }));
  await assistant().and(page.locator('[data-run-status="failed"]')).waitFor();
  assert.equal(await assistant().getByTestId('studio-chat-discard').count(), 0, 'no Discard for a failed run without draft cards');
  await assistant().getByTestId('studio-chat-keep-draft').click();
  await page.waitForFunction(() => window.fake.calls.some(([name]) => name === 'keepDraft'));
  // Continue generation sends the composer text as the prompt and clears the composer.
  await input.fill('Use a warmer tone');
  await assistant().getByTestId('studio-chat-continue').click();
  await feed.locator('[data-role="assistant"][data-run-status="running"]').waitFor();
  assert.equal((await lastCall('continueRun'))[2], 'Use a warmer tone', 'continueRun gets the composer text');
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea[role="combobox"]').value === '');

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
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea[role="combobox"]').value === 'This will fail', null, { timeout: 5000 });
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  // A rejected first message of a new conversation: the created thread is deleted, the previous (empty) thread id comes back,
  // text, mentions and files return to the composer.
  await page.evaluate(() => window.setThreadId(''));
  await page.waitForFunction(() => window.threadId === '');
  const scopesBeforeLaunch = await page.evaluate(() => window.scopes.length);
  await page.evaluate(() => window.launch({ id: crypto.randomUUID(), text: 'Rejected first message', mentions: [{ kind: 'scene', id: 'scene:s1', label: 'Scene 1' }], attachments: [new File(['x'], 'note.txt', { type: 'text/plain' })] }));
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea[role="combobox"]').value === 'Rejected first message');
  assert.deepEqual(await page.evaluate(n => window.scopes.slice(n), scopesBeforeLaunch), [{ kind: 'project' }], 'a launch without scope reports the default scope');
  const threadsBefore = await page.evaluate(() => window.fake.threads.get().length);
  await input.click(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.fake.calls.at(-1)?.[0] === 'deleteThread');
  const rejectedThread = await lastCall('deleteThread');
  assert.equal((await lastCall('createThread'))[1], rejectedThread[1], 'the thread created for the send is deleted');
  await page.waitForFunction(() => window.threadId === '');
  assert.equal(await page.evaluate(() => window.fake.threads.get().length), threadsBefore, 'no empty thread is left');
  await page.getByRole('alert').filter({ hasText: 'AI key is not configured.' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea[role="combobox"]').value === 'Rejected first message', null, { timeout: 5000 });
  await composer.locator('.studio-chip-mention', { hasText: 'Scene 1' }).waitFor();
  await composer.getByText('note.txt').waitFor();
  await page.getByRole('alert').filter({ hasText: 'AI key is not configured.' }).getByRole('button', { name: 'Dismiss' }).click();
  await page.evaluate(() => { window.fake.rejectSend = false; });
  await page.evaluate(id => window.setThreadId(id), created);
  await page.waitForFunction(id => window.threadId === id, created);

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
  await page.close();

  // ModelPicker: 400+ options, sections, search, filters, keyboard, inherit row, disabled rows, compact mode in the composer.
  {
    const picking = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const pickerErrors = [];
    picking.on('pageerror', error => pickerErrors.push(error.message));
    picking.on('console', message => { if (message.type() === 'error') pickerErrors.push(message.text()); });
    await picking.goto(origin);
    const demo = picking.locator('#model-picker-demo'), trigger = demo.getByRole('button', { name: 'Assistant model: As in global settings' });
    await trigger.scrollIntoViewIfNeeded();
    await assertTarget(trigger, 'model picker trigger');
    const started = Date.now();
    await trigger.click();
    const listbox = demo.getByRole('listbox', { name: 'Assistant model' }), search = demo.getByRole('combobox', { name: 'Search models' });
    await listbox.waitFor();
    const openMs = Date.now() - started;
    assert.ok(openMs < 1500, `opens with 400+ models in ${openMs} ms`);
    assert.equal(await search.evaluate(element => element === document.activeElement), true, 'focus goes to the search field');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    const options = listbox.getByRole('option');
    assert.equal(await options.first().getAttribute('aria-selected'), 'true', 'the inherit row (value null) is active');
    assert.equal(await options.first().getAttribute('data-current'), 'true');
    assert.ok((await options.first().textContent()).includes('Gemini 2.5 Flash'), 'inherit detail');
    for (const name of ['Recent', 'Recommended', 'All models', 'OpenAI', 'Google']) assert.ok(await listbox.getByRole('group', { name, exact: true }).count() >= 1, `group ${name}`);
    const rendered = await options.count();
    assert.ok(rendered <= 1 + 2 + 2 + 200, `at most 200 options in All are rendered (${rendered})`);
    const more = demo.getByRole('button', { name: 'Show 200 more' });
    await more.click();
    assert.ok(await options.count() > rendered, 'Show more renders the next page');
    assert.equal(await search.evaluate(element => element === document.activeElement), false, 'Show more took the focus');
    await search.focus();
    // Context, price and badges in a row.
    const flash = listbox.getByRole('group', { name: 'Recommended' }).getByRole('option').first();
    const flashText = await flash.textContent();
    for (const token of ['google/gemini-2.5-flash', '1M context', 'In $0.30', 'Out $2.50', 'Tools', 'Vision', 'Audio', 'Reasoning']) assert.ok(flashText.includes(token), token);
    // Search: Recent and Recommended give way to matches, the first match is active; ↑↓ wrap, Enter picks.
    await search.fill('gpt-4o');
    await picking.waitForFunction(() => document.querySelectorAll('#model-picker-demo [role="option"]').length === 1);
    assert.equal(await listbox.getByRole('group', { name: 'Recent' }).count(), 0, 'no Recent while searching');
    assert.equal(await options.first().getAttribute('aria-selected'), 'true');
    await search.fill('model-1');
    await picking.waitForFunction(() => document.querySelectorAll('#model-picker-demo [role="option"]').length > 3);
    await picking.keyboard.press('ArrowDown');
    assert.equal(await options.nth(1).getAttribute('aria-selected'), 'true', 'ArrowDown');
    assert.equal(await search.getAttribute('aria-activedescendant'), await options.nth(1).getAttribute('id'));
    await picking.keyboard.press('ArrowUp'); await picking.keyboard.press('ArrowUp');
    assert.equal(await options.last().getAttribute('aria-selected'), 'true', 'ArrowUp wraps to the last option');
    await picking.keyboard.press('ArrowDown'); await picking.keyboard.press('ArrowDown');
    const picked = (await options.nth(1).locator('.studio-model-option-id').textContent()).trim();
    await picking.keyboard.press('Enter');
    await listbox.waitFor({ state: 'detached' });
    assert.deepEqual(await picking.evaluate(() => window.pickerChanges), [picked], 'Enter picks the active option');
    const pickedName = await picking.evaluate(id => window.models.find(model => model.id === id).name, picked);
    const pickedTrigger = demo.getByRole('button', { name: `Assistant model: ${pickedName}` });
    await pickedTrigger.waitFor();
    assert.equal(await pickedTrigger.evaluate(element => element === document.activeElement), true, 'focus returns to the trigger');
    // Escape closes and returns focus; ArrowDown on the trigger opens.
    await picking.keyboard.press('ArrowDown');
    await listbox.waitFor();
    await picking.keyboard.press('Escape');
    await listbox.waitFor({ state: 'detached' });
    assert.equal(await pickedTrigger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the trigger');
    // Filters: every option is free; a disabled row shows its reason and Enter does not pick it.
    await pickedTrigger.click();
    await listbox.waitFor();
    const filters = demo.getByRole('group', { name: 'Model filters' });
    for (const name of ['Uses tools', 'Sees images', 'Hears audio', 'Free models']) await filters.getByRole('button', { name }).waitFor();
    await filters.getByRole('button', { name: 'Free models' }).click();
    assert.equal(await filters.getByRole('button', { name: 'Free models' }).getAttribute('aria-pressed'), 'true');
    const free = await listbox.locator('[role="option"]').evaluateAll(rows => rows.filter(row => !row.textContent.includes('As in global settings')).map(row => row.querySelector('.studio-model-badge-free') !== null));
    assert.ok(free.length > 0 && free.every(Boolean), 'only free models with the filter');
    await filters.getByRole('button', { name: 'Free models' }).click();
    await search.focus();
    await search.fill('mistral 7b');
    await picking.waitForFunction(() => document.querySelectorAll('#model-picker-demo [role="option"]').length === 1);
    assert.equal(await options.first().getAttribute('aria-disabled'), 'true');
    assert.ok((await options.first().textContent()).includes('Does not support tools'), 'the reason is shown');
    await picking.keyboard.press('Enter');
    await options.first().click({ force: true });
    assert.equal(await listbox.isVisible(), true, 'a disabled row is not selectable');
    assert.equal((await picking.evaluate(() => window.pickerChanges)).length, 1);
    await search.fill('zzzz-no-model');
    await demo.getByRole('status').filter({ hasText: 'No models match' }).waitFor();
    // The inherit row returns to null.
    await search.fill('');
    await options.first().click();
    await listbox.waitFor({ state: 'detached' });
    assert.deepEqual((await picking.evaluate(() => window.pickerChanges)).at(-1), null, 'the inherit row selects null');
    // A click outside closes the popover.
    await trigger.click();
    await listbox.waitFor();
    await picking.mouse.click(5, 5);
    await listbox.waitFor({ state: 'detached' });

    // Compact picker in the composer: name only, opens above the composer, keyboard pick.
    const compact = picking.getByTestId('studio-chat-composer').getByRole('button', { name: 'Assistant model: GPT-4o mini' });
    assert.equal((await compact.textContent()).trim(), 'GPT-4o mini', 'compact trigger shows only the name');
    await compact.click();
    const popover = picking.getByTestId('studio-chat-composer').locator('.studio-model-popover');
    await popover.waitFor();
    assert.equal(await popover.getAttribute('data-placement'), 'top', 'opens above the composer');
    const box = await popover.boundingBox();
    assert.ok(box.y >= 0, 'the popover stays inside the viewport');
    if (screenshots) await picking.screenshot({ path: `${screenshots}/model-picker-dark.png` });
    await picking.evaluate(() => window.setTheme('studio-light'));
    if (screenshots) await picking.screenshot({ path: `${screenshots}/model-picker-light.png` });
    await picking.keyboard.type('gemini');
    await picking.keyboard.press('Enter');
    await picking.getByTestId('studio-chat-composer').getByRole('button', { name: 'Assistant model: Gemini 2.5 Flash' }).waitFor();
    assert.deepEqual(pickerErrors, [], 'no page errors in the model picker scenario');
    await picking.close();
  }

  // Branches, Regenerate, Edit, Retry and step cards (FakeChatPort keeps a tree).
  {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const branching = await context.newPage();
    const pageErrors = [];
    branching.on('pageerror', error => pageErrors.push(error.message));
    branching.on('console', message => { if (message.type() === 'error') pageErrors.push(`${message.text()} ${message.location()?.url ?? ''}`); });
    await branching.goto(origin);
    const root = branching.getByTestId('studio-chat'), list = branching.getByTestId('studio-chat-feed'), field = root.getByTestId('studio-chat-composer').getByRole('combobox');
    const calls = name => branching.evaluate(target => window.fake.calls.filter(([call]) => call === target), name);
    const lastAssistant = () => list.locator('[data-role="assistant"]').last();
    // The actions fade (transition): poll until the computed opacity settles.
    const opacity = async locator => { await locator.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished))); return locator.evaluate(element => Number(getComputedStyle(element).opacity)); };
    await field.click(); await field.fill('Branch request'); await branching.keyboard.press('Enter');
    await list.locator('[data-run-status="running"]').waitFor();
    const thread = await branching.evaluate(() => window.threadId);
    assert.equal(await field.inputValue(), '', 'fill + Enter in one batch still clears the composer');
    for (const name of ['Regenerate response', 'Edit message', 'Copy']) assert.equal(await list.getByRole('button', { name, exact: true }).count(), 0, `${name} is hidden while running`);
    // Step cards: one compact line each, not framed cards and not drafts.
    await branching.evaluate(() => {
      const { fake } = window;
      fake.emitCard({ type: 'step', label: 'Read scene 2', status: 'done' });
      fake.emitCard({ type: 'step', label: 'Storyboard', status: 'running', agent: 'storyboard' });
      fake.emitCard({ type: 'step', label: 'edit_track', status: 'error', detail: 'durationMs must be > 0 (fixing)' });
      fake.emitText('First answer');
    });
    await list.locator('[data-card="step"]').nth(2).waitFor();
    assert.equal(await list.locator('[data-card="step"]').count(), 3);
    assert.equal(await list.locator('[data-card="step"] .studio-card-header').count(), 0, 'steps are not framed cards');
    assert.ok((await list.locator('[data-card="step"][data-status="error"]').textContent()).includes('durationMs must be > 0'), 'error detail');
    assert.ok((await list.locator('[data-card="step"][data-status="running"]').textContent()).includes('storyboard'), 'subagent label');
    assert.equal(await list.locator('[data-card="step"][data-status="running"] .studio-step-icon').evaluate(element => getComputedStyle(element).animationName), 'studio-spin', 'running step spins');
    if (screenshots) await branching.screenshot({ path: `${screenshots}/chat-steps-dark.png` });
    await branching.evaluate(() => window.fake.finish('completed'));
    await list.locator('[data-run-status="completed"]').waitFor();
    assert.equal(await root.getByTestId('studio-chat-retry').count(), 0, 'no Retry for a completed run');

    // Actions: the user message shows them on hover and focus, the last message always.
    const user = list.locator('[data-role="user"]').first(), editButton = user.getByRole('button', { name: 'Edit message' });
    await branching.mouse.move(1, 1);
    await editButton.waitFor({ state: 'attached' });
    assert.equal(await opacity(user.locator('.studio-chat-message-actions')), 0, 'hidden until hover or focus');
    await editButton.focus();
    assert.equal(await opacity(user.locator('.studio-chat-message-actions')), 1, 'focus shows the actions');
    assert.equal(await opacity(lastAssistant().locator('.studio-chat-message-actions')), 1, 'the last message shows its actions');
    await branching.keyboard.press('Shift+Tab');
    assert.equal(await lastAssistant().getByRole('group', { name: 'Versions' }).count(), 0, 'no branch picker for a single version');
    for (const name of ['Copy', 'Regenerate response']) await assertTarget(lastAssistant().getByRole('button', { name, exact: true }), name);

    // Copy writes the message text.
    await lastAssistant().getByRole('button', { name: 'Copy', exact: true }).click();
    await lastAssistant().locator('[data-copied]').waitFor();
    assert.equal(await branching.evaluate(() => navigator.clipboard.readText()), 'First answer');

    // Regenerate → a sibling answer; ‹ 2/2 › switches between the versions.
    const first = await lastAssistant().getAttribute('data-run-id');
    await lastAssistant().getByRole('button', { name: 'Regenerate response' }).click();
    await branching.waitForFunction(() => window.fake.calls.some(([name]) => name === 'regenerate'));
    assert.deepEqual((await calls('regenerate')).at(-1), ['regenerate', thread, first]);
    await list.locator('[data-role="assistant"][data-run-status="running"]').waitFor();
    assert.equal(await list.getByRole('group', { name: 'Versions' }).count(), 0, 'branch picker hidden while running');
    await branching.evaluate(() => { window.fake.emitText('Second answer'); window.fake.finish('completed'); });
    const picker = lastAssistant().getByRole('group', { name: 'Versions' });
    await picker.waitFor();
    assert.equal((await picker.textContent()).includes('2/2'), true);
    assert.equal(await picker.getByRole('button', { name: 'Next version' }).isDisabled(), true, 'no next at the last version');
    await assertTarget(picker.getByRole('button', { name: 'Previous version' }), 'previous version');
    await picker.getByRole('button', { name: 'Previous version' }).click();
    await list.locator(`[data-run-id="${first}"]`).waitFor();
    assert.deepEqual((await calls('switchBranch')).at(-1), ['switchBranch', thread, first]);
    assert.ok((await lastAssistant().textContent()).includes('First answer'), 'the first version is shown');
    assert.ok((await lastAssistant().getByRole('group', { name: 'Versions' }).textContent()).includes('1/2'));

    // Edit: Escape cancels, Enter saves the new text as a sibling of the user message.
    await user.getByRole('button', { name: 'Edit message' }).click();
    const editor = list.getByRole('textbox', { name: 'Edit message' });
    await editor.waitFor();
    assert.equal(await editor.inputValue(), 'Branch request');
    assert.equal(await editor.evaluate(element => element === document.activeElement), true, 'the edit composer takes focus');
    await branching.keyboard.press('Escape');
    await list.locator('[data-role="user"]', { hasText: 'Branch request' }).getByRole('button', { name: 'Edit message' }).waitFor({ state: 'attached' });
    assert.equal((await calls('editMessage')).length, 0, 'Escape does not edit');
    await list.locator('[data-role="user"]').first().getByRole('button', { name: 'Edit message' }).click();
    await editor.fill('Edited request');
    await list.getByRole('button', { name: 'Save' }).waitFor();
    await branching.keyboard.press('Enter');
    await branching.waitForFunction(() => window.fake.calls.some(([name]) => name === 'editMessage'));
    const [, editThread, editedId, editInput] = (await calls('editMessage')).at(-1);
    assert.equal(editThread, thread); assert.deepEqual(editInput, { text: 'Edited request' });
    assert.notEqual(editedId, undefined);
    await list.locator('[data-role="user"]', { hasText: 'Edited request' }).waitFor();
    await list.locator('[data-role="assistant"][data-run-status="running"]').waitFor();
    await branching.evaluate(() => window.fake.finish('completed'));
    await list.locator('[data-role="user"]').first().getByRole('group', { name: 'Versions' }).waitFor();
    assert.ok((await list.locator('[data-role="user"]').first().getByRole('group', { name: 'Versions' }).textContent()).includes('2/2'), 'the edit is the second version of the question');

    // Retry under a failed run regenerates it; the action bar does not repeat it as Regenerate.
    await field.click(); await field.fill('Will fail'); await branching.keyboard.press('Enter');
    await list.locator('[data-run-status="running"]').waitFor();
    await branching.evaluate(() => { window.fake.emitText('Partial'); window.fake.finish('failed', { message: 'Provider overloaded' }); });
    await lastAssistant().and(branching.locator('[data-run-status="failed"]')).waitFor();
    const failedRun = await lastAssistant().getAttribute('data-run-id');
    assert.equal(await lastAssistant().getByRole('button', { name: 'Regenerate response' }).count(), 0, 'no second regenerate button next to Retry');
    await assertTarget(lastAssistant().getByTestId('studio-chat-retry'), 'retry');
    await lastAssistant().getByTestId('studio-chat-retry').click();
    await lastAssistant().and(branching.locator('[data-run-status="running"]')).waitFor();
    assert.deepEqual((await calls('regenerate')).at(-1), ['regenerate', thread, failedRun]);

    // A rejected regenerate is the "The action failed" notice.
    await branching.evaluate(() => { window.fake.finish('completed'); window.fake.rejectBranching = true; });
    await lastAssistant().and(branching.locator('[data-run-status="completed"]')).waitFor();
    await lastAssistant().getByRole('button', { name: 'Regenerate response' }).click();
    const rejected = branching.getByRole('alert').filter({ hasText: 'Regenerate rejected by the port' });
    await rejected.waitFor();
    assert.ok((await rejected.textContent()).includes('The action failed'));
    await rejected.getByRole('button', { name: 'Dismiss' }).click();
    if (screenshots) await branching.screenshot({ path: `${screenshots}/chat-branches-dark.png`, fullPage: true });
    await branching.evaluate(() => window.setTheme('studio-light'));
    if (screenshots) await branching.screenshot({ path: `${screenshots}/chat-branches-light.png`, fullPage: true });
    assert.deepEqual(pageErrors, [], 'no page errors in the branching scenario');
    await context.close();
  }

  // A port without regenerate, editMessage and switchBranch: no Regenerate, Edit, branch picker or Retry; Copy stays.
  {
    const plain = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await plain.goto(`${origin}/?noBranching=1`);
    const list = plain.getByTestId('studio-chat-feed'), field = plain.getByTestId('studio-chat-composer').getByRole('combobox');
    await field.click(); await field.fill('Plain request'); await plain.keyboard.press('Enter');
    await list.locator('[data-run-status="running"]').waitFor();
    await plain.evaluate(() => { window.fake.emitText('Plain answer'); window.fake.finish('failed', { message: 'Timed out' }); });
    await list.locator('[data-run-status="failed"]').waitFor();
    await list.getByRole('button', { name: 'Copy', exact: true }).first().waitFor({ state: 'attached' });
    for (const name of ['Regenerate response', 'Edit message', 'Previous version']) assert.equal(await list.getByRole('button', { name }).count(), 0, `${name} without the port method`);
    assert.equal(await plain.getByTestId('studio-chat-retry').count(), 0, 'no Retry without port.regenerate');
    await plain.close();
  }

  // capabilities.discardStopped: a failed run that left draft cards offers Discard; a failed run without cards does not.
  {
    const stopped = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await stopped.goto(`${origin}/?discardStopped=1`);
    const box = stopped.getByTestId('studio-chat').getByTestId('studio-chat-composer'), field = box.getByRole('combobox');
    const last = () => stopped.getByTestId('studio-chat-feed').locator('[data-role="assistant"]').last();
    const submit = async (text, cards) => {
      const before = await stopped.evaluate(() => window.fake.calls.filter(([name]) => name === 'send').length);
      await field.click(); await field.fill(text); await stopped.keyboard.press('Enter');
      await stopped.waitForFunction(count => window.fake.calls.filter(([name]) => name === 'send').length > count, before);
      await stopped.getByTestId('studio-chat-feed').locator('[data-run-status="running"]').waitFor();
      await stopped.evaluate(withCards => { if (withCards) window.fake.emitCard({ type: 'values', section: 'Hero', changes: [{ path: 'title', before: 'Old', after: 'Half' }] }); window.fake.finish('failed', { message: 'Model timed out' }); }, cards);
      await last().and(stopped.locator('[data-run-status="failed"]')).waitFor();
    };
    await submit('Plain failure', false);
    assert.equal(await last().getByTestId('studio-chat-discard').count(), 0, 'no Discard for a failed run without draft cards');
    await submit('Broken idea', true);
    await last().getByTestId('studio-chat-discard').click();
    await last().and(stopped.locator('[data-run-status="discarded"]')).waitFor();
    assert.equal((await stopped.evaluate(() => window.fake.calls.filter(([name]) => name === 'discard').at(-1)))[1], await last().getAttribute('data-run-id'), 'discard gets the failed run');
    await stopped.close();
  }

  // capabilities.clarifyWhileRunning: the composer sends during a run into the same thread (a clarification).
  {
    const clarify = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await clarify.goto(`${origin}/?clarify=1`);
    const box = clarify.getByTestId('studio-chat').getByTestId('studio-chat-composer'), field = box.getByRole('combobox');
    await field.click(); await field.fill('First request'); await clarify.keyboard.press('Enter');
    await clarify.getByTestId('studio-chat-feed').locator('[data-run-status="running"]').waitFor();
    const thread = await clarify.evaluate(() => window.threadId);
    await field.fill('Make it blue');
    assert.equal(await box.getByRole('button', { name: 'Send message' }).isDisabled(), false, 'send is enabled while running');
    await clarify.keyboard.press('Enter');
    await clarify.waitForFunction(() => window.fake.calls.some(([name, , input]) => name === 'send' && input.text === 'Make it blue'));
    const calls = await clarify.evaluate(() => window.fake.calls.filter(([name]) => name === 'send').map(([, id]) => id));
    assert.deepEqual(calls, [thread, thread], 'the clarification goes to the same thread');
    assert.equal(await clarify.evaluate(() => window.fake.calls.filter(([name]) => name === 'createThread').length), 1);
    await clarify.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea[role="combobox"]').value === '');
    await clarify.close();
  }

  // Touch screens (pointer: coarse): every button of the chat — header, thread list, composer (attach, mention, send,
  // scope chips, chips), run actions and cards — is at least 44 × 44 px.
  {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true, isMobile: true });
    const touch = await context.newPage();
    await touch.goto(origin);
    assert.equal(await touch.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'pointer: coarse is emulated');
    const root = touch.getByTestId('studio-chat'), box = root.getByTestId('studio-chat-composer');
    await root.waitFor();
    const assertTouchTargets = async stage => {
      const targets = root.locator('button:visible, .studio-chip-main:visible');
      const count = await targets.count();
      assert.ok(count > 0, `${stage}: buttons rendered`);
      const small = [];
      for (let index = 0; index < count; index++) {
        const target = targets.nth(index);
        const rect = await target.boundingBox();
        if (!rect) continue;
        const name = (await target.getAttribute('aria-label')) || (await target.textContent()).trim() || await target.evaluate(element => element.className);
        if (rect.width < 44 || rect.height < 44) small.push(`${name} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }
      assert.deepEqual(small, [], `${stage}: touch targets below 44 × 44 px`);
    };
    await touch.evaluate(() => window.launch({ id: crypto.randomUUID(), text: 'Touch request', mentions: [{ kind: 'scene', id: 'scene:s1', label: 'Scene 1' }], attachments: [new File(['x'], 'note.txt', { type: 'text/plain' })] }));
    await box.getByText('note.txt').waitFor();
    await box.getByRole('group', { name: 'Assistant task' }).getByRole('button', { name: 'Scene', exact: true }).click();
    for (const name of ['Attach files', 'Mention', 'Send message', 'Remove Scene']) assert.ok(await box.getByRole('button', { name, exact: true }).isVisible(), name);
    await assertTouchTargets('composer');
    await box.getByRole('combobox').click(); await touch.keyboard.press('Enter');
    const touchFeed = touch.getByTestId('studio-chat-feed');
    await touchFeed.locator('[data-run-status="running"]').waitFor();
    await assertTouchTargets('running');
    await touch.evaluate(image => {
      const { fake } = window;
      fake.emitCard({ type: 'diff', path: 'index.tpl', added: 1, removed: 1, before: '<h1>Old</h1>', after: '<h1>New</h1>' });
      fake.emitCard({ type: 'values', section: 'Hero', changes: [{ path: 'title', before: 'Old', after: 'New' }] });
      fake.emitCard({ type: 'image', name: 'hero.png', after: image, width: 8, height: 8 });
      fake.emitCard({ type: 'file', name: 'brief.txt', bytes: 2048 });
      fake.emitCard({ type: 'operation', label: 'Trim scene', target: { kind: 'scene', id: 'scene:s1', label: 'Scene 1' }, before: '0:05', after: '0:03' });
      fake.emitCard({ type: 'question', questionId: 'q0', text: 'Which voice?', options: ['Calm', 'Bright'] });
      fake.finish('ready');
    }, IMAGE);
    await touch.getByTestId('studio-chat-apply').waitFor();
    await assertTouchTargets('ready with cards');
    // A scope chip with a short label ("File") is still 44 px wide.
    await touch.goto(`${origin}/?scopes=project,file`);
    const fileChip = touch.getByTestId('studio-chat').getByRole('group', { name: 'Assistant task' }).getByRole('button', { name: 'File', exact: true });
    await fileChip.waitFor();
    const chipBox = await fileChip.boundingBox();
    assert.ok(chipBox.width >= 44 && chipBox.height >= 44, `short scope chip ${Math.round(chipBox.width)}×${Math.round(chipBox.height)} ≥ 44 px`);
    await assertTouchTargets('short scope chips');
    await context.close();
  }
  console.log('chat-browser: OK');
} finally { await browser.close(); server.close(); }
