// Capture the real Studio in an isolated browser profile. No user projects or AI requests.
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { seedProjectFolder, openProject, editorReady } from '../test/support/studio-folders.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const origin = process.env.STUDIO_URL || 'http://127.0.0.1:5176';
const out = resolve('editor/public/marketing');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'allow' });
  await context.addInitScript(() => { window.showDirectoryPicker = undefined; });
  const page = await context.newPage();
  const capture = async name => {
    const pixels = await page.screenshot();
    await sharp(pixels).webp({ quality: 86 }).toFile(`${out}/${name}.webp`);
    await sharp(pixels).resize(720).webp({ quality: 82 }).toFile(`${out}/${name}-720.webp`);
  };
  await page.goto(`${origin}/?studio=1`);
  await page.locator('.library').waitFor();
  const archive = unzipSync(await readFile('editor/public/template-repositories/trafficops/starter-product.zip'));
  const files = Object.fromEntries(Object.entries(archive).filter(([name]) => !name.startsWith('.trafficops/') && !name.endsWith('/')).map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]));
  await seedProjectFolder(page, { name: 'Product launch', kind: 'landing', files, values: { accent: '#ed826b' }, opfs: true });
  await page.reload();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('studio-theme', theme); document.documentElement.setAttribute('data-theme', `studio-${theme}`); }, theme);
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.starter-grid img')].length > 0 && [...document.querySelectorAll('.starter-grid img')].every(img => img.complete && img.naturalWidth > 0));
    await page.evaluate(() => document.fonts.ready);
    await capture(`templates-${theme}`);
    await page.getByRole('tab', { name: /Projects/ }).click();
    await page.locator('.library-thumbnail iframe').first().contentFrame().getByRole('heading', { level: 1 }).waitFor();
    await capture(`projects-${theme}`);
    await openProject(page, 'Product launch');
    await editorReady(page);
    await page.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
    await page.locator('.browser-frame iframe.is-visible').waitFor();
    await page.waitForFunction(() => !document.querySelector('.studio-app-error'));
    await page.waitForTimeout(1000);
    await capture(`editor-${theme}`);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: /HTML/ }).click();
    await page.getByRole('dialog', { name: 'Export', exact: true }).waitFor();
    await capture(`export-${theme}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
  }
  console.log(`Real Studio screenshots saved to ${out}`);
} finally { await browser.close(); }
