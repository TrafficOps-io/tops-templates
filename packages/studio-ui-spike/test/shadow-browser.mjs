import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const repository = resolve(process.argv[2] || '.'), require = createRequire(resolve(repository, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const hostTheme = await readFile(process.env.HOST_THEME_CSS || resolve(repository, '../../ads-toolbox/packages/ui/resources/css/theme.css'), 'utf8');
const spikeCss = await readFile(resolve(repository, 'packages/studio-ui-spike/src/spike.css'), 'utf8');
// В theme.css два блока `.dark`: первый (внутри @layer theme) содержит только --color-accent*, полный — тот, где есть --color-base-100.
const darkBlock = [...hostTheme.matchAll(/\.dark\s*{[^}]+}/g)].map(match => match[0]).find(block => block.includes('--color-base-100'));
if (!darkBlock) throw new Error('theme.css: full .dark block with --color-base-100 not found');
const rootBlock = hostTheme.match(/:root\s*{[^}]+}/)?.[0];
if (!rootBlock) throw new Error('theme.css: :root block not found');
const hostVars = rootBlock + '\n' + darkBlock;
const inherit = ['base-100','base-200','base-300','base-content','primary','primary-content','secondary','secondary-content','accent','accent-content','neutral','neutral-content','info','info-content','success','success-content','warning','warning-content','error','error-content'].map(name => `--color-${name}:inherit`).join(';');
const shadowCss = `:host{display:block;font:inherit;color:inherit;${inherit};--radius-field:inherit;--radius-box:inherit}\n${spikeCss}`;

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import SpikeChat from './packages/studio-ui-spike/src/SpikeChat.jsx';
const host = document.getElementById('host'), shadow = host.attachShadow({ mode: 'open' });
const sheet = new CSSStyleSheet(); sheet.replaceSync(${JSON.stringify(shadowCss)}); shadow.adoptedStyleSheets = [sheet];
const container = document.createElement('div'); container.id = 'portal'; shadow.append(container);
window.spike = { events: [] };
createRoot(container).render(<SpikeChat onEvent={event => window.spike.events.push(event)} />);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: repository, sourcefile: 'spike-entry.jsx', loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' } });
const script = bundle.outputFiles[0].contents;
const page = theme => `<!doctype html><html class="${theme}"><head><meta charset="utf-8"><style>${hostVars} body{margin:0;font-family:system-ui;background:var(--color-base-200);color:var(--color-base-content)} #host{height:480px}</style></head><body><div id="host"></div><script type="module" src="/spike.js"></script></body></html>`;
const server = createServer((request, response) => {
  if (request.url === '/spike.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); }
  else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(page(new URL(request.url, 'http://x').searchParams.get('theme') || '')); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } }), blocked = [];
  // Внешние запросы блокируются: assistant-ui и Streamdown не должны ходить в сеть.
  await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); blocked.push(route.request().url().split('?')[0]); return route.abort(); });
  const tab = await context.newPage();
  const errors = []; tab.on('pageerror', error => errors.push(error.message));
  const seen = {};
  for (const theme of ['', 'dark']) {
    await tab.goto(`${origin}/?theme=${theme}`);
    await tab.waitForFunction(() => document.getElementById('host')?.shadowRoot?.querySelector('.spike-message'));
    // Streamdown 2.7.0 рендерит жирный как span[data-streamdown="strong"], а не <strong>; ждём появления разметки.
    await tab.waitForFunction(() => document.getElementById('host').shadowRoot.querySelectorAll('.spike-message li').length >= 2);
    const colours = await tab.evaluate(() => {
      const root = document.getElementById('host').shadowRoot, message = root.querySelector('.spike-message');
      return { message: getComputedStyle(message).backgroundColor, expected: getComputedStyle(document.documentElement).getPropertyValue('--color-base-100').trim(), markdownBold: Boolean(root.querySelector('.spike-message strong, .spike-message [data-streamdown="strong"]')), listItems: root.querySelectorAll('.spike-message li').length };
    });
    const toRgb = hex => { const value = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16)); return `rgb(${r}, ${g}, ${b})`; };
    assert.equal(colours.message, toRgb(colours.expected), `тема ${theme || 'light'}: фон сообщения берётся из переменных хоста`);
    seen[theme || 'light'] = colours.message;
    assert.ok(colours.markdownBold && colours.listItems >= 2, `тема ${theme || 'light'}: Streamdown отрендерил markdown в shadow root`);
    // Клавиатура: @ открывает меню, Escape закрывает, Enter отправляет
    const input = tab.locator('#host').locator('[data-testid="spike-input"]');
    await input.click(); await input.press('@'); // Playwright всегда использует собственную US-раскладку
    await tab.waitForFunction(() => document.getElementById('host').shadowRoot.querySelector('[data-testid="spike-menu"]'));
    await input.press('Escape');
    assert.equal(await tab.evaluate(() => Boolean(document.getElementById('host').shadowRoot.querySelector('[data-testid="spike-menu"]'))), false, 'Escape закрывает меню');
    await input.fill('привет'); await input.press('Enter');
    await tab.waitForFunction(() => document.getElementById('host').shadowRoot.querySelectorAll('.spike-message').length >= 22);
    // Порталы: ничего из assistant-ui не должно оказаться в document.body вне host.
    // В 0.15.22 порталы использует только SelectionToolbar, ThreadListItem.More, AssistantModal и ActionBar.More —
    // в spike их нет, поэтому эта проверка подтверждает критерий «по факту неиспользования»; см. протокол Task 4.
    const leaked = await tab.evaluate(() => [...document.body.children].filter(node => node.id !== 'host' && node.tagName !== 'SCRIPT' && !(node.tagName === 'TEXTAREA' && node.getAttribute('aria-hidden') === 'true' && node.tabIndex === -1)).length);
    // Исключение выше — невидимый aria-hidden textarea для измерения высоты (react-textarea-autosize внутри ComposerPrimitive.Input), он не UI-портал; зафиксировано в протоколе.
    assert.equal(leaked, 0, 'assistant-ui не монтирует узлы в document.body');
  }
  assert.notEqual(seen.light, seen.dark, 'светлая и тёмная темы хоста дают разные фоны — проверка не тривиальна');
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, [], 'внешних запросов не было');
  console.log('shadow-browser: OK');
} finally { await browser?.close(); server.close(); }
