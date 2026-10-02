import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };
const server = createServer(async (req,res) => { try { const path=decodeURIComponent(new URL(req.url,'http://x').pathname); const file=resolve(join(root,path==='/'?'index.html':path)); res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0,'127.0.0.1',r));
// axe (WCAG 2 A/AA) on the whole project workspace — toolbar, panels, status bar and the narrow panel switch — in browser
// tabs and the installed app, at desktop and phone widths, in both themes. Previews and Monaco are other documents/widgets.
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
const out = [];
for (const installed of [false, true]) for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 }); const page = await context.newPage();
  await page.addInitScript(() => { window.showDirectoryPicker = undefined; });
  if (installed) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await page.route('https://openrouter.ai/**', r => r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const scan = async label => {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(n => document.documentElement.setAttribute('data-theme', `studio-${n}`), theme); await page.waitForTimeout(250);
      const { violations } = await new AxeBuilder({ page }).exclude('iframe').exclude('.monaco-editor').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of violations.filter(v => ['critical', 'serious'].includes(v.impact))) out.push(`${installed ? 'pwa' : 'web'} ${width} ${label} ${theme}: ${v.id} — ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`);
    }
  };
  await page.locator('.library').getByRole('tab', { name: 'Projects', exact: true }).waitFor();
  await scan('Projects');
  await page.locator('.library').getByRole('tab', { name: 'Templates', exact: true }).click(); await scan('Templates');
  await page.locator('.library').getByRole('tab', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await scan('Create project');
  const creation = page.getByRole('dialog', { name: 'New project', exact: true });
  await creation.getByText('Project options', { exact: true }).click();
  await scan('Project options');
  if (installed) {
    await creation.getByRole('button', { name: 'With AI', exact: true }).click();
    await creation.locator('textarea').waitFor();
    await scan('AI creation');
    await creation.getByRole('button', { name: 'From template', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Create landing', exact: true }).click();
  await page.locator('.editor-shell.is-app').waitFor(); await page.waitForTimeout(1500);
  for (const tab of installed ? ['Content', 'Code', 'Conversations'] : ['Content', 'Code']) {
    await page.getByRole('tab', { name: tab, exact: true }).click(); await page.waitForTimeout(1200);
    await scan(tab);
    if (tab === 'Conversations') {
      await page.locator('.studio-chat-header').getByRole('button', { name: 'Conversations', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Manage conversations', exact: true }).click();
      await page.getByRole('dialog').waitFor(); await scan('Manage conversations');
      await page.keyboard.press('Escape');
    }
  }
  if (width === 390) {
    const switcher = page.getByRole('navigation', { name: 'Workspace panels', exact: true });
    for (const panel of ['Files', 'Preview']) { await switcher.getByRole('button', { name: panel, exact: true }).click(); await scan(panel); }
    await switcher.getByRole('button', { name: 'Edit', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: /Editable project/ }).click();
  await page.getByRole('dialog', { name: 'Export', exact: true }).waitFor(); await scan('Export');
  await context.close();
}
try { assert.deepEqual(out, [], 'axe: no critical/serious violations in library, creation and workspace'); console.log('PASS: library, manual/AI creation/options, workspace and management/export dialogs axe in browser and installed modes, 1440/390 px, light and dark.'); }
finally { await browser.close(); server.close(); }
