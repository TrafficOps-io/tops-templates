import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const repository = resolve(process.argv[2] || '.'), require = createRequire(resolve(repository, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const productionDist=resolve(repository,'editor/dist'), productionIndex=await readFile(resolve(productionDist,'index.html'),'utf8');
const cssPath=productionIndex.match(/href="(\/assets\/[^" ]+\.css)"/)?.[1];
if (!cssPath) throw new Error('Build editor/dist before running the retained-draft browser regression.');
const sourceStyles=await readFile(resolve(repository,'packages/template-editor-shell/src/shell.css'),'utf8');

// Exercise the actual App, assistant, settings port, persisted project and SDK
// workflow. Only PWA update activation and source-editor rendering are replaced:
// this is a state/retention regression, not a service-worker or Monaco test.
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './editor/src/App.jsx';
import { starterProject } from './editor/src/starter.js';
import { createStudioProject, saveStudioProject, setActiveStudioProjectId, getStudioProject } from './editor/src/studio-library.js';
import { saveOpenRouterSettings } from './editor/src/openrouter-settings.js';
Object.defineProperty(navigator, 'standalone', { configurable:true, value:true });
const original = await saveStudioProject(createStudioProject({ kind:'landing', name:'Retained draft settings QA', files:starterProject(true), settings:{ title:'Original saved title' } }), { expectedRevision:null });
await setActiveStudioProjectId(original.id);
await saveOpenRouterSettings({ apiKey:'mock-retained-draft-no-paid-requests', model:'test/first', imageModel:'' });
const state = window.retainedDraftTest = { calls:[], images:0, pause:true, updateCalls:0, original, readSaved:()=>getStudioProject(original.id) };
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
const bundle = await build({ stdin:{ contents:entry, resolveDir:repository, sourcefile:'retained-draft-settings-entry.jsx', loader:'jsx' }, bundle:true, write:false, platform:'browser', format:'esm', target:'chrome120', jsx:'automatic', define:{ 'process.env.NODE_ENV':'"production"' },
  plugins:[{ name:'retention-test-seams', setup(build) {
    build.onLoad({ filter:/\/editor\/src\/pwa\.js$/ },()=>({ loader:'js', contents:`const state={ offlineReady:true, error:null, update:async()=>{ window.retainedDraftTest.updateCalls++; } }; export const getPwaState=()=>state; export const subscribePwa=listener=>{ listener(state); return ()=>{}; };` }));
    build.onLoad({ filter:/\/template-editor-shell\/src\/CodeEditor\.jsx$/ },()=>({ loader:'jsx', contents:`export default function CodeEditor({value}) { return <pre>{value}</pre>; }` }));
  } }] });
const script = bundle.outputFiles[0].contents;
const server = createServer(async (request,response)=>{
  if (request.url==='/check.js') { response.writeHead(200,{ 'Content-Type':'text/javascript' }); response.end(script); }
  else if (request.url==='/') { response.writeHead(200,{ 'Content-Type':'text/html' }); response.end(`<!doctype html><html data-theme="trafficops"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssPath}"><style>${sourceStyles}</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>`); }
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
  await page.getByRole('tab',{ name:'AI assistant',exact:true }).click();
  await page.getByRole('button',{ name:'Fill content',exact:true }).click();
  await page.locator('.ai-prompt textarea').fill('Update the title while preserving the rest.');
  await page.getByRole('button',{ name:'Generate changes',exact:true }).click();
  await page.waitForFunction(()=>typeof window.retainedDraftTest.release==='function');
  assert.equal(await page.getByRole('button',{ name:'AI connection settings',exact:true }).isDisabled(),true);
  assert.equal(await page.getByRole('button',{ name:'OpenRouter',exact:true }).last().isDisabled(),true);
  assert.equal(await page.getByRole('button',{ name:'Update Studio',exact:true }).last().isDisabled(),true);
  assert.match(await page.getByRole('button',{ name:'Library',exact:true }).last().getAttribute('title'),/Wait for AI generation/);
  await page.evaluate(()=>window.retainedDraftTest.release());
  await page.getByRole('button',{ name:'Continue generation',exact:true }).waitFor();
  for (const [width,height] of [[1280,1100],[390,844]]) {
    await page.setViewportSize({width,height});
    const summary=page.getByRole('region',{name:'Generation status',exact:true});
    await summary.scrollIntoViewIfNeeded();
    const box=await summary.boundingBox();
    assert.ok(box.x>=-1 && box.x+box.width<=width+1,'generation summary stays within the viewport');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'actual App CSS does not overflow horizontally');
    for (const label of ['Continue generation','Keep draft in editor','Change model','Discard']) {
      const button=summary.getByRole('button',{name:label,exact:true});
      assert.ok((await button.boundingBox()).height>=44,'draft actions remain usable touch targets');
    }
    const screenshot=`/tmp/studio-retained-draft-summary-${width}.png`; await page.screenshot({path:screenshot}); viewports.push({width,height,screenshot});
  }
  await page.setViewportSize({width:1280,height:1100});
  const savedBefore=await page.evaluate(()=>window.retainedDraftTest.readSaved());
  assert.equal(savedBefore.settings.title,'Original saved title','failed draft must not be silently committed');
  assert.equal(await page.getByRole('button',{ name:'AI connection settings',exact:true }).isEnabled(),true);
  assert.equal(await page.getByRole('button',{ name:'OpenRouter',exact:true }).last().isEnabled(),true);
  assert.equal(await page.getByRole('button',{ name:'Library',exact:true }).last().isDisabled(),true);
  assert.match(await page.getByRole('button',{ name:'Library',exact:true }).last().getAttribute('title'),/Review the AI draft/);
  await page.getByText('Resolve the AI draft in AI assistant before updating Studio.',{ exact:false }).last().waitFor();
  const beforeSettings=await page.evaluate(()=>window.retainedDraftTest.calls.length);
  await page.getByRole('button',{ name:'AI connection settings',exact:true }).click();
  await page.getByLabel('Text model',{ exact:true }).fill('test/replacement');
  await page.getByRole('button',{ name:'Save connection',exact:true }).click();
  await page.getByText('Connection saved on this device.',{ exact:true }).waitFor();
  await page.getByRole('button',{ name:'Back to assistant',exact:true }).click();
  await page.getByRole('button',{ name:'Continue generation',exact:true }).waitFor();
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.calls.length),beforeSettings,'saving a replacement model cannot automatically restart paid generation');
  await page.getByRole('tab',{ name:'Content',exact:true }).click();
  assert.equal(await page.getByRole('textbox',{ name:/Page title/ }).inputValue(),'Retained completed title','opening/saving settings retains actual draft values');
  await page.getByRole('tab',{ name:'AI assistant',exact:true }).click();
  const callsBefore=await page.evaluate(()=>window.retainedDraftTest.calls.length);
  await page.getByRole('button',{ name:'Continue generation',exact:true }).click();
  await page.getByRole('button',{ name:'Apply changes',exact:true }).waitFor();
  const continuation=await page.evaluate(index=>window.retainedDraftTest.calls.slice(index),callsBefore);
  assert.ok(continuation.length>=3);
  assert.ok(continuation.every(call=>call.model==='test/replacement'),'explicit continuation uses the saved replacement model');
  assert.equal(continuation[0].hasRetainedTitle,true,'continuation starts from retained content');
  assert.equal(await page.getByRole('button',{ name:'AI connection settings',exact:true }).isEnabled(),true,'approved draft also permits idle settings');
  await page.getByRole('button',{ name:'OpenRouter',exact:true }).last().click();
  const dialog=page.getByRole('dialog',{ name:'OpenRouter settings',exact:true });
  await dialog.getByLabel('Text model',{ exact:true }).waitFor();
  const beforeApprovedSettings=await page.evaluate(()=>window.retainedDraftTest.calls.length);
  await dialog.getByLabel('Text model',{ exact:true }).fill('test/approved-replacement');
  await dialog.getByRole('button',{ name:'Save connection',exact:true }).click();
  await dialog.getByText('Connection saved on this device.',{ exact:true }).waitFor();
  await dialog.getByRole('button',{ name:'Close',exact:true }).click();
  await page.getByRole('button',{ name:'Apply changes',exact:true }).waitFor();
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.calls.length),beforeApprovedSettings,'an approved draft stays ready without another provider call after saving settings');
  assert.equal(await page.getByRole('button',{ name:'Update Studio',exact:true }).last().isDisabled(),true);
  const savedAfter=await page.evaluate(()=>window.retainedDraftTest.readSaved());
  assert.deepEqual(savedAfter.files,savedBefore.files);
  assert.deepEqual(savedAfter.settings,savedBefore.settings,'neither settings path implicitly applies the draft');
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.updateCalls),0);
  await page.getByRole('button',{ name:'Discard',exact:true }).click();
  await page.getByRole('button',{ name:'Update Studio',exact:true }).last().click();
  await page.waitForFunction(()=>window.retainedDraftTest.updateCalls===1);
  assert.deepEqual(blocked,[]); assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>window.retainedDraftTest.images),0);
  const report={ passed:true, kind:'isolated actual App/assistant + synthetic SDK provider retention regression', paidRequests:0, blockedExternalRequests:blocked, pageErrors:errors, continuationModels:continuation.map(call=>call.model), viewports };
  await writeFile('/tmp/studio-retained-draft-settings-browser-report.json',JSON.stringify(report,null,2));
  console.log('PASS: active-run settings locked, failed/approved draft settings enabled, saved model used on explicit Continue, actual retained values preserved, update guidance/lock, no implicit Apply and no paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path:'/tmp/studio-retained-draft-settings-failure.png',fullPage:true }); console.error((await page.locator('body').innerText()).slice(-5000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
