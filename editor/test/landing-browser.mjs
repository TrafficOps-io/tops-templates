import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { seedProjectFolder, editorReady } from './support/studio-folders.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const output = resolve(process.env.LANDING_SCREENSHOTS || '/tmp/landing-studio-review');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    assert.ok(file.startsWith(`${root}/`));
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.landing-hero').waitFor();
  assert.equal(await page.locator('.library').count(), 0);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme} ${width}: overflow`);
      const cta = await page.locator('.landing-hero .landing-primary').boundingBox();
      assert.ok(cta.y + cta.height < 900, `${width}: hero action visible`);
      if (width >= 768) {
        assert.ok(await page.locator('h1').evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) < 2.1, `${width}: headline stays two lines`);
      }
      await page.locator(`.landing-hero .landing-shot-${theme}`).waitFor({ state: 'visible' });
      if ([390, 1440].includes(width)) {
        for (const image of await page.locator('.landing-page img:visible').all()) {
          await image.scrollIntoViewIfNeeded();
          await image.evaluate(img => img.decode());
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `${theme} ${width}: accessibility`);
        await page.screenshot({ path: `${output}/landing-${theme}-${width}.png`, fullPage: true });
      }
    }
  }
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Light theme', exact: true }).click();
  assert.equal(await page.locator('.landing-hero .landing-shot-light').isVisible(), true, 'manual theme overrides OS');
  const tabs = page.getByRole('tablist', { name: 'Explore Studio features' });
  await tabs.getByRole('tab').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('heading', { name: 'Content, code and preview. Together.' }).waitFor();
  await page.keyboard.press('End');
  await page.getByRole('heading', { name: 'Your next launch starts with a ZIP.' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open Studio', exact: true }).count(), 0);
  await page.locator('.landing-header').getByRole('button', { name: 'Install Studio', exact: true }).click();
  await page.locator('.landing-install-guide[open]').waitFor();
  assert.equal(await page.locator('.landing-install-guide summary').evaluate(el => el === document.activeElement), true);
  for (const [selector, outcome] of [['.landing-hero', 'dismissed'], ['.landing-closing', 'accepted'], ['.landing-install', 'failed']]) {
    await page.evaluate(outcome => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = () => {
        if (outcome === 'failed') throw new Error('Unavailable');
        window.installHasUserActivation = navigator.userActivation.isActive;
        return new Promise(resolve => { window.finishInstall = () => resolve({ outcome }); });
      };
      window.dispatchEvent(event);
    }, outcome);
    await page.locator(selector).getByRole('button', { name: 'Install Studio', exact: true }).click();
    if (outcome !== 'failed') {
      assert.equal(await page.locator('.landing-page .landing-primary:disabled').count(), 4, 'all install actions wait for the single-use prompt');
      assert.equal(await page.evaluate(() => window.installHasUserActivation), true);
      await page.evaluate(() => window.finishInstall());
    }
    assert.equal(new URL(page.url()).searchParams.has('studio'), false, 'installation keeps the public landing open');
    await page.getByRole('status').filter({ hasText: outcome === 'failed' ? 'could not start' : outcome }).waitFor();
  }
  await page.locator('.landing-hero').getByRole('link', { name: 'Use in browser', exact: true }).click();
  await page.locator('.library').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('studio'), '1');
  await page.goBack(); await page.locator('.landing-hero').waitFor();
  await page.goto(`${origin}/#settings`);
  await page.locator('.global-settings').waitFor();
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.locator('.library').waitFor();
  await page.goto(origin); await page.locator('.landing-hero').waitFor();
  await context.close();
  console.log('PASS: landing layouts 320–1440 in both themes, axe, theme override, keyboard tour, install fallback/accept/dismiss/error, browser entry/back and legacy settings.');

  for (const path of ['/', '/?studio=1']) {
    const app = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await app.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      window.showDirectoryPicker = undefined;
    });
    const window = await app.newPage(); window.on('pageerror', error => errors.push(error.message));
    await window.goto(origin + path); await window.locator('.installed-app .library').waitFor();
    assert.equal(await window.locator('.landing-page').count(), 0);
    await seedProjectFolder(window, { name: 'Local launch check', opfs: true });
    await window.reload(); await window.getByRole('button', { name: 'Open Local launch check', exact: true }).click(); await editorReady(window);
    assert.ok(await window.evaluate(() => localStorage.getItem('trafficops-studio-last-project')));
    await window.reload(); await window.locator('.library').waitFor();
    assert.equal(await window.locator('.editor-shell').count(), 0, 'installed relaunch does not restore the last editor');
    await window.evaluate(() => navigator.serviceWorker.ready);
    await window.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await app.setOffline(true);
    await window.reload(); await window.locator('.library').waitFor();
    await window.getByRole('tab', { name: 'Templates', exact: true }).click();
    await window.getByRole('heading', { name: 'Product spotlight', exact: true }).waitFor();
    await window.getByRole('tab', { name: /Projects/ }).click();
    await window.getByRole('button', { name: 'Open Local launch check', exact: true }).click(); await editorReady(window);
    assert.equal(await window.evaluate(() => fetch('/offline-probe', { cache: 'no-store' }).then(() => false, () => true)), true);
    await app.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: installed old/new start URLs, saved-project relaunch to library, real service-worker offline library/templates/editor; no runtime errors.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
