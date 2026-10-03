import { workspaceUrl } from './support/workspace-url.js';
// Global appearance settings: keyboard use, persistence and responsive layouts from library and editor.
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
    await page.goto(workspaceUrl(origin));
    const openSettings = async () => {
      await page.getByRole('button', {name:'Settings', exact:true}).click();
      await page.locator('.global-settings').waitFor();
      await page.waitForFunction(() => document.activeElement === document.querySelector('.global-settings-heading h1'));
    };
    await openSettings();
    assert.equal(await page.getByRole('radio').count(), 3);
    assert.equal(await page.getByRole('radio', {name:/System/}).isChecked(), true);
    await page.getByRole('radio', {name:/System/}).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'studio-light');
    await page.locator('.settings-theme-option').filter({hasText:'Dark'}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'studio-dark');
    await page.reload();
    await page.locator('.global-settings').waitFor();
    assert.equal(await page.getByRole('radio', {name:/Dark/}).isChecked(), true);
    await page.locator('.settings-theme-option').filter({hasText:'System'}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('studio-theme')), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const label of await page.locator('.settings-theme-option').all()) assert.ok((await label.boundingBox()).height >= 44);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.mouse.move(0, 0);
    await page.screenshot({animations:'disabled', path:join(output, `settings-${theme}-${width}-${installed ? 'pwa' : 'web'}.png`), fullPage:true});
    await page.getByRole('button', {name:'Back to projects', exact:true}).click();
    // The production create flow picks a real OPFS-backed directory under user activation.
    await usePicker(page, `settings-${theme}-${width}-${installed ? 'pwa' : 'web'}`);
    await page.getByRole('button', {name:'New project', exact:true}).click();
    await page.getByRole('button', {name:'Create landing', exact:true}).click();
    await page.getByRole('tablist', {name:'Authoring mode', exact:true}).getByRole('tab', {name:'Content', exact:true}).waitFor();
    await page.getByRole('tab', {name:'Conversations', exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.__pickerCalls), 1, 'manual create uses the activated folder picker');
    await openSettings();
    await page.getByRole('button', {name:'Back to project', exact:true}).click();
    await page.getByRole('tab', {name:'Content', exact:true}).waitFor();
    await page.screenshot({path:join(output, `editor-${theme}-${width}-${installed ? 'pwa' : 'web'}.png`)});
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(providerCalls, []);
  console.log('PASS: global theme settings, keyboard selection, persistence and project return, web/PWA ×1440/390 ×light/dark.');
} finally {await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done));}
