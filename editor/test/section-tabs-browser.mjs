import { workspaceUrl } from './support/workspace-url.js';
// Regression for long section names wrapping/clipping in the fixed panel header.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, join} from 'node:path';
import {showPane, moreMenuItem, saveNow} from './support/studio-chat.js';
import {installFolderPicker, seedAndOpen, readProjectFolder, until} from './support/studio-folders.js';

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const names = ['Profile Details', 'Style & Accents', 'Main VIP Subscription', 'Core Socials & Channels', 'Additional Custom Links', 'Teaser Gallery Photos', 'VIP Highlights', 'Footer & Disclaimer'];
const source = `@template "Section navigation QA"\n${names.map((name, index) => `@section section_${index} ${JSON.stringify(name)}\n@param field_${index} String = "Value ${index}" label="Section ${index} text" required\n@endsection`).join('\n')}\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><h1>Section navigation QA</h1>${names.map((_, index) => `<p>{{ field_${index} }}</p>`).join('')}</body></html>\n@endlayout`;
const root = resolve(process.argv[2] || 'editor/dist');
const output = resolve(process.env.SECTION_TABS_SCREENSHOTS || '/tmp/trafficops-section-tabs');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2'};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    assert.ok(file.startsWith(`${root}/`));
    response.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream'});
    response.end(await readFile(file));
  } catch {response.writeHead(404); response.end();}
});
await mkdir(output, {recursive:true});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = process.env.STUDIO_SECTIONS_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, ...(process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
const errors = [], providerCalls = [];
try {
  for (const installed of [false, true]) for (const width of [1440, 1024, 390, 320]) {
    const theme = (installed ? width >= 1000 : width < 1000) ? 'light' : 'dark';
    const context = await browser.newContext({viewport:{width, height:900}, colorScheme:theme, hasTouch:width < 1000});
    await installFolderPicker(context);
    if (installed) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value:true, configurable:true}));
    await context.route('https://openrouter.ai/**', route => {providerCalls.push(route.request().url()); return route.abort();});
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(workspaceUrl(origin));
    await page.getByRole('heading', {name:'Projects', exact:true}).waitFor();
    const project = await seedAndOpen(page, {name:'Section navigation QA', kind:'landing', files:{'index.tpl':source}});
    await showPane(page, 'Edit');
    const bar = page.getByRole('tablist', {name:'Sections', exact:true});
    await bar.waitFor(); await page.locator('#setting-field_0').waitFor(); await page.evaluate(() => document.fonts.ready);
    const inspect = async ({mustOverflow = false} = {}) => {
      const metrics = await bar.evaluate(list => {
        const bounds = list.getBoundingClientRect();
        return {width:list.clientWidth, scrollWidth:list.scrollWidth, height:bounds.height, items:[...list.querySelectorAll('[role=tab]')].map(button => {
          const box = button.getBoundingClientRect(), label = button.querySelector(':scope > span'), range = document.createRange(); range.selectNodeContents(label);
          const text = range.getBoundingClientRect();
          return {name:label.textContent, lines:range.getClientRects().length, x:box.x, right:box.right, height:box.height, contained:text.top >= bounds.top - 1 && text.bottom <= bounds.bottom + 1 && text.left >= box.left - 1 && text.right <= box.right + 1};
        })};
      });
      assert.deepEqual(metrics.items.map(item => item.name), names, 'all template section names are preserved');
      for (const [index, item] of metrics.items.entries()) {
        assert.equal(item.lines, 1, `${item.name} stays on one line at ${width}px`);
        assert.ok(item.contained, `${item.name} is not clipped by its button or the panel header`);
        assert.ok(item.height >= (width < 1000 ? 44 : 32), 'section tabs retain usable hit targets');
        if (index) assert.ok(item.x >= metrics.items[index - 1].right, 'section tabs do not overlap');
      }
      if (mustOverflow) assert.ok(metrics.scrollWidth > metrics.width, 'long sections scroll inside their panel');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'section overflow does not widen the page');
    };
    const selectedVisible = async index => {
      const tab = bar.getByRole('tab').nth(index);
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      assert.equal(await tab.evaluate(node => node === document.activeElement), true);
      assert.equal(await tab.evaluate(node => {const box = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect(); return box.left >= list.left - 1 && box.right <= list.right + 1;}), true, 'keyboard selection scrolls into view');
      await page.locator(`#setting-field_${index}`).waitFor();
    };
    await bar.screenshot({path:join(output, `sections-${theme}-${width}-${installed ? 'pwa' : 'web'}-initial.png`)});
    await inspect({mustOverflow:true});
    await page.locator('#setting-field_0').fill('Retained section edit');
    await bar.getByRole('tab').first().focus();
    await page.keyboard.press('End'); await selectedVisible(names.length - 1);
    await page.keyboard.press('ArrowLeft'); await selectedVisible(names.length - 2);
    await page.keyboard.press('Home'); await selectedVisible(0);
    assert.equal(await page.locator('#setting-field_0').inputValue(), 'Retained section edit', 'section changes preserve edits');
    await page.locator('#setting-field_0').fill('');
    await bar.getByRole('tab').first().getByText(/\d+ issues/).waitFor(); await inspect();
    await page.locator('#setting-field_0').fill('Retained section edit');
    await page.waitForFunction(() => !document.querySelector('.hosted-sections .studio-tab-badge'));
    if (width >= 1000) {
      await (await moreMenuItem(page, 'Hide preview')).click(); await inspect();
      await bar.getByRole('tab').first().focus(); await page.keyboard.press('End'); await selectedVisible(names.length - 1);
      await page.screenshot({path:join(output, `sections-${theme}-${width}-${installed ? 'pwa' : 'web'}-wide.png`)});
      await page.screenshot({path:join(output, `sections-${theme}-${width}-${installed ? 'pwa' : 'web'}-header.png`), clip:{x:0, y:0, width, height:280}});
      await page.keyboard.press('Home');
    } else {
      await bar.getByRole('tab').first().focus(); await page.keyboard.press('End'); await selectedVisible(names.length - 1);
      await page.screenshot({path:join(output, `sections-${theme}-${width}-${installed ? 'pwa' : 'web'}-last.png`)});
      await page.keyboard.press('Home');
    }
    await saveNow(page);
    await until(async () => (await readProjectFolder(page, project.folder))?.values?.field_0 === 'Retained section edit', 'section edit is written to the project folder');
    await page.reload();
    if (installed) await page.getByRole('button', {name:'Open Section navigation QA', exact:true}).click();
    await showPane(page, 'Edit');
    await page.locator('#setting-field_0').waitFor(); assert.equal(await page.locator('#setting-field_0').inputValue(), 'Retained section edit', 'saved edits survive reload');
    await inspect(); await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(providerCalls, []);
  console.log('PASS: eight long section titles and issue badges, unclipped single-line layout, local overflow, keyboard visibility and retained edits; web/PWA ×1440/1024/390/320, light/dark.');
} finally {await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done));}
