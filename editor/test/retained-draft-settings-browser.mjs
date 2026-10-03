import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { studioChat, moreMenuItem } from './support/studio-chat.js';

const repository = resolve(process.argv[2] || '.'), require = createRequire(resolve(repository, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const productionDist=resolve(repository,'editor/dist'), productionIndex=await readFile(resolve(productionDist,'index.html'),'utf8');
const cssPath=productionIndex.match(/href="(\/assets\/[^" ]+\.css)"/)?.[1];
if (!cssPath) throw new Error('Build editor/dist before running the retained-draft browser regression.');
const sourceStyles=await readFile(resolve(repository,'packages/template-editor-shell/src/shell.css'),'utf8');

// Exercise the actual folder-first App, assistant, settings port, project folder and SDK
// workflow. Only PWA update activation and source-editor rendering are replaced:
// this is a state/retention regression, not a service-worker or Monaco test.
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './editor/src/App.jsx';
import { starterProject } from './editor/src/starter.js';
import { createProjectInRoot, readProjectSnapshot } from './editor/src/storage/project-root.js';
import { rememberRecent } from './editor/src/storage/recent.js';
import { LAST_PROJECT_KEY } from './editor/src/storage/flows.js';
import { saveOpenRouterSettings } from './editor/src/openrouter-settings.js';
Object.defineProperty(navigator, 'standalone', { configurable:true, value:true });
// The project is a real folder (an OPFS directory standing in for a picked one), registered in recent and reopened on
// boot as the last project: the folder-first App opens it without a prompt.
const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('picker', { create:true })).getDirectoryHandle('retained-draft', { create:true });
const meta = await createProjectInRoot(folder, { kind:'landing', name:'Retained draft settings QA', files:starterProject(true), values:{ title:'Original saved title' } });
await rememberRecent({ projectId:meta.projectId, name:meta.name, kind:meta.kind, handle:folder });
localStorage.setItem(LAST_PROJECT_KEY, meta.projectId);
const original = { id:meta.projectId };
await saveOpenRouterSettings({ apiKey:'mock-retained-draft-no-paid-requests', model:'test/first', imageModel:'' });
const state = window.retainedDraftTest = { calls:[], images:0, pause:true, updateCalls:0, original, readSaved:()=>readProjectSnapshot(folder).then(({ files, values })=>({ files, settings:values })) };
const writerSteps = new Map();
const actualFetch = window.fetch.bind(window);
const tool = (model, name, input) => new Response('data: '+JSON.stringify({ id:'gen-offline-retention', model, choices:[{ index:0, delta:{ role:'assistant', tool_calls:[{ index:0, id:name+crypto.randomUUID(), type:'function', function:{ name, arguments:JSON.stringify(input) } }] }, finish_reason:'tool_calls' }] })+'\\n\\ndata: [DONE]\\n\\n', { headers:{ 'Content-Type':'text/event-stream' } });
window.fetch = async (url, options={}) => {
  if (!String(url).startsWith('https://openrouter.ai/')) return actualFetch(url,options);
  if (!String(url).endsWith('/chat/completions')) { state.images++; throw new Error('Unexpected provider endpoint is blocked.'); }
  const body = JSON.parse(options.body), names = body.tools.map(item=>item.function.name);
  state.calls.push({ model:body.model, tools:names, hasRetainedTitle:JSON.stringify(body.messages).includes('Retained completed title') });
  if (state.pause) { state.pause=false; await new Promise(resolve=>{ state.release=resolve; }); }
  if (names.includes('submit_plan')) return tool(body.model,'submit_plan',{ summary:'Update the saved headline, validate and review.', tasks:['Update the headline'] });
  if (names.includes('submit_review')) return tool(body.model,'submit_review',{ approved:true, summary:'The actual headline matches the request.', issues:[] });
  const step=writerSteps.get(body.model)||0; writerSteps.set(body.model,step+1);
  if (body.model==='test/first') {
    if (!step) return tool(body.model,'set_values',{ values:{ title:'Retained completed title' } });
    return Response.json({ error:{ code:400, message:'Synthetic provider does not support this continuation.' } },{ status:400 });
  }
  return !step ? tool(body.model,'set_values',{ values:{ title:'Completed with replacement model' } }) : tool(body.model,'validate_draft',{});
};
createRoot(document.getElementById('root')).render(<App />);
`;
const bundle = await build({ stdin:{ contents:entry, resolveDir:repository, sourcefile:'retained-draft-settings-entry.jsx', loader:'jsx' }, bundle:true, write:false, platform:'browser', format:'esm', target:'chrome120', jsx:'automatic', loader:{ '.css':'empty' }, // styles come from the production CSS
  define:{ 'process.env.NODE_ENV':'"production"' },
  plugins:[{ name:'retention-test-seams', setup(build) {
    build.onLoad({ filter:/\/editor\/src\/pwa\.js$/ },()=>({ loader:'js', contents:`const state={ offlineReady:true, error:null, update:async()=>{ window.retainedDraftTest.updateCalls++; } }; export const getPwaState=()=>state; export const subscribePwa=listener=>{ listener(state); return ()=>{}; };` }));
    build.onLoad({ filter:/\/template-editor-shell\/src\/CodeEditor\.jsx$/ },()=>({ loader:'jsx', contents:`export default function CodeEditor({value}) { return <pre>{value}</pre>; }` }));
  } }] });
const script = bundle.outputFiles[0].contents;
const server = createServer(async (request,response)=>{
  if (request.url==='/check.js') { response.writeHead(200,{ 'Content-Type':'text/javascript' }); response.end(script); }
  else if (request.url==='/') { response.writeHead(200,{ 'Content-Type':'text/html' }); response.end(`<!doctype html><html data-theme="studio-dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssPath}"><style>${sourceStyles}</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>`); }
  else if (request.url?.startsWith('/assets/')) {
    try { const file=resolve(productionDist,'.'+request.url); if (!file.startsWith(productionDist+'/assets/')) throw new Error('Invalid asset path'); response.writeHead(200,{ 'Content-Type':extname(file)==='.css'?'text/css':extname(file)==='.woff2'?'font/woff2':'application/octet-stream' }); response.end(await readFile(file)); }
    catch { response.writeHead(404); response.end('Not found'); }
  }
  else { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
let browser, page;
try {
  browser=await chromium.launch({ headless:true, ...(process.platform==='darwin'?{ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }:{} ) });
  const context=await browser.newContext({ viewport:{ width:1280,height:1100 } }), origin=`http://127.0.0.1:${server.address().port}`, blocked=[], errors=[], viewports=[];
  await context.route('**/*',route=>{ if (route.request().url().startsWith(origin+'/')) return route.continue(); blocked.push(route.request().url().split('?')[0]); return route.abort(); });
  page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);
  // Conversation runs are durable and do not lock the App (Library, OpenRouter, Update Studio): those locks applied only
  // to the former single-draft assistant of hosts without conversations. This regression keeps the retention contract.
  await page.getByRole('tab',{ name:'Conversations',exact:true }).click();
  const chat=studioChat(page); await chat.composer.waitFor();
  await chat.chooseScope('Content only');
  await chat.prompt.fill('Update the title while preserving the rest.');
  await chat.send.click();
  await page.waitForFunction(()=>typeof window.retainedDraftTest.release==='function');
  await chat.status('running').waitFor();
  await page.evaluate(()=>window.retainedDraftTest.release());
  const failed=chat.status('failed'); await failed.waitFor({ timeout:30000 });
  await failed.getByText('Synthetic provider does not support this continuation.',{ exact:false }).first().waitFor();
  const cdp=await context.newCDPSession(page);
  for (const [width,height,coarse] of [[1280,1100,false],[390,844,true]]) {
    // pointer: coarse (touch) needs 44 px targets, a fine pointer 32 px (design guidelines, Button).
    await cdp.send('Emulation.setTouchEmulationEnabled',{ enabled:coarse, maxTouchPoints:coarse?5:1 });
    await page.setViewportSize({width,height});
    await page.waitForFunction(coarse=>matchMedia('(pointer: coarse)').matches===coarse,coarse);
    await failed.scrollIntoViewIfNeeded();
    const box=await failed.boundingBox();
    assert.ok(box.x>=-1 && box.x+box.width<=width+1,'run message stays within the viewport');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'actual App CSS does not overflow horizontally');
    for (const button of [failed.locator('[data-testid="studio-chat-continue"]'),failed.locator('[data-testid="studio-chat-keep-draft"]')])
      assert.ok((await button.boundingBox()).height>=(coarse?44:32),'draft actions remain usable targets');
    const screenshot=`/tmp/studio-retained-draft-summary-${width}.png`; await page.screenshot({path:screenshot}); viewports.push({width,height,screenshot});
  }
  await cdp.send('Emulation.setTouchEmulationEnabled',{ enabled:false });
  await page.setViewportSize({width:1280,height:1100});
  const savedBefore=await page.evaluate(()=>window.retainedDraftTest.readSaved());
  assert.equal(savedBefore.settings.title,'Original saved title','failed draft must not be silently committed');
  { const item=await moreMenuItem(page,'Settings'); assert.equal(await item.isEnabled(),true); await page.keyboard.press('Escape'); }
  const beforeSettings=await page.evaluate(()=>window.retainedDraftTest.calls.length);
  await chat.root.locator('.studio-chat-header').getByRole('button',{ name:'More actions',exact:true }).click();
  await chat.root.getByRole('menuitem',{ name:'AI settings',exact:true }).click();
  await page.getByRole('button',{ name:'Enter model ID',exact:true }).first().click();
  await page.getByLabel('Text model',{ exact:true }).fill('test/replacement');
  await page.getByRole('button',{ name:'Save connection',exact:true }).click();
  await page.getByText('Connection saved on this device.',{ exact:true }).waitFor();
  await page.getByRole('button',{ name:'Back to project',exact:true }).click();
  await failed.locator('[data-testid="studio-chat-continue"]').waitFor();
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.calls.length),beforeSettings,'saving a replacement model cannot automatically restart paid generation');
  await page.getByRole('tab',{ name:'Content',exact:true }).click();
  assert.equal(await page.getByRole('textbox',{ name:/Page title/ }).inputValue(),'Original saved title','the retained draft stays in the conversation until explicitly kept or applied');
  await page.getByRole('tab',{ name:'Conversations',exact:true }).click();
  const callsBefore=await page.evaluate(()=>window.retainedDraftTest.calls.length);
  await failed.locator('[data-testid="studio-chat-continue"]').click();
  await chat.apply.waitFor({ timeout:30000 });
  const continuation=await page.evaluate(index=>window.retainedDraftTest.calls.slice(index),callsBefore);
  // One agent loop (no mandatory plan/review stages): set_values, then validate_draft.
  assert.ok(continuation.length>=2);
  assert.ok(continuation.every(call=>call.model==='test/replacement'),'explicit continuation uses the saved replacement model');
  assert.equal(continuation[0].hasRetainedTitle,true,'continuation starts from retained content');
  await (await moreMenuItem(page,'Settings')).click();
  const dialog=page.locator('.global-settings');
  await dialog.getByRole('button',{ name:'Enter model ID',exact:true }).first().click();
  await dialog.getByLabel('Text model',{ exact:true }).waitFor();
  const beforeApprovedSettings=await page.evaluate(()=>window.retainedDraftTest.calls.length);
  await dialog.getByLabel('Text model',{ exact:true }).fill('test/approved-replacement');
  await dialog.getByRole('button',{ name:'Save connection',exact:true }).click();
  await dialog.getByText('Connection saved on this device.',{ exact:true }).waitFor();
  await dialog.getByRole('button',{ name:'Back to project',exact:true }).click();
  await chat.apply.waitFor();
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.calls.length),beforeApprovedSettings,'an approved draft stays ready without another provider call after saving settings');
  const savedAfter=await page.evaluate(()=>window.retainedDraftTest.readSaved());
  assert.deepEqual(savedAfter.files,savedBefore.files);
  assert.deepEqual(savedAfter.settings,savedBefore.settings,'neither settings path implicitly applies the draft');
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.updateCalls),0);
  await chat.status('ready').getByRole('button',{ name:'Discard',exact:true }).click();
  await chat.status('discarded').waitFor();
  await page.getByRole('button',{ name:'Update Studio',exact:true }).last().click();
  await page.waitForFunction(()=>window.retainedDraftTest.updateCalls===1);
  assert.deepEqual(blocked,[]); assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.images),0);
  const report={ passed:true, kind:'isolated actual App/assistant + synthetic SDK provider retention regression', paidRequests:0, blockedExternalRequests:blocked, pageErrors:errors, continuationModels:continuation.map(call=>call.model), viewports };
  await writeFile('/tmp/studio-retained-draft-settings-browser-report.json',JSON.stringify(report,null,2));
  console.log('PASS: failed/approved conversation draft with idle settings, saved model used on explicit Continue, retained values continue, touch targets, no implicit Apply and no paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path:'/tmp/studio-retained-draft-settings-failure.png',fullPage:true }); console.error((await page.locator('body').innerText()).slice(-5000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
