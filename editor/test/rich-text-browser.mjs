import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createStudioProject } from '../src/studio-library.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const article = '<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p><figure><img src="img/article.svg" alt="Article"><figcaption>Photo caption.</figcaption></figure><p>Last paragraph.</p>';
const files = {
  'index.tpl': `@template "Rich text QA"
@param article_body Wysiwyg = ${JSON.stringify(article)} label="Article body"
@param markdown_body Markdown = "First markdown paragraph.\\n\\nSecond **markdown** paragraph." label="Markdown body"
@layout
<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Rich text QA</h1><div id="article" class="md rich-text">{{& article_body }}</div><div id="markdown" class="md rich-text">{{& markdown_body }}</div></body></html>
@endlayout`,
  'styles.css': 'body{font:16px/1.55 "Times New Roman",serif}.md p{margin:0 0 12px}.md p+p{margin-top:12px}.md figure{margin:16px 0}.md figure img{display:block;width:100%;max-width:100%;height:auto}.md figcaption{font:12px Arial,sans-serif}',
  'img/article.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="green"/></svg>',
};
// An existing Values override wins over a subsequently edited @param default.
const fixture = { ...createStudioProject({ kind: 'landing', name: 'Rich text QA', files, settings: { article_body: 'Saved plain article.\n\nNo paragraph tags.', markdown_body: 'Saved markdown paragraph.\n\nAnother saved paragraph.' } }), revision: 1 };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw Error('path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page; const errors = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await page.evaluate(async fixture => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('trafficops-studio-library', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction(['projects', 'preferences'], 'readwrite'); tx.objectStore('projects').put(fixture); tx.objectStore('preferences').put(fixture.id, 'active-project'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  }, fixture);
  await page.reload();
  const frame = () => page.frameLocator('iframe.is-visible');
  await frame().getByRole('heading', { name: 'Rich text QA' }).waitFor();
  assert.equal(await frame().locator('#article').innerText(), 'Saved plain article. No paragraph tags.');
  assert.equal(await frame().locator('#article p').count(), 0);
  assert.equal(await frame().locator('#markdown p').count(), 2);
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  const articleEditor = page.locator('#setting-article_body');
  const articleField = page.locator('.field').filter({ has: articleEditor });
  const markdownEditor = page.locator('#setting-markdown_body');
  const markdownField = page.locator('.field').filter({ has: markdownEditor });
  await articleEditor.waitFor();
  await frame().locator('#article p').first().waitFor();
  assert.equal(await frame().locator('#article p').count(), 2, 'legacy blank lines become paragraphs on opening Content');
  await articleField.getByRole('button', { name: 'Use template default', exact: true }).click();
  await articleEditor.locator('figcaption').first().waitFor();
  assert.equal(await articleEditor.locator('figcaption').innerText(), 'Photo caption.');
  await articleEditor.locator('img').evaluate(img => img.decode());
  await frame().locator('#article figcaption').waitFor();
  assert.equal(await frame().locator('#article p').count(), 3);
  assert.equal(await frame().locator('#article figcaption').innerText(), 'Photo caption.');
  await frame().locator('#article img').evaluate(img => img.decode());
  assert.equal(await frame().locator('#article p').first().evaluate(p => getComputedStyle(p).marginBottom), '12px');
  async function selectText(locator) {
    await locator.evaluate(node => { node.closest('[contenteditable]').focus(); const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.waitForTimeout(60);
  }
  await articleEditor.evaluate(node => { window.initialEditor = node.editor; });
  await selectText(articleEditor.locator('p').first());
  await page.keyboard.insertText('Edited first paragraph.');
  await frame().getByText('Edited first paragraph.', { exact: true }).waitFor();
  await selectText(articleEditor.locator('p').first());
  await articleField.getByRole('button', { name: 'Bold', exact: true }).click();
  await frame().locator('#article p').first().locator('strong').waitFor();
  assert.equal(await frame().locator('#article p').first().locator('strong').innerText(), 'Edited first paragraph.');
  await page.waitForTimeout(900);
  assert.equal(await articleEditor.evaluate(node => node.editor === window.initialEditor), true, 'autosave preserves the editor instance and undo history');
  await articleField.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await articleEditor.locator('p').first().locator('strong').count(), 0);
  await articleField.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await articleEditor.locator('p').first().locator('strong').innerText(), 'Edited first paragraph.');
  await selectText(articleEditor.locator('p').first());
  await articleField.getByRole('button', { name: 'Insert link', exact: true }).click();
  const linkForm = articleField.getByRole('form', { name: 'Insert link', exact: true });
  await linkForm.getByLabel('Link URL', { exact: true }).fill('https://example.com/article');
  await linkForm.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(await articleEditor.locator('a').getAttribute('href'), 'https://example.com/article');
  await articleEditor.locator('p').last().click();
  await page.keyboard.press('End');
  await articleField.getByRole('button', { name: 'Insert image', exact: true }).click();
  const imageForm = articleField.getByRole('form', { name: 'Insert image', exact: true });
  await imageForm.getByLabel('Image source', { exact: true }).fill('img/article.svg');
  await imageForm.getByLabel('Alternative text', { exact: true }).fill('Inserted image');
  await imageForm.getByLabel('Image caption', { exact: true }).fill('Inserted caption.');
  await imageForm.getByRole('button', { name: 'Apply', exact: true }).click();
  await frame().getByText('Inserted caption.', { exact: true }).waitFor();
  assert.equal(await articleEditor.locator('figure').count(), 2);
  assert.equal(await articleEditor.locator('figcaption').first().innerText(), 'Photo caption.', 'editing preserves existing figure caption');
  await markdownField.getByRole('button', { name: 'Markdown source', exact: true }).click();
  const markdownSource = markdownField.getByRole('textbox', { name: 'Markdown source', exact: true });
  assert.equal(await markdownSource.inputValue(), fixture.settings.markdown_body, 'opening visual Markdown never rewrites saved source');
  await markdownSource.fill('Updated first paragraph.\n\nUpdated **second** paragraph.\n\n![Article](img/article.svg)');
  await markdownField.getByRole('region', { name: 'Markdown preview' }).locator('img').evaluate(img => img.decode());
  await frame().locator('#markdown strong').waitFor();
  assert.equal(await frame().locator('#markdown p').count(), 3);
  assert.equal(await frame().locator('#markdown strong').innerText(), 'second');
  await frame().locator('#markdown img').evaluate(img => img.decode());
  await markdownField.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await selectText(markdownEditor.locator('p').first());
  await markdownField.getByRole('button', { name: 'Bold', exact: true }).click();
  await markdownField.getByRole('button', { name: 'Markdown source', exact: true }).click();
  const savedMarkdown = await markdownSource.inputValue();
  assert.match(savedMarkdown, /\*\*Updated first paragraph\.\*\*/);
  assert.match(savedMarkdown, /!\[Article\]\(img\/article\.svg\)/);
  assert.doesNotMatch(savedMarkdown, /<p>|blob:/);
  await markdownField.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await articleEditor.locator('figcaption').first().waitFor();
  assert.equal(await articleEditor.locator('figure').count(), 2);
  assert.equal(await articleEditor.locator('p').first().locator('strong').innerText(), 'Edited first paragraph.');
  await frame().getByText('Inserted caption.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/studio-rich-text-preview.png', fullPage: true });
  console.log('PASS: visual Wysiwyg and Markdown editors, legacy paragraph recovery, formatting toolbar, undo/redo, links, project images/captions, source preview, safe source serialization, reload persistence and live preview.');
} catch (error) {
  await page?.screenshot({ path: '/tmp/studio-rich-text-failure.png', fullPage: true }).catch(() => {});
  console.error({ errors }); throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
