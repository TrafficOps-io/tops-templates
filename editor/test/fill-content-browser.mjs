import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createStudioProject } from '../src/studio-library.js';
import { parseProject, getDefaults } from '@trafficops/template-runtime';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const files = { 'index.tpl': `@template "Article"
@type Review
  @param author String label="Author"
  @param text Text label="Review"
@endtype
@section content "Article"
  @param title String = "Original headline" label="Title" required
  @param article Wysiwyg = "<p>Original article</p>" label="Article"
  @param cover Image = "" label="Cover"
  @param portrait Image = "" label="Portrait"
  @param reviews Review[] min_items=0 max_items=7 label="Sample reviews"
@endsection
@layout
<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title></head><body><main><h1>{{title}}</h1><article>{{& article}}</article>
@if cover
<img src="{{cover}}" alt="Article illustration">
@endif
@if portrait
<img src="{{portrait}}" alt="Attached photo">
@endif
@each review in reviews
<blockquote><strong>{{review.author}}</strong><p>{{review.text}}</p></blockquote>
@endeach
</main></body></html>
@endlayout
` };
// A persisted library record starts at revision 1; revision 0 is an unsaved draft.
const fixture = { ...createStudioProject({ kind: 'landing', name: 'Article QA', files, settings: getDefaults(parseProject(files).definition) }), revision: 1 };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try { const path = new URL(request.url, 'http://localhost').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path)); if (!file.startsWith(root + '/')) throw Error('path'); response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ png }) => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const realFetch = window.fetch.bind(window);
    window.fillAi = { requests: [], writer: 0, reviews: 0, emptyWriter: true, holdReview: true, releaseReview: null };
    const response = (name, value) => {
      const payload = { id: name || 'content-response', model: 'test/model', choices: [{ index: 0, delta: name ? { role: 'assistant', tool_calls: [{ index: 0, id: `${name}-${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(value) } }] } : { content: 'Content completed.' }, finish_reason: name ? 'tool_calls' : 'stop' }] };
      return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    window.fetch = async (url, init) => {
      if (!String(url).includes('openrouter.ai/api/v1/')) return realFetch(url, init);
      const state = window.fillAi, body = JSON.parse(init.body); state.requests.push({ url: String(url), body });
      if (String(url).endsWith('/images')) return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] });
      const stage = body.tools?.length === 1 ? body.tools[0].function.name : null;
      if (stage === 'submit_plan') return response(stage, { summary: 'Write a 2600-character Polish article, add images and seven sample reviews.', tasks: ['Fill fields', 'Generate an illustration', 'Review and correct the article length'] });
      if (stage === 'submit_review') {
        const count = ++state.reviews;
        if (state.holdReview && count === 1) await new Promise((resolve, reject) => { state.releaseReview = resolve; init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
        return response(stage, { approved: count > 1, summary: count > 1 ? 'Polish article, all images and seven samples verified.' : 'The article is too short.', issues: count > 1 ? [] : ['Expand the article to 2600 characters.'] });
      }
      if (state.emptyWriter) { state.emptyWriter = false; return response(null); }
      const step = state.writer++;
      if (step === 0) return response('generate_image', { path: 'images/article.png', prompt: 'An editorial illustration for the article.', referenceIds: [] });
      if (step === 1) {
        const context = JSON.stringify(body.messages), path = context.match(/images\/reference-[A-Za-z0-9-]+\.png/)?.[0];
        return response('set_values', { values: { title: 'Polski artykuł', article: '<p>A short first draft.</p>', cover: 'images/article.png', portrait: path, reviews: Array.from({ length: 7 }, (_, index) => ({ author: `Przykład ${index + 1}`, text: 'Przykładowa opinia, nie jest prawdziwą rekomendacją.' })) } });
      }
      if (step === 3) return response('set_values', { values: { article: `<p>${'To jest przykładowy polski tekst artykułu. '.repeat(100).slice(0, 2600)}</p><figure><img src="images/article.png" alt="Ilustracja artykułu"></figure>` } });
      return response(null);
    };
  }, { png });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading', { name: 'Ideas become pages.', exact: true }).waitFor();
  await page.evaluate(async fixture => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('trafficops-studio-library', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const transaction = database.transaction(['projects', 'preferences'], 'readwrite'); transaction.objectStore('projects').put(fixture); transaction.objectStore('preferences').put(fixture.id, 'active-project'); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); database.close();
  }, fixture);
  await page.reload();
  await page.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  await page.getByRole('button', { name: 'AI connection settings', exact: true }).click();
  await page.locator('.ai-settings input[type=password]').fill('mock-key-no-paid-requests');
  await page.getByText('Text model', { exact: true }).locator('..').locator('input').fill('test/vision');
  await page.getByText('Image model', { exact: true }).locator('..').locator('input').fill('test/image');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Fill content', exact: true }).click();
  await page.locator('.ai-prompt textarea').fill('Write a Polish article, 2600 characters, seven explicitly fictional sample reviews. Generate an illustration and use the attached person photo.');
  await page.getByLabel('Reference images', { exact: true }).setInputFiles([{ name: 'site-reference.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }, { name: 'person.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await page.locator('.ai-attachment-list li').filter({ hasText: 'person.png' }).getByRole('checkbox').check();
  await page.getByRole('checkbox', { name: /Generate images requested/ }).check();
  const readRecord = () => page.evaluate(id => new Promise((resolve, reject) => { const request = indexedDB.open('trafficops-studio-library', 1); request.onsuccess = () => { const db = request.result, transaction = db.transaction('projects', 'readonly'), get = transaction.objectStore('projects').get(id); get.onsuccess = () => resolve(get.result); transaction.oncomplete = () => db.close(); }; request.onerror = () => reject(request.error); }), fixture.id);
  await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
  await page.waitForFunction(() => typeof window.fillAi.releaseReview === 'function').catch(async error => { console.log(await page.locator('.ai-panel').innerText()); console.log(JSON.stringify(await page.evaluate(() => window.fillAi.requests.map(request => ({ url: request.url, tools: request.body.tools?.map(tool => tool.function.name), messages: request.body.messages?.slice(-1).map(message => ({ role: message.role, content: String(message.content).slice(0, 300) })) }))))); await page.screenshot({ path: '/tmp/studio-fill-content-browser-failure.png' }); throw error; });
  assert.equal(await page.getByRole('button', { name: 'Apply changes', exact: true }).count(), 0, 'cannot apply before reviewer completes');
  assert.deepEqual((await readRecord()).files, fixture.files, 'generation does not autosave source or image assets');
  assert.equal((await readRecord()).settings.title, 'Original headline');
  await page.evaluate(() => window.fillAi.releaseReview());
  await page.getByText('Content ready', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fillAi.reviews), 2, 'review rejection runs a revision and second reviewer');
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Polski artykuł', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Original headline', exact: true }).waitFor();
  assert.equal(Object.keys((await readRecord()).files).length, 1, 'discard does not keep generated photos');
  await page.evaluate(() => Object.assign(window.fillAi, { writer: 0, reviews: 0, holdReview: false }));
  await page.getByRole('button', { name: 'Generate changes', exact: true }).click();
  await page.getByText('Content ready', { exact: true }).waitFor();
  await page.getByText('Review content changes', { exact: true }).click();
  const previewValues = JSON.parse(await page.locator('.ai-values-preview').innerText());
  assert.equal(previewValues.article.replace(/<[^>]+>/g, '').length, 2600);
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Polski artykuł', exact: true }).waitFor();
  await page.locator('.ai-review').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/studio-fill-content-review.png' });
  const requests = await page.evaluate(() => window.fillAi.requests);
  for (const { body } of requests.filter(request => request.url.endsWith('/chat/completions'))) {
    assert.equal(body.tool_choice, 'auto', 'tool-capable providers may not support a named choice');
    assert.equal(Object.hasOwn(body, 'temperature'), false, 'reasoning endpoints may not support sampling parameters');
    assert.deepEqual(body.provider, { require_parameters: true, data_collection: 'deny' });
  }
  assert.ok(requests.some(({ body }) => body.messages?.some(message => typeof message.content === 'string' && message.content.includes('only recovery attempt for a response with no changes'))), 'a prose-only writer response receives a bounded request for actual field updates');
  const vision = requests.find(request => request.body.tools?.[0].function.name === 'submit_plan');
  assert.equal(vision.body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length, 2, 'attachments reach the real OpenRouter adapter as vision inputs');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const deadline = Date.now() + 20000;
  while ((await readRecord()).settings.title !== 'Polski artykuł' && Date.now() < deadline) await page.waitForTimeout(100);
  const saved = await readRecord();
  if (saved.settings.title !== 'Polski artykuł') console.log((await page.locator('body').innerText()).slice(-12000));
  assert.equal(saved.settings.title, 'Polski artykuł', 'wait for the durable autosave transaction');
  assert.equal(saved.files['index.tpl'], fixture.files['index.tpl']); assert.equal(saved.settings.article.replace(/<[^>]+>/g, '').length, 2600); assert.equal(saved.settings.reviews.length, 7);
  assert.ok(saved.files['images/article.png'] instanceof Uint8Array); assert.ok(saved.files[saved.settings.portrait] instanceof Uint8Array);
  assert.equal(Object.keys(saved.files).length, 3, 'reference-only screenshot is not exported as a page image');
  await page.getByRole('button', { name: 'Export project', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
  const archive = unzipSync(new Uint8Array(await readFile(await (await download).path())));
  assert.ok(archive['images/article.png']); assert.equal(JSON.parse(strFromU8(archive['.trafficops/values.json'])).reviews.length, 7);
  await page.reload();
  await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading', { name: 'Polski artykuł', exact: true }).waitFor();
  const frame = page.locator('.browser-frame iframe.is-visible').contentFrame();
  assert.equal((await frame.locator('article > p').textContent()).length, 2600);
  assert.equal(await frame.getByRole('img', { name: 'Ilustracja artykułu', exact: true }).evaluate(image => image.complete && image.naturalWidth > 0), true, 'inline article image survives Apply, autosave and reload');
  assert.deepEqual(errors, []);
  console.log('PASS: Fill Content, streamed tool writes, independent reviewer/revision, 2600-character Polish article, seven sample reviews, vision references, generated images, Apply/Discard, atomic autosave, ZIP assets and reload.');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
