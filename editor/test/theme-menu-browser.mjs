// Regression for unstyled menuitemradio entries in the editor's More menu.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, join} from 'node:path';
import {installFolderPicker, usePicker} from './support/studio-folders.js';
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const output = resolve(process.env.THEME_MENU_SCREENSHOTS || '/tmp/trafficops-theme-menu');
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
const origin = process.env.STUDIO_THEME_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, ...(process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
const errors = [], providerCalls = [];
try {
  for (const installed of [false, true]) for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({viewport:{width, height:900}, colorScheme:theme, hasTouch:width === 390});
    await installFolderPicker(context);
    if (installed) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value:true, configurable:true}));
    await context.route('https://openrouter.ai/**', route => {providerCalls.push(route.request().url()); return route.abort();});
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const inspectRows = async (menu, reference) => {
      const options = menu.getByRole('menuitemradio'); assert.equal(await options.count(), 3);
      const metrics = await options.evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(), icon = node.querySelector('svg').getBoundingClientRect(), text = node.querySelector('span').getBoundingClientRect();
        return {x:box.x, y:box.y, width:box.width, height:box.height, end:box.bottom, font:getComputedStyle(node).fontSize, alignment:Math.abs(icon.y + icon.height / 2 - text.y - text.height / 2)};
      }));
      const ref = reference ? await reference.evaluate(node => ({box:node.getBoundingClientRect().width, font:getComputedStyle(node).fontSize})) : null;
      for (const [index, row] of metrics.entries()) {
        assert.ok(row.height >= (width === 390 ? 44 : 32), 'menu rows retain usable hit targets');
        assert.ok(row.alignment <= 1, 'icon and caption are aligned horizontally');
        assert.ok(Math.abs(row.width - metrics[0].width) <= 1, 'all theme rows share a width');
        if (index) assert.ok(row.y >= metrics[index - 1].end - 1, 'theme choices are separate non-overlapping rows');
        if (ref) {assert.equal(row.font, ref.font, 'theme text matches regular menu text'); assert.ok(Math.abs(row.width - ref.box) <= 1, 'theme rows fill the regular menu width');}
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    };
    await page.getByRole('button', {name:'Theme', exact:true}).click();
    await inspectRows(page.getByRole('menu', {name:'Theme', exact:true})); await page.keyboard.press('Escape');
    // The production create flow picks a real OPFS-backed directory under user activation.
    await usePicker(page, `theme-menu-${theme}-${width}-${installed ? 'pwa' : 'web'}`);
    await page.getByRole('button', {name:'New project', exact:true}).click();
    await page.getByRole('button', {name:'Create landing', exact:true}).click();
    await page.getByRole('tablist', {name:'Authoring mode', exact:true}).getByRole('tab', {name:'Content', exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.__pickerCalls), 1, 'manual create uses the activated folder picker');
    const trigger = page.getByRole('button', {name:'More options', exact:true}); await trigger.click();
    const menu = page.getByRole('menu', {name:'More options', exact:true});
    await inspectRows(menu, menu.getByRole('menuitem', {name:'Quick start', exact:true}));
    await menu.screenshot({path:join(output, `theme-menu-${theme}-${width}-${installed ? 'pwa' : 'web'}.png`)});
    await page.keyboard.press('End'); assert.equal(await menu.getByRole('menuitemradio', {name:'Dark theme', exact:true}).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'studio-light');
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    await trigger.click(); assert.equal(await menu.getByRole('menuitemradio', {name:'Light theme', exact:true}).getAttribute('aria-checked'), 'true');
    await menu.getByRole('menuitemradio', {name:'Dark theme', exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'studio-dark');
    await page.reload(); await trigger.waitFor(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'studio-dark');
    await trigger.click(); await menu.getByRole('menuitemradio', {name:'System theme', exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('studio-theme')), null);
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(providerCalls, []);
  console.log('PASS: library/editor theme rows, sizes/alignment, keyboard/focus, selection and persistence, web/PWA ×1440/390 ×light/dark.');
} finally {await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done));}
