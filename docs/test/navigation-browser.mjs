import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, join} from 'node:path';
import {AxeBuilder} from '@axe-core/playwright';
import {parseTemplate, renderTemplate, getDefaults} from '../../runtime/src/index.js';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'docs/.vitepress/dist');
const output = resolve(process.env.DOCS_SCREENSHOTS || '/tmp/trafficops-docs-navigation');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2'};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    assert.ok(url.pathname.startsWith('/tops-templates/'));
    let path = decodeURIComponent(url.pathname.slice('/tops-templates'.length));
    if (path.endsWith('/')) path += 'index.html';
    else if (!extname(path)) path += '.html';
    const file = resolve(root, `.${path}`);
    assert.ok(file.startsWith(`${root}/`));
    const content = await readFile(file);
    response.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream'});
    response.end(content);
  } catch {
    response.writeHead(404, {'Content-Type': 'text/html'});
    response.end(await readFile(join(root, '404.html')));
  }
});
await mkdir(output, {recursive: true});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/tops-templates/`;
const results = [], errors = [], accessibility = [];
let browser;
try {
  // The home example is a real template, rather than a decorative code panel.
  const markdown = await readFile(new URL('../index.md', import.meta.url), 'utf8');
  const source = /```tpl\n([\s\S]*?)\n```/.exec(markdown)?.[1];
  assert.ok(source, 'the home provides one TPL example');
  assert.equal((markdown.match(/```tpl/g) || []).length, 1);
  const definition = parseTemplate(source);
  assert.equal(renderTemplate(definition, getDefaults(definition)).trim(), '<h1>New campaign</h1>');

  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : process.platform === 'darwin' ? {executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 900}, colorScheme: theme, hasTouch: width === 390});
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${width} ${theme}: ${error.message}`));
    const capture = async name => page.screenshot({path: join(output, `docs-${name}-${width}-${theme}.png`), fullPage: ['home', 'article', '404'].includes(name)});
    const scan = async name => {
      const {violations} = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const violation of violations.filter(item => ['serious', 'critical'].includes(item.impact))) {
        const finding = {width, theme, name, id: violation.id, targets: violation.nodes.map(node => node.target)};
        accessibility.push(finding);
      }
      results.push({width, theme, name, accessibility: violations.length});
    };
    const inspect = async name => {
      await page.waitForFunction(() => Boolean(document.querySelector('#docs-main-content')));
      assert.equal(await page.getByRole('main').count(), 1, `${name} has one main landmark`);
      assert.equal(await page.locator('.VPSkipLink').getAttribute('href'), '#docs-main-content');
      assert.equal(await page.locator('.DocSearch-Button-Keys').getAttribute('aria-hidden'), 'true');
      assert.equal(await page.getByRole('button', {name: 'Search documentation', exact: true}).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} has no document overflow`);
      await scan(name);
    };
    await page.goto(base);
    await page.getByRole('heading', {level: 1}).waitFor();
    await inspect('home');
    assert.equal(await page.locator('.docs-workflow-link').count(), 3);
    const positions = await page.locator('.docs-workflow-link').evaluateAll(links => links.map(link => link.getBoundingClientRect().bottom));
    assert.ok(positions.every(bottom => bottom <= (width === 390 ? 844 : 900)), 'all workflows appear in the first viewport');
    assert.ok((await page.locator('.docs-example').boundingBox()).y >= positions.at(-1), 'the example follows the workflows');
    assert.equal(await page.locator('.language-tpl').count(), 1);
    await capture('home');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('VPSkipLink')), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'docs-main-content');
    // SPA navigation retains the corrected content target after the page changes.
    await page.locator('.docs-entry-links').getByRole('link', {name: 'Get started'}).click();
    await page.getByRole('heading', {name: /^Overview/}).waitFor();
    await inspect('article');
    assert.ok(await page.locator('.vp-doc table').count());
    assert.ok(await page.locator('.VPDocFooter .next').count());
    assert.ok(await page.locator('.vp-doc button.copy').count());
    if (width === 1440) assert.ok(await page.locator('.VPDocAsideOutline .outline-link').count());
    await capture('article');

    // Search keeps native loading and handlers while its semantics form a
    // dialog containing a combobox and one option per result link.
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+k' : 'Control+k');
    const input = page.locator('#localsearch-input');
    const checkSearchState = async () => {
      await page.waitForFunction(() => {
        const popup = document.querySelector('.VPLocalSearchBox'), input = popup?.querySelector('#localsearch-input');
        const id = input?.getAttribute('aria-activedescendant'), option = id && document.getElementById(id);
        return popup?.getAttribute('role') === 'dialog' && input?.getAttribute('role') === 'combobox'
          && (!id || (option?.getAttribute('role') === 'option' && option.getAttribute('aria-selected') === 'true'));
      });
      assert.equal(await page.locator('.VPLocalSearchBox').getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('.VPLocalSearchBox').getAttribute('aria-owns'), null);
      const duplicateIds = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
        return ids.filter((id, index) => ids.indexOf(id) !== index);
      });
      assert.deepEqual(duplicateIds, []);
      const active = await input.getAttribute('aria-activedescendant');
      if (active) {
        const bounds = await page.locator(`#${active}`).boundingBox();
        const shell = await page.locator('.VPLocalSearchBox .shell').boundingBox();
        assert.ok(bounds && shell && bounds.y >= shell.y && bounds.y < shell.y + shell.height, 'the selected option is visible');
        assert.equal(await page.locator(`#${active}`).getAttribute('aria-selected'), 'true');
      }
    };
    await page.keyboard.press(shortcut);
    await input.waitFor();
    await input.fill('First template');
    await page.locator('.VPLocalSearchBox').getByRole('option').first().waitFor();
    await checkSearchState();
    await capture('search');
    await scan('search');
    const original = await input.getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(id => document.querySelector('#localsearch-input').getAttribute('aria-activedescendant') !== id, original);
    await checkSearchState();
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(id => document.querySelector('#localsearch-input').getAttribute('aria-activedescendant') === id, original);
    await checkSearchState();
    const desired = page.locator('.VPLocalSearchBox').getByRole('option', {name: 'Your first template', exact: true}).first();
    const index = Number(await desired.getAttribute('data-index'));
    const current = Number((await input.getAttribute('aria-activedescendant')).split('-').at(-1));
    const count = await page.locator('.VPLocalSearchBox').getByRole('option').count();
    for (let step = 0; step < (index - current + count) % count; step++) await page.keyboard.press('ArrowDown');
    await checkSearchState();
    await page.keyboard.press('Enter');
    await page.waitForURL(/guide\/first-template/);
    await page.getByRole('heading', {name: /^Your first template/}).waitFor();

    await page.keyboard.press(shortcut);
    await input.waitFor();
    await input.fill('Threat model');
    const threat = page.locator('.VPLocalSearchBox').getByRole('option', {name: 'Threat model', exact: true}).first();
    await threat.waitFor();
    await checkSearchState();
    await threat.click();
    await page.waitForURL(/threat-model/);
    await page.getByRole('heading', {name: /^Threat model/}).waitFor();

    const searchTrigger = page.getByRole('button', {name: 'Search documentation', exact: true});
    await searchTrigger.focus();
    await page.keyboard.press('Enter');
    await input.waitFor();
    await input.fill('First template');
    await page.locator('.VPLocalSearchBox').getByRole('option').first().waitFor();
    const details = page.getByRole('button', {name: 'Display detailed list', exact: true});
    const detailed = (await details.getAttribute('class')).includes('detailed-list');
    await details.click();
    await page.waitForFunction(previous => document.querySelector('.toggle-layout-button').classList.contains('detailed-list') !== previous, detailed);
    await checkSearchState();
    await page.getByRole('button', {name: 'Reset search', exact: true}).click();
    assert.equal(await input.inputValue(), '');
    await page.waitForFunction(() => !document.querySelector('.VPLocalSearchBox [role=option]'));
    await checkSearchState();
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    assert.equal(await input.getAttribute('aria-controls'), null);
    assert.equal(await input.getAttribute('aria-activedescendant'), null);
    await scan('search-reset');
    await page.keyboard.press('Escape');
    await input.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search documentation');
    // Header grouping preserves its destinations on both desktop and mobile.
    if (width === 390) {
      await page.getByRole('button', {name: 'mobile navigation', exact: true}).focus();
      await page.keyboard.press('Enter');
      await page.locator('.VPNavScreen').getByRole('button', {name: 'Tools', exact: true}).click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.VPNavScreen')).opacity === '1');
      for (const label of ['PHP', 'CLI & Editor', 'Agent skills']) await page.locator('.VPNavScreen').getByRole('link', {name: label, exact: true}).waitFor();
      await capture('menu');
      await scan('menu');
      await page.locator('.VPNavScreen').getByRole('link', {name: 'PHP', exact: true}).focus();
    } else {
      const tools = page.locator('.VPNavBarMenuGroup');
      await tools.getByRole('button', {name: 'Tools', exact: true}).focus();
      await page.keyboard.press('Enter');
      for (const label of ['PHP', 'CLI & Editor', 'Agent skills']) await tools.getByRole('link', {name: label, exact: true}).waitFor();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.VPNavBarMenuGroup .menu')).opacity === '1');
      await capture('menu');
      await scan('menu');
      await tools.getByRole('link', {name: 'PHP', exact: true}).focus();
    }
    await page.keyboard.press('Enter');
    await page.waitForURL(/guide\/php/);
    if (width === 1440) await page.locator('.VPNavBarMenuGroup.active').waitFor();
    if (width === 390) {
      await page.locator('.VPLocalNav').getByRole('button', {name: 'Menu', exact: true}).click();
      await page.locator('.VPSidebar').getByRole('link', {name: 'First template', exact: true}).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.VPSidebar.open').waitFor({state: 'hidden'});
    }
    await page.goto(`${base}language-v1`);
    await inspect('reference');
    assert.ok(await page.locator('.vp-doc table').count());
    await capture('reference');
    await page.locator('.vp-doc table').first().scrollIntoViewIfNeeded();
    await capture('reference-table');
    if (width === 1440) {
      const anchor = page.locator('.VPDocAsideOutline .outline-link').first();
      await anchor.click();
      assert.ok(new URL(page.url()).hash);
    }
    await page.goto(`${base}a-page-that-does-not-exist`);
    await page.getByRole('heading', {name: 'PAGE NOT FOUND', exact: true}).waitFor();
    await inspect('404');
    await capture('404');
    await page.getByRole('link', {name: 'go to home', exact: true}).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(base);
    await page.getByRole('heading', {level: 1}).waitFor();
    if (width === 1440 && theme === 'light') {
      await page.getByRole('switch').click();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
      await page.reload();
      await page.getByRole('heading', {level: 1}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true, 'the theme preference persists after reload');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = {checks: results.length, pageErrors: errors, seriousOrCriticalAccessibility: accessibility, screenshots: output};
  await writeFile(process.env.DOCS_RESULTS || join(output, 'docs-browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(accessibility, []);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
