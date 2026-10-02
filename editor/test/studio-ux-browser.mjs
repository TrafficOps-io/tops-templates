// Task-level regressions for the Projects/Templates redesign. No provider calls.
// Run from repo root after build; PLAYWRIGHT_MODULE may point to a bundled runtime.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = process.env.STUDIO_UX_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true, ...(process.platform === 'darwin' ? { executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
const errors = [], providerCalls = [];
try {
  for (const installed of [false, true]) for (const width of [1440, 390]) {
    console.log(`Checking ${installed ? 'installed' : 'browser'} ${width}px`);
    const context = await browser.newContext({ viewport:{width, height:844}, hasTouch:width === 390 });
    await context.addInitScript(() => { window.showDirectoryPicker = undefined; });
    if (installed) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value:true, configurable:true }));
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
      if (url.includes('openrouter.ai/api/')) providerCalls.push(url);
      return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    const library = page.locator('.library');
    const projects = library.getByRole('tab', {name:'Projects', exact:true});
    await projects.waitFor(); assert.equal(await projects.getAttribute('aria-selected'), 'true');
    assert.equal(await library.locator('.home-project-chat').count(), 0, 'project entry does not mount permanent AI onboarding');
    await library.getByRole('tab', {name:'Templates', exact:true}).click();
    await library.getByRole('button', {name:'Use A fresh beginning', exact:true}).click();
    const create = page.getByRole('dialog', {name:'New project', exact:true});
    await create.waitFor();
    assert.equal(await create.getByRole('textbox', {name:'Project name', exact:true}).inputValue(), 'A fresh beginning');
    assert.equal(await create.getByRole('radio').count(), 0, 'direct template source is already selected, full picker is disclosed on demand');
    assert.ok(await create.getByRole('button', {name:'Change template', exact:true}).isVisible());
    const name = `UX ${installed ? 'PWA' : 'web'} ${width}`;
    await create.getByRole('textbox', {name:'Project name', exact:true}).fill(name);
    if (width === 390) {
      // Native modal entry briefly scales the box; measure its settled target.
      await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent.trim() === 'Create landing')?.getBoundingClientRect().height >= 44);
      assert.ok((await create.getByRole('button', {name:'Create landing', exact:true}).boundingBox()).height >= 44, 'creation submit meets the coarse touch target');
    }
    await create.getByRole('button', {name:'Create landing', exact:true}).click();
    const content = page.getByRole('tab', {name:'Content', exact:true});
    await content.waitFor(); assert.equal(await content.getAttribute('aria-selected'), 'true', 'manual PWA/browser creation opens Content');
    const brand = page.getByRole('textbox', {name:/Brand name/});
    await brand.fill('Retained navigation edit');
    const saveStatus = page.getByRole('status').filter({hasText:/Saved|Saving|Unsaved/});
    await saveStatus.first().waitFor();
    if (width === 390) {
      const panels = page.getByRole('navigation', {name:'Workspace panels', exact:true});
      for (const panel of ['Files', 'Preview']) {
        await panels.getByRole('button', {name:panel, exact:true}).click();
        assert.equal(await page.getByRole('tablist', {name:'Authoring mode', exact:true}).count(), 0, `${panel} has no unrelated author-mode navigation`);
        assert.ok(await saveStatus.first().isVisible(), `${panel} retains save status`);
      }
      await panels.getByRole('button', {name:'Edit', exact:true}).click();
      assert.ok(await content.isVisible());
      assert.equal(await brand.inputValue(), 'Retained navigation edit', 'panel switching retains changes');
    }
    await page.getByRole('button', {name:'Content actions', exact:true}).click();
    const menu = page.getByRole('menu', {name:'Content actions', exact:true});
    const chooserPromise = page.waitForEvent('filechooser');
    await menu.getByRole('menuitem', {name:'Load JSON', exact:true}).click();
    await (await chooserPromise).setFiles({name:'content.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify({brand:'Imported content'}))});
    await page.waitForFunction(() => document.querySelector('#setting-brand')?.value === 'Imported content');
    assert.equal(await brand.inputValue(), 'Imported content', 'disclosed JSON action still loads current locale content');
    await page.getByRole('button', {name:'Export', exact:true}).click();
    await page.getByRole('menuitem', {name:/Editable project/}).click();
    const exportDialog = page.getByRole('dialog', {name:'Export', exact:true});
    await exportDialog.waitFor();
    assert.equal(await exportDialog.getByRole('combobox', {name:'Export destination', exact:true}).count(), 0, 'export format is chosen once');
    assert.ok((await exportDialog.innerText()).includes('Editable project'));
    if (installed) {
      assert.equal(await exportDialog.getByRole('checkbox', {name:'Include conversation history', exact:true}).isChecked(), true);
      const alignment = await exportDialog.locator('.export-history-option').evaluate(label => {
        const input = label.querySelector('input').getBoundingClientRect(), text = label.querySelector('span').getBoundingClientRect();
        return Math.abs(input.y + input.height / 2 - text.y - text.height / 2);
      });
      assert.ok(alignment <= 1, 'the history checkbox and label share one aligned row');
    }
    await exportDialog.getByRole('button', {name:'Cancel', exact:true}).click();
    await page.getByRole('button', {name:'Projects', exact:true}).click();
    await projects.waitFor(); assert.equal(await projects.getAttribute('aria-selected'), 'true', 'returning from editor defaults to Projects');
    const rowName = library.getByText(name, {exact:true}).first(); await rowName.waitFor();
    const box = await rowName.boundingBox(); assert.ok(box && box.y >= 0 && box.y + box.height <= 844, 'saved project appears in first viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no document overflow');
    await context.close();
  }
  assert.deepEqual(providerCalls, [], 'manual workflows never request a provider'); assert.deepEqual(errors, []);
  console.log('PASS: Projects/Templates, direct-source intent, manual PWA Content, mobile panel/save hierarchy, retained edits, JSON disclosure and single-choice export at 1440/390.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
