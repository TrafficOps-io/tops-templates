import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundle = await build({ entryPoints: ['editor/src/preview/interactive-preview.js'], bundle: true, write: false, format: 'iife', globalName: 'PreviewRuntime', target: 'es2022', minify: true });
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/runtime.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/runtime.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/runtime.js"></script><div id="mount"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const files = {
    'index.html': `<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"><script>window.execution=['inline'];</script><script type="importmap">{"imports":{"aliased/":"./js/","choice":"./js/default-choice.js"},"scopes":{"./js/scoped/":{"choice":"./js/scoped-choice.js"}}}</script><script src="js/classic.js" defer></script><script type="module" src="js/main.js"></script></head><body><h1>First page</h1><button id="count" onclick="this.textContent=Number(this.textContent)+1">0</button><img id="picture" src="assets/pixel.svg"><a id="next" href="pages/next.html?from=index#target">Next</a><button id="js-next" onclick="window.location.href='pages/next.html?from=js#target'">JS next</button><form action="pages/next.html"><input name="from" value="form"><button id="form-next">Form next</button></form><div id="result"></div></body></html>`,
    'styles/main.css': '@import "nested.css"; h1 { color: rgb(11, 22, 33); }',
    'styles/nested.css': 'body { background-image: url("../assets/pixel.svg"); }',
    'assets/pixel.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
    'js/classic.js': 'window.execution.push("classic");',
    'js/main.js': 'import { value } from "./value.js?v=1"; import { cycle } from "./cycle-a.js"; import { alias } from "aliased/alias.js"; import { scoped } from "./scoped/main.js"; import json from "../data.json" with {type:"json"}; const dynamic = await import("./dynamic.js"); const data = await (await fetch(new URL("../data.json", import.meta.url))).json(); document.querySelector("#result").textContent = [value,dynamic.value,data.value,cycle()].join("/"); window.execution.push("module"); const image=new Image(); image.id="dynamic-picture"; image.src=new URL("../assets/pixel.svg",import.meta.url); document.body.append(image); document.body.dataset.alias=alias; document.body.dataset.scoped=scoped; document.body.dataset.json=json.value; document.body.dataset.binary=[...new Uint8Array(await(await fetch("/binary.bin")).arrayBuffer())].join(",");',
    'js/alias.js': 'export const alias="mapped";',
    'js/default-choice.js': 'export const choice="default";',
    'js/scoped-choice.js': 'export const choice="scoped";',
    'js/scoped/main.js': 'import {choice} from "choice"; export const scoped=choice;',
    'js/value.js': 'export const value = "static";',
    'js/dynamic.js': 'export const value = "dynamic";',
    'js/cycle-a.js': 'import { second } from "./cycle-b.js"; export const first="cycle"; export const cycle=()=>second();',
    'js/cycle-b.js': 'import { first } from "./cycle-a.js"; export const second=()=>first;',
    'data.json': '{"value":"json"}',
    'pages/next.html': '<!doctype html><h1 id="target">Second page</h1><div id="nested"></div><script>fetch(new Request("../data.json")).then(response=>response.json()).then(data=>document.querySelector("#nested").textContent=data.value); document.body.dataset.query=location.search;</script><a href="../index.html" id="back">Back</a>',
  };
  await page.evaluate(files => {
    files['binary.bin'] = new Uint8Array([0, 127, 255]);
    window.previewFiles = files;
    window.mountPreview = (files = window.previewFiles) => {
      const result = PreviewRuntime.buildInteractivePreview(files, 'index.html');
      const iframe = document.createElement('iframe'); iframe.setAttribute('sandbox', result.sandbox); iframe.srcdoc = result.html;
      window.previewToken = result.readyToken; window.previewReady = false;
      document.querySelector('#mount').replaceChildren(iframe);
    };
    addEventListener('message', event => { if (event.source === document.querySelector('iframe')?.contentWindow && event.data?.type === 'trafficops-preview-ready' && event.data.token === window.previewToken) window.previewReady = true; });
    window.mountPreview();
  }, files);
  let frame = page.frames()[1];
  await frame.getByText('static/dynamic/json/cycle', { exact: true }).waitFor();
  await page.waitForFunction(() => window.previewReady);
  assert.deepEqual(await frame.evaluate(() => window.execution), ['inline', 'classic', 'module']);
  assert.equal(await frame.locator('h1').evaluate(node => getComputedStyle(node).color), 'rgb(11, 22, 33)');
  assert.equal(await frame.locator('#picture').evaluate(node => node.complete && node.naturalWidth), 1);
  assert.equal(await frame.locator('#dynamic-picture').evaluate(node => node.complete && node.naturalWidth), 1);
  assert.equal(await frame.locator('body').getAttribute('data-alias'), 'mapped');
  assert.equal(await frame.locator('body').getAttribute('data-scoped'), 'scoped');
  assert.equal(await frame.locator('body').getAttribute('data-json'), 'json');
  assert.equal(await frame.locator('body').getAttribute('data-binary'), '0,127,255');
  await frame.locator('#count').click(); assert.equal(await frame.locator('#count').textContent(), '1');
  await context.setOffline(true);
  await frame.locator('#next').click();
  await frame.getByText('Second page', { exact: true }).waitFor();
  await frame.getByText('json', { exact: true }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-query'), '?from=index');
  assert.equal(await frame.evaluate(() => location.origin), 'null');
  await frame.locator('#back').click();
  await frame.getByText('static/dynamic/json/cycle', { exact: true }).waitFor();
  assert.equal(await frame.locator('#count').textContent(), '0', 'navigation creates a fresh JavaScript document');
  await frame.locator('#js-next').click();
  await frame.getByText('json', { exact: true }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-query'), '?from=js');
  await frame.locator('#back').click();
  await frame.getByText('static/dynamic/json/cycle', { exact: true }).waitFor();
  await frame.locator('#form-next').click();
  await frame.getByText('json', { exact: true }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-query'), '?from=form');
  await page.evaluate(() => { window.previewFiles['js/value.js'] = 'export const value="updated";'; window.mountPreview(); });
  await page.frameLocator('iframe').getByText('updated/dynamic/json/cycle', { exact: true }).waitFor();
  await page.waitForFunction(() => window.previewReady);
  assert.deepEqual(errors, []);
  console.log('PASS: opaque local blobs, inline/classic JS, static/dynamic/cyclic modules, module-relative and page-relative fetch, CSS/assets, ready signal, offline multipage navigation and refreshed latest source.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
