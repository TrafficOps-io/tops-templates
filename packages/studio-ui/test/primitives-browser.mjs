import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = path => fileURLToPath(new URL(path, import.meta.url));
const tokens = JSON.parse(readFileSync(here('../../studio-tokens/tokens.json'), 'utf8'));
// same map as studio-tokens/test/sync.test.js
const map = { page: '--color-base-200', surface: '--color-base-100', 'surface-raised': '--studio-surface-raised', overlay: '--studio-overlay', border: '--color-base-300', 'border-strong': '--studio-border-strong', text: '--color-base-content', muted: '--color-secondary', 'text-on-accent': '--color-primary-content', accent: '--color-primary', 'accent-hover': '--studio-accent-hover', focus: '--studio-focus', success: '--color-success', warning: '--color-warning', danger: '--color-error', info: '--color-info' };
const theme = tokens.themes['studio-dark'];
const themeCss = `[data-theme="studio-dark"] { ${Object.entries(map).map(([token, variable]) => `${variable}: ${theme[token]};`).join(' ')} }`;

const bundle = await build({
  stdin: { contents: "import { createRoot } from 'react-dom/client'; import { createElement } from 'react'; import Playground from './Playground.jsx'; createRoot(document.getElementById('root')).render(createElement(Playground));", resolveDir: here('./fixtures/'), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [here('../node_modules'), here('../../../node_modules')],
});
const script = bundle.outputFiles[0].text;
const css = ['../../studio-tokens/tokens.css', '../styles.css'].map(file => readFileSync(here(file), 'utf8')).join('\n');

const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}${themeCss}\n${css}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({ content: script });
  await page.getByRole('tablist').waitFor();
  const focusedId = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent);

  // Tabs
  const tabs = page.getByRole('tab');
  assert.equal(await tabs.count(), 3);
  await page.keyboard.press('Tab');
  assert.equal(await focusedId(), 'pg-tabs-one', 'first Tab lands on the active tab');
  // focus ring colour equals --ui-focus
  const ring = await page.evaluate(() => ({ outline: getComputedStyle(document.activeElement).outlineColor, focus: getComputedStyle(document.getElementById('focus-probe')).color }));
  assert.equal(ring.outline, ring.focus, 'focus ring uses --ui-focus');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#pg-tabs-two').getAttribute('aria-selected'), 'true');
  assert.equal(await focusedId(), 'pg-tabs-two', 'focus follows selection');
  await page.keyboard.press('End');
  assert.equal(await page.locator('#pg-tabs-three').getAttribute('aria-selected'), 'true');
  assert.equal(await focusedId(), 'pg-tabs-three');
  const controls = await page.locator('#pg-tabs-three').getAttribute('aria-controls');
  assert.equal(await page.locator(`[id="${controls}"]`).count(), 1, 'aria-controls resolves to a panel');
  assert.equal(await page.locator(`[id="${controls}"]`).getAttribute('role'), 'tabpanel');

  // Menu
  const trigger = page.getByRole('button', { name: 'Actions' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click();
  await page.getByRole('menu').waitFor();
  assert.equal(await focusedId(), 'Rename', 'first menuitem focused');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedId(), 'Duplicate');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await focusedId(), 'Actions', 'focus returns to trigger');
  await trigger.click();
  await page.getByRole('menu').waitFor();
  await page.locator('#outside').click();
  assert.equal(await page.getByRole('menu').count(), 0, 'outside click closes the menu');

  // ConfirmDialog
  const opener = page.getByRole('button', { name: 'Open confirm' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await focusedId(), 'Confirm', 'confirm button focused');
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true, `Tab ${index + 1} stays inside the dialog`);
  }
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true, 'Shift+Tab stays inside the dialog');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0, 'Escape closes the dialog');
  assert.equal(await focusedId(), 'Open confirm', 'focus returns to the opener');

  // Toast: danger stays past 5.5 s
  await page.getByRole('button', { name: 'toast' }).click();
  const toast = page.locator('.studio-toast[role="alert"]');
  await toast.waitFor();
  await delay(5500);
  assert.equal(await toast.count(), 1, 'danger toast is still there after 5.5 s');
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  assert.equal(await page.locator('.studio-toast').count(), 0, 'dismiss button closes the toast');

  // InlineNotice
  assert.equal(await page.locator('.studio-notice[role="alert"]').count(), 1);

  // Button loading keeps its accessible name
  const busy = page.getByRole('button', { name: 'Saving' });
  assert.equal(await busy.count(), 1, 'loading button is found by name');
  assert.equal(await busy.getAttribute('aria-busy'), 'true');

  // MentionChip remove
  for (const [selector, name] of [['.studio-chip-mention .studio-chip-main', 'chip'], ['.studio-chip-mention .studio-chip-remove', 'chip remove']]) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.width >= 32 && box.height >= 32, `${name} hit target ${Math.round(box.width)}×${Math.round(box.height)} ≥ 32 px`);
  }
  await page.getByRole('button', { name: 'Remove Hero' }).click();
  assert.equal(await page.locator('.studio-chip-mention').count(), 0, 'chip removed');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('primitives-browser: OK');
} finally { await browser.close(); }
