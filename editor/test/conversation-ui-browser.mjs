import { workspaceUrl, reloadProject } from './support/workspace-url.js';
import { revealConversationTab } from './support/studio-chat.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openThread, studioChat } from './support/studio-chat.js';
import { installFolderPicker, listOpfs, openProject, readOpfs, seedProjectFolder } from './support/studio-folders.js';

// Production UI over a seeded project folder (real OPFS through the test picker). No provider requests.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = createRequire(import.meta.url)('@axe-core/playwright').default;
const root = resolve(process.argv[2] || 'editor/dist'), out = process.env.STUDIO_CONVERSATION_SCREENSHOTS || '/tmp/studio-conversation-ui-browser';
await mkdir(out, { recursive: true });
const source = '@template "Conversation UI"\n@section page "Page"\n@param title String = "Collection" label="Title"\n@endsection\n@layout\n<html><head><link rel="stylesheet" href="styles.css"></head><body><section data-block="Main hero"><h1>{{title}}</h1><p>Neutral collection demo.</p></section><article data-block="Comment">First comment</article><article data-block="Comment">Second comment</article></body></html>\n@endlayout\n';
const imageBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=', 'base64'));
const fixture = { id: randomUUID(), name: 'Conversation UI QA', files: { 'images/hero.png': imageBytes, 'index.tpl': source, 'styles.css': 'body{font:16px system-ui;padding:24px}', 'removed.txt': Array.from({ length: 100 }, (_, index) => `Neutral collection note ${index + 1}`).join('\n') }, settings: { title: 'Collection' } };
const base = { name: fixture.name, revision: 1, files: fixture.files, folders: [], entrypoint: 'index.html', locale: 'en', translations: { en: fixture.settings } };
const now = Date.now();
const document = { schema: 1, projectId: fixture.id, revision: 0, threads: [
  { id: 'thread-style', title: 'Refine collection spacing', archived: false, createdAt: now, updatedAt: now, messages: [{ id: 'message-style', role: 'user', prompt: 'Update the collection spacing.\n\nGive the headline and supporting copy more room, while keeping the page easy to read on phones. Preserve the existing content and make the spacing consistent throughout the layout.', createdAt: now, runId: 'run-style' }, { id: 'answer-style', role: 'assistant', text: 'Updated spacing and removed an obsolete note.', createdAt: now + 1, runId: 'run-style' }] },
  { id: 'thread-plan', title: 'Plan the landing', archived: false, createdAt: now + 1, updatedAt: now + 1, messages: [{ id: 'message-plan', role: 'user', prompt: 'Explain the next steps.', createdAt: now + 1 }, { id: 'answer-plan', role: 'assistant', text: 'Choose content and photos for the collection.', createdAt: now + 2 }] },
], runs: [{ id: 'run-style', threadId: 'thread-style', messageId: 'message-style', state: 'ready', phase: 'review', scope: { kind: 'project' }, locale: 'en', base, result: { files: { 'index.tpl': source, 'styles.css': 'body{font:16px system-ui;padding:32px}' }, values: fixture.settings, valid: true, summary: 'Updated spacing and removed an obsolete note.' }, createdAt: now, updatedAt: now + 1 }] };
const heroStart = source.indexOf('<section data-block="Main hero">'), heroEnd = source.indexOf('</section>', heroStart) + '</section>'.length;
document.threads[1].messages[0].mentions = [{ kind: 'section', id: 'main-hero', label: 'Main hero', path: 'index.tpl', page: 'index.html', locale: 'en', start: heroStart, end: heroEnd, content: source.slice(heroStart, heroEnd), values: { '/title': 'Collection' } }];
document.threads.push({ id: 'thread-file', title: 'Adjust selected stylesheet', archived: false, createdAt: now + 3, updatedAt: now + 3, messages: [{ id: 'message-file', role: 'user', prompt: 'Adjust only the selected stylesheet.', createdAt: now + 3, runId: 'run-file' }] });
document.runs.push({ id: 'run-file', threadId: 'thread-file', messageId: 'message-file', state: 'ready', phase: 'review', scope: { kind: 'file', path: 'styles.css' }, locale: 'en', base, result: { files: { ...fixture.files, 'styles.css': 'body{font:16px system-ui;padding:48px}' }, values: fixture.settings, valid: true, summary: 'Adjusted only the selected stylesheet.' }, createdAt: now + 3, updatedAt: now + 4 });
// A failed run that left a draft: Discard must keep that draft out of the next send (the runtime would otherwise retain it).
document.threads.unshift({ id: 'thread-broken', title: 'Recover a broken draft', archived: false, createdAt: now - 2, updatedAt: now - 2, messages: [{ id: 'message-broken', role: 'user', prompt: 'Tighten the stylesheet.', createdAt: now - 2, runId: 'run-broken' }] });
document.runs.unshift({ id: 'run-broken', threadId: 'thread-broken', messageId: 'message-broken', state: 'failed', phase: 'review', scope: { kind: 'project' }, locale: 'en', base, result: { files: { ...fixture.files, 'styles.css': 'body{font:16px system-ui;padding:4px' }, values: fixture.settings, valid: false, summary: 'The stylesheet draft is broken.' }, error: 'The model stopped mid-file.', createdAt: now - 2, updatedAt: now - 1 });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try { const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path)); if (!file.startsWith(root + '/')) throw new Error('Path'); response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const report = { paidRequests: 0, errors: [], widths: [], checks: [], axe: [] };
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => { const url = route.request().url(); return url.startsWith(origin + '/') || url.startsWith(`blob:${origin}/`) || url.startsWith('data:') ? route.continue() : route.abort(); });
  await installFolderPicker(context);
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await page.goto(workspaceUrl(origin)); await page.locator('.library').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((done, reject) => { const request = indexedDB.open('trafficops-template-studio-ai', 1); request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'id' }); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    await new Promise((done, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ id: 'openrouter', apiKey: 'mock-no-provider-ui-test', model: 'test/text-model', imageModel: '' }); tx.oncomplete = done; tx.onerror = () => reject(tx.error); }); db.close();
  });
  const seeded = await seedProjectFolder(page, { name: fixture.name, projectId: fixture.id, files: fixture.files, values: fixture.settings, conversations: document });
  await openProject(page, fixture.name);
  const chat = studioChat(page), panel = chat.root; await revealConversationTab(chat.root); await chat.root.waitFor();
  const prompt = chat.prompt;
  // Next to the preview the chat is narrower than 560 px: the conversation list is offered by the header menu "Conversations".
  assert.equal(await chat.threads.isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Collapse editor', exact: true }).count(), 0);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.editor-shell.is-app').count(), 1); report.checks.push('permanent PWA and Escape');
  await openThread(chat, 'Refine collection spacing');
  await chat.run('run-style').waitFor();
  assert.equal(await chat.feed.getByText('Updated spacing and removed an obsolete note.', { exact: true }).count(), 1);
  assert.deepEqual(await chat.feed.locator('[data-role]').evaluateAll(elements => elements.map(element => element.dataset.role)), ['user', 'assistant']);
  assert.equal(await chat.run('run-style').getAttribute('data-run-status'), 'ready');
  await page.screenshot({ path: `${out}/thread-desktop.png`, fullPage: true }); report.checks.push('run actions follow their message without repeating the assistant summary');
  // axe (WCAG 2 A/AA) on the open chat with cards and run actions, in the light and the dark theme: critical/serious fail.
  const blocking = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(name => document.documentElement.setAttribute('data-theme', `studio-${name}`), theme); await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/chat-${theme}.png` });
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="studio-chat"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const violation of violations) {
      const line = `[${theme}] ${violation.id} (${violation.impact}) ${violation.help} — ${violation.nodes.map(node => node.target.join(' ')).slice(0, 6).join(' | ')}`;
      report.axe.push(line); if (['critical', 'serious'].includes(violation.impact)) blocking.push(line);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  assert.deepEqual(blocking, [], 'axe: no critical/serious violations in the open chat'); report.checks.push('axe on the open chat in both themes');
  const removed = chat.cards('diff').filter({ hasText: 'removed.txt' }); assert.equal(await removed.count(), 1);
  await removed.getByRole('button', { name: 'Show full changes', exact: true }).click(); assert.ok((await removed.locator('.studio-card-diff').innerText()).includes('Neutral collection note 100'));
  const layout = await panel.evaluate(element => { const stream = element.querySelector('[data-testid="studio-chat-feed"]'), composer = element.querySelector('[data-testid="studio-chat-composer"]'), before = composer.getBoundingClientRect().top; stream.scrollTop = 0; const after = composer.getBoundingClientRect().top; return { scrolls: stream.scrollHeight > stream.clientHeight, stays: Math.abs(after - before) < 1, contained: composer.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1 }; }); assert.deepEqual(layout, { scrolls: true, stays: true, contained: true }); report.checks.push('long conversation scrolls independently from composer');
  await chat.run('run-style').getByRole('button', { name: 'Preview draft', exact: true }).click();
  await page.getByText('Conversation draft · Project files unchanged', { exact: true }).waitFor();
  assert.equal(await chat.run('run-style').locator('[data-testid="studio-chat-apply"]').isEnabled(), true); report.checks.push('review includes deletion; explicit separate preview');
  await panel.getByRole('button', { name: 'Show current project', exact: true }).click();
  await page.getByText('Conversation draft · Project files unchanged', { exact: true }).waitFor({ state: 'detached' });
  await panel.locator('.studio-chat-header').getByRole('button', { name: 'Rename conversation', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Conversation title', exact: true }).fill('Collection spacing review'); await panel.getByRole('textbox', { name: 'Conversation title', exact: true }).press('Enter');
  await panel.getByRole('heading', { name: 'Collection spacing review', exact: true }).waitFor();
  // Without the preview the chat is wide enough for the conversation list column (search, archive, delete).
  const wideChat = async () => { await revealConversationTab(page.locator('[data-testid=\"studio-chat\"]')); await revealConversationTab(chat.root); await chat.root.waitFor(); if (!await chat.threads.isVisible()) { await page.getByRole('button', { name: 'Hide preview', exact: true }).click(); await chat.threads.waitFor(); } };
  await wideChat();
  const threadMenu = async (title, item) => { await chat.threadActions(title).click(); await panel.getByRole('menuitem', { name: item, exact: true }).click(); };
  const archived = panel.getByRole('button', { name: 'Archived', exact: true });
  await threadMenu('Collection spacing review', 'Archive'); await chat.thread('Collection spacing review').waitFor({ state: 'detached' });
  await archived.click(); assert.equal(await archived.getAttribute('aria-pressed'), 'true');
  await chat.thread('Collection spacing review').waitFor();
  await threadMenu('Collection spacing review', 'Restore'); await panel.getByText('No archived conversations.', { exact: true }).waitFor(); await archived.click();
  await panel.getByRole('searchbox', { name: 'Search conversations' }).fill('Collection spacing review'); assert.equal(await chat.threads.locator('.studio-chat-threads-item').count(), 1); await panel.getByRole('searchbox', { name: 'Search conversations' }).fill('');
  await reloadProject(page); await wideChat(); await chat.thread('Collection spacing review').waitFor(); report.checks.push('rename/archive/restore/search persist after reload');
  await chat.thread('Plan the landing').click(); await chat.user.locator('.studio-chip-mention').filter({ hasText: '@Main hero' }).getByRole('button').click();
  // A saved section reference opens its source file at the section (as the former conversation panel did).
  await page.getByRole('tab', { name: 'Code', selected: true, exact: true }).waitFor({ timeout: 5000 }); await page.locator('.source-heading').getByText('index.tpl', { exact: true }).waitFor();
  await revealConversationTab(page.locator('[data-testid=\"studio-chat\"]'));
  await threadMenu('Plan the landing', 'Archive'); await archived.click(); await threadMenu('Plan the landing', 'Delete conversation');
  const confirmation = page.getByRole('dialog', { name: 'Delete conversation?', exact: true }); await confirmation.getByText('Messages of this conversation will be deleted. Changes already applied stay in the project.', { exact: true }).waitFor(); await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click(); await confirmation.waitFor({ state: 'detached' });
  await panel.getByText('No archived conversations.', { exact: true }).waitFor(); await archived.click();
  await reloadProject(page); await wideChat(); await chat.thread('Collection spacing review').waitFor(); assert.equal(await chat.thread('Plan the landing').count(), 0); assert.equal(await page.locator('.file-sidebar').getByTitle('removed.txt', { exact: true }).count(), 1); report.checks.push('archived conversation deletion requires confirmation and preserves project files');
  await chat.threads.getByRole('button', { name: 'New conversation', exact: true }).click();
  await panel.getByRole('heading', { name: 'New conversation', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show preview', exact: true }).click(); await chat.threads.waitFor({ state: 'hidden' });
  const composerMentions = chat.composer.locator('.studio-chat-composer-highlights mark'), listbox = chat.composer.getByRole('listbox', { name: 'Mention targets' });
  const mentionButton = chat.composer.getByRole('button', { name: 'Mention', exact: true });
  // The @ button inserts '@' and moves the caret on the next frame; type only after that frame.
  const openMentions = async () => { await mentionButton.click(); await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); };
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Collection', exact: true }).waitFor();
  await openMentions(); await prompt.pressSequentially('Main hero');
  await listbox.getByRole('option', { name: 'Main hero index.html', exact: true }).click();
  assert.equal(await prompt.inputValue(), '@Main hero ');
  assert.equal(await composerMentions.innerText(), '@Main hero');
  await openMentions(); await prompt.pressSequentially('Main hero');
  assert.equal(await listbox.getByRole('option', { name: 'Main hero index.html', exact: true }).count(), 1, 'the same reference can occur twice in the text');
  await prompt.fill('');
  assert.equal(await composerMentions.count(), 0);
  await prompt.fill('Compare '); await prompt.pressSequentially('@Comment');
  assert.equal(await listbox.getByRole('option', { name: /^Comment/ }).count(), 2);
  await prompt.press('ArrowDown'); await prompt.press('Enter');
  await composerMentions.filter({ hasText: '@Comment (2/2)' }).waitFor();
  assert.equal(await prompt.inputValue(), 'Compare @Comment (2/2) ');
  await prompt.fill('Use '); await prompt.pressSequentially('@hero');
  assert.equal(await listbox.getByRole('option', { name: 'images/hero.png', exact: true }).count(), 1);
  await prompt.press('Escape'); assert.equal(await listbox.count(), 0);
  await page.screenshot({ path: `${out}/section-mentions.png`, fullPage: true });
  await prompt.fill('');
  await prompt.fill('Use '); await prompt.pressSequentially('@sty'); await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true }); assert.equal(await composerMentions.count(), 0); assert.equal(await prompt.inputValue(), 'Use @sty'); await prompt.press('Enter'); assert.equal(await composerMentions.innerText(), '@styles.css');
  await openMentions(); await prompt.press('ArrowDown'); await prompt.press('Enter'); assert.equal(await composerMentions.count(), 2);
  await openMentions(); await prompt.pressSequentially('removed'); await listbox.getByRole('option', { name: 'removed.txt', exact: true }).click(); assert.equal(await composerMentions.count(), 3);
  await openMentions(); await prompt.pressSequentially('styles'); assert.equal(await listbox.getByRole('option', { name: 'styles.css', exact: true }).count(), 1); await prompt.press('Escape'); assert.equal(await chat.composer.getByRole('listbox').count(), 0);
  await prompt.fill('Use '); await prompt.pressSequentially('@hero'); await listbox.getByRole('option', { name: 'images/hero.png', exact: true }).click(); await prompt.fill('Use '); assert.equal(await composerMentions.count(), 0);
  report.checks.push('mentions mouse/keyboard/dedup; composition Enter preserves prompt');
  await chat.attachmentInput.setInputFiles(['notes.txt', 'copy.txt', 'spacing.txt', 'references.txt'].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('Use neutral collection copy.') }))); await chat.composer.locator('.studio-chip-attachment').filter({ hasText: 'notes.txt' }).waitFor(); assert.equal(await chat.composer.locator('.studio-chip-attachment').count(), 4); report.checks.push('UTF-8 attachments');
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForFunction(() => document.querySelector('.author-panel').getBoundingClientRect().bottom <= innerHeight + 1); // the workspace settles a frame after the resize
  const shortLayout = await panel.evaluate(element => { const composer = element.querySelector('[data-testid="studio-chat-composer"]').getBoundingClientRect(), stream = element.querySelector('[data-testid="studio-chat-feed"]').getBoundingClientRect(); return { composerVisible: composer.bottom <= Math.min(innerHeight, element.getBoundingClientRect().bottom) + 1 && element.querySelector('[data-testid="studio-chat-composer"] button[type="submit"]').getBoundingClientRect().bottom <= composer.bottom, streamVisible: stream.height >= 80, historyVisible: element.querySelector('.studio-chat-header-threads button').getBoundingClientRect().bottom < innerHeight }; }); assert.deepEqual(shortLayout, { composerVisible: true, streamVisible: true, historyVisible: true });
  // A long prompt grows the autosized input up to its row limit without pushing the controls away.
  await prompt.fill(Array.from({ length: 14 }, (_, index) => `Spacing note ${index + 1}`).join('\n')); await page.waitForFunction(() => document.querySelector('[data-testid="studio-chat-composer"] textarea').getBoundingClientRect().height >= 120);
  const resizedLayout = await panel.evaluate(element => { const composer = element.querySelector('[data-testid="studio-chat-composer"]'), send = composer.querySelector('button[type="submit"]').getBoundingClientRect(), attachmentList = composer.querySelector('.studio-chat-composer-attachments'), prompt = composer.querySelector('textarea').getBoundingClientRect(); return { sendVisible: send.bottom <= Math.min(innerHeight, element.getBoundingClientRect().bottom), promptVisible: prompt.height >= 48, referencesVisible: attachmentList.clientHeight > 0, controlsClear: attachmentList.getBoundingClientRect().bottom <= send.top }; }); assert.deepEqual(resizedLayout, { sendVisible: true, promptVisible: true, referencesVisible: true, controlsClear: true }); await prompt.fill('');
  await openMentions(); await page.waitForFunction(() => { const picker = document.querySelector('.studio-mention-menu'), panel = picker?.closest('.studio-chat'); return picker && panel && picker.getBoundingClientRect().top >= panel.getBoundingClientRect().top; }); const pickerGeometry = await listbox.evaluate(element => ({ top: element.getBoundingClientRect().top, panelTop: element.closest('.studio-chat').getBoundingClientRect().top })); assert.ok(pickerGeometry.top >= pickerGeometry.panelTop, JSON.stringify(pickerGeometry)); const ancestorScroll = await page.evaluate(() => ({ page: scrollY, thread: document.querySelector('[data-testid="studio-chat-feed"]').scrollTop })); await prompt.press('ArrowUp'); const selectedGeometry = await listbox.getByRole('option', { selected: true }).evaluate(element => { const option = element.getBoundingClientRect(), picker = element.closest('[role="listbox"]').getBoundingClientRect(); return { visible: option.top >= picker.top && option.bottom <= picker.bottom + 1 }; }); assert.equal(selectedGeometry.visible, true); assert.deepEqual(await page.evaluate(() => ({ page: scrollY, thread: document.querySelector('[data-testid="studio-chat-feed"]').scrollTop })), ancestorScroll); await listbox.getByRole('option', { selected: true }).click(); await openMentions(); await listbox.getByRole('option').first().click();
  await page.screenshot({ path: `${out}/short-viewport.png`, fullPage: true }); report.checks.push('720px viewport keeps composer visible with references and the conversation list');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('tab', { name: 'Code', exact: true }).click(); await page.locator('.file-sidebar').getByTitle('styles.css', { exact: true }).click(); await page.getByRole('button', { name: 'Edit file with AI', exact: true }).click(); await chat.activeScope('File').waitFor(); await composerMentions.filter({ hasText: '@styles.css' }).waitFor(); assert.equal(await page.locator('.file-ai-modal').count(), 0); report.checks.push('file action routes to scoped conversation');
  await openThread(chat, 'Adjust selected stylesheet'); await panel.getByRole('heading', { name: 'Adjust selected stylesheet', exact: true }).waitFor(); await chat.run('run-file').waitFor(); assert.equal(await chat.run('run-file').getAttribute('data-run-status'), 'ready');
  await prompt.fill('Expand the layout beyond @styles.css.'); await chat.scope.getByRole('button', { name: 'Remove File', exact: true }).click(); await chat.activeScope('Project').waitFor(); assert.equal(await prompt.inputValue(), 'Expand the layout beyond @styles.css.'); assert.equal(await composerMentions.innerText(), '@styles.css'); report.checks.push('removing a file scope returns to the project scope and retains the prompt and its reference');
  await openMentions(); await prompt.pressSequentially('index'); await listbox.getByRole('option', { name: 'index.tpl', exact: true }).click(); assert.equal(await prompt.inputValue(), 'Expand the layout beyond @styles.css. @index.tpl '); assert.equal(await composerMentions.count(), 2); report.checks.push('mention picker after a completed sentence preserves the prompt');
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.getByRole('menuitem', { name: /Editable project/ }).click(); const dialog = page.getByRole('dialog', { name: 'Export', exact: true }); await dialog.waitFor(); assert.equal(await dialog.getByRole('combobox', { name: 'Export destination' }).count(), 0); assert.equal(await dialog.getByRole('heading', { name: 'Editable project', exact: true }).count(), 1); assert.equal(await dialog.getByRole('checkbox', { name: 'Include conversation history' }).isChecked(), true); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); report.checks.push('one export menu; history default');
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Collection', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select elements', exact: true }).click();
  await page.getByRole('button', { name: 'Choose sections', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search sections', exact: true }).fill('comment');
  await page.getByRole('option', { name: 'Comment (2/2)', exact: true }).click();
  await page.locator('.preview-selection-chip').getByText('Comment (2/2)', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Search sections', exact: true }).fill('hero');
  await page.getByRole('option', { name: 'Main hero', exact: true }).click();
  await page.locator('.preview-selection-chip').getByText('Main hero', { exact: true }).waitFor();
  assert.equal(await page.locator('.preview-selection-chip').count(), 2);
  await page.screenshot({ path: `${out}/section-picker.png`, fullPage: true });
  await page.getByRole('combobox', { name: 'Search sections', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('button', { name: 'Select elements', exact: true }).click();
  report.checks.push('section picker supports search and multiple instances; file and section mentions coexist, deduplicate, preserve prompt and render saved history');

  await openThread(chat, 'Recover a broken draft'); await chat.run('run-broken').waitFor();
  assert.equal(await chat.run('run-broken').getAttribute('data-run-status'), 'failed');
  assert.equal(await chat.run('run-broken').locator('[data-testid="studio-chat-apply"]').count(), 0, 'a failed run is never applicable');
  await chat.run('run-broken').locator('[data-testid="studio-chat-discard"]').click();
  await chat.run('run-broken').and(page.locator('[data-run-status="discarded"]')).waitFor();
  await prompt.fill('');
  await prompt.fill('Tighten the stylesheet again from the current project.'); await chat.send.click();
  // Persistence is the folder's dialogue file (.trafficops/conversations/<thread>.json, runs included).
  const readConversation = async () => {
    const runs = [];
    for (const name of (await listOpfs(page, `${seeded.folder}/.trafficops/conversations`)) || []) if (name.endsWith('.json')) runs.push(...(JSON.parse(await readOpfs(page, `${seeded.folder}/.trafficops/conversations/${name}`) || '{}').runs || []));
    return { runs };
  };
  let brokenRuns = [];
  for (const deadline = Date.now() + 10000; Date.now() < deadline; await page.waitForTimeout(100)) { brokenRuns = (await readConversation()).runs.filter(run => run.threadId === 'thread-broken'); if (brokenRuns.length === 2) break; }
  assert.equal(brokenRuns.length, 2, 'the follow-up creates a run');
  assert.equal(brokenRuns[0].state, 'discarded'); assert.equal(brokenRuns[0].result, undefined);
  assert.equal(brokenRuns[1].starting, undefined, 'the discarded draft is not the starting point of the next run'); assert.equal(brokenRuns[1].attempt, 0);
  report.checks.push('Discard of a failed run keeps its draft out of the next send');

  for (const width of [1024, 320]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `${out}/${width}.png`, fullPage: true }); const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('[data-testid="studio-chat"]').getBoundingClientRect().width, overflow: [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, class: element.className?.baseVal || element.className, right: element.getBoundingClientRect().right })).filter(item => item.right > innerWidth + 1).slice(0, 15) })); assert.ok(geometry.document <= width + 1, `No clipping at ${width}: ${JSON.stringify(geometry)}`); report.widths.push(geometry); }
  await page.setViewportSize({ width: 390, height: 844 });
  const retainedPrompt = await prompt.inputValue();
  await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'Conversations', exact: true }).click();
  await chat.root.getByRole('menuitem', { name: 'Manage conversations', exact: true }).click();
  const management = chat.root.getByTestId('studio-chat-management'); await management.waitFor();
  const managementBlocking = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(name => document.documentElement.setAttribute('data-theme', `studio-${name}`), theme);
    await page.screenshot({ path: `${out}/management-${theme}-390.png` });
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="studio-chat-management"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const violation of violations) { const line = `[management/${theme}] ${violation.id} (${violation.impact}) ${violation.help}`; report.axe.push(line); if (['critical', 'serious'].includes(violation.impact)) managementBlocking.push(line); }
  }
  assert.deepEqual(managementBlocking, [], 'axe: no critical/serious violations in active narrow management');
  await management.getByRole('button', { name: 'Close', exact: true }).click(); await management.waitFor({ state: 'hidden' });
  assert.equal(await prompt.inputValue(), retainedPrompt, 'narrow management preserves the current composer');
  report.checks.push('active PWA conversation management at 390px, retained composer, axe in both themes');
  assert.deepEqual(report.errors, []); await context.close();
} finally { await browser?.close(); server.close(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
