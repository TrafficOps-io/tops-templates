import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createZip } from '@trafficops/template-editor-core';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2', '.ttf':'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const source = '@param title String = "First" label="Title"\n@layout\n<!doctype html><html><head><style>body{background:#eeddbb;color:#123;font:24px sans-serif}</style></head><body><h1>{{title}}</h1><button id="counter">0</button><p id="data"></p><a href="other.html">Next page</a><script type="module" src="app.js"></script></body></html>\n@endlayout';
const files = {'index.tpl':source,'other.html':'<h1>Other page</h1><button onclick="this.textContent=\'clicked\'">Other button</button>',
  'app.js':'import {value} from "./value.js"; await new Promise(resolve=>setTimeout(resolve,350)); document.querySelector("#counter").onclick=event=>event.target.textContent=Number(event.target.textContent)+1; const data=await(await fetch("./data.json")).json(); document.querySelector("#data").textContent=value+data.value;',
  'value.js':'export const value="module:";', 'data.json':'{"value":"fetched"}'};
let browser, page;
const errors=[];
try {
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  const context=await browser.newContext({viewport:{width:1600,height:1100}}); page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('Import project ZIP',{exact:true}).setInputFiles({name:'Interactive.zip',mimeType:'application/zip',buffer:Buffer.from(createZip(files))});
  const visible=()=>page.locator('.browser-frame iframe.is-visible');
  await visible().contentFrame().getByRole('heading',{name:'First',exact:true}).waitFor();
  await visible().contentFrame().getByText('module:fetched',{exact:true}).waitFor();
  await visible().contentFrame().getByRole('button',{name:'0',exact:true}).click();
  await visible().contentFrame().getByRole('button',{name:'1',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Content',exact:true}).click();
  await page.evaluate(()=>{
    window.originalFrame=document.querySelector('.browser-frame iframe.is-visible');window.previewSamples=[];window.samplePreview=true;
    window.buffered=false;window.bufferObserver=new MutationObserver(()=>{if(document.querySelector('iframe.is-preparing')&&document.querySelector('iframe.is-visible')===window.originalFrame)window.buffered=true;});
    window.bufferObserver.observe(document.querySelector('.browser-frame'),{childList:true,subtree:true});
    const sample=()=>{if(!window.samplePreview)return;window.previewSamples.push(document.querySelectorAll('.browser-frame iframe.is-visible').length);requestAnimationFrame(sample);};requestAnimationFrame(sample);
  });
  await page.locator('#setting-title').fill('Updated');
  await visible().contentFrame().getByRole('heading',{name:'Updated',exact:true}).waitFor();
  await visible().contentFrame().getByText('module:fetched',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>{window.bufferObserver.disconnect();return window.buffered;}),true,'old document stays visible while successor executes');
  const samples=await page.evaluate(()=>{window.samplePreview=false;return window.previewSamples;});
  assert.ok(samples.length>10);assert.ok(samples.every(count=>count===1),'every animation frame has exactly one visible preview');
  await page.getByRole('button',{name:'Pause automatic preview',exact:true}).click();
  await page.locator('#setting-title').fill('Paused edit');
  await page.waitForTimeout(1000);
  await visible().contentFrame().getByRole('heading',{name:'Updated',exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh preview',exact:true}).click();
  await visible().contentFrame().getByRole('heading',{name:'Paused edit',exact:true}).waitFor();
  await page.locator('#setting-title').fill('Resumed');
  await page.getByRole('button',{name:'Resume automatic preview',exact:true}).click();
  await visible().contentFrame().getByRole('heading',{name:'Resumed',exact:true}).waitFor();
  await visible().contentFrame().getByRole('link',{name:'Next page',exact:true}).click();
  await visible().contentFrame().getByRole('heading',{name:'Other page',exact:true}).waitFor();
  await visible().contentFrame().getByRole('button',{name:'Other button',exact:true}).click();
  await visible().contentFrame().getByRole('button',{name:'clicked',exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh preview',exact:true}).click();
  await visible().contentFrame().getByRole('heading',{name:'Resumed',exact:true}).waitFor();
  await page.getByRole('button',{name:'Preview page',exact:true}).click();
  await page.getByRole('menuitem',{name:'other.html',exact:true}).click();
  await visible().contentFrame().getByRole('heading',{name:'Other page',exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh preview',exact:true}).click();
  await visible().contentFrame().getByRole('heading',{name:'Other page',exact:true}).waitFor();
  await page.getByRole('button',{name:'Preview page',exact:true}).click();
  await page.getByRole('menuitem',{name:/^index\.html/}).click();
  await visible().contentFrame().getByRole('heading',{name:'Resumed',exact:true}).waitFor();
  // Offline editing exercises the installed build and its cached lazy runtime.
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  if (!await page.evaluate(()=>Boolean(navigator.serviceWorker.controller))) {
    await page.reload(); await visible().contentFrame().getByRole('heading',{name:'Resumed',exact:true}).waitFor();
    await page.getByRole('tab',{name:'Content',exact:true}).click();
  }
  await context.setOffline(true);
  await page.locator('#setting-title').fill('Offline');
  await visible().contentFrame().getByRole('heading',{name:'Offline',exact:true}).waitFor();
  await visible().contentFrame().getByText('module:fetched',{exact:true}).waitFor();
  await page.getByRole('button',{name:'index.tpl',exact:true}).first().click();
  await page.locator('.monaco-editor textarea').first().waitFor();
  await page.evaluate(()=>{window.beforeInvalid=document.querySelector('iframe.is-visible');});
  await page.locator('.view-lines').click({position:{x:80,y:10}});
  await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');
  await page.keyboard.insertText(source.replace('@endlayout',''));
  await page.getByRole('alert').filter({hasText:'Preview could not update. Showing the last working version.'}).waitFor();
  assert.equal(await page.evaluate(()=>document.querySelector('iframe.is-visible')===window.beforeInvalid),true,'invalid source retains the working document');
  await visible().contentFrame().getByRole('heading',{name:'Offline',exact:true}).waitFor();
  await page.locator('.view-lines').click({position:{x:80,y:10}});
  await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');
  await page.keyboard.insertText(source.replace('<h1>{{title}}</h1>','<h1>{{title}}</h1><p>Edited source</p>'));
  await visible().contentFrame().getByText('Edited source',{exact:true}).waitFor();
  await visible().contentFrame().getByText('module:fetched',{exact:true}).waitFor();
  await page.screenshot({path:'/tmp/studio-interactive-preview.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: installed Studio actual ZIP import, JS/modules/relative fetch, parameter and Monaco source live updates, no blank animation frames, invalid source retains working document, pause/manual refresh/resume, multipage navigation, offline preview.');
} catch(error) {
  console.error(JSON.stringify({errors},null,2));
  console.error((await page?.locator('body').innerText().catch(()=>''))?.slice(-6000));
  await page?.screenshot({path:'/tmp/studio-interactive-editor-failure.png',fullPage:true}).catch(()=>{});throw error;
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
