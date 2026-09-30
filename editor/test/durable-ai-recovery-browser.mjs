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
import { createStudioProject, saveStudioProject, setActiveStudioProjectId, getActiveStudioProjectId, getStudioProject } from './editor/src/studio-library.js';
import { getAiRecovery, saveAiRecovery } from './editor/src/studio-ai-recovery.js';
import { saveOpenRouterSettings } from './editor/src/openrouter-settings.js';
Object.defineProperty(navigator, 'standalone', { configurable:true, value:true });
const source='@template "Recovery"\\n@section content "Content"\\n@param title String = "Original" label="Page title"\\n@endsection\\n@layout\\n<!doctype html><html><body><h1>{{title}}</h1><img src="images/photo.png" alt="Completed photo"></body></html>\\n@endlayout';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
let projectId=await getActiveStudioProjectId();
if (!projectId) {
 const original=await saveStudioProject(createStudioProject({kind:'landing',name:'Durable recovery QA',files:{'index.tpl':source,'images/photo.png':png},settings:{title:'Original saved title'},aiPrompt:'Original creation brief'}),{expectedRevision:null});
 projectId=original.id; await setActiveStudioProjectId(projectId);
 await saveOpenRouterSettings({apiKey:'mock-no-paid-recovery',model:'test/recovery',imageModel:''});
}
const state=window.recoveryTest={ calls:[], quotaRecovery:false, quotaProject:false, writer:0, projectId,
 readSaved:()=>getStudioProject(projectId), readRecovery:()=>getAiRecovery(projectId),
 seed:async(valid=true)=>{const current=await getStudioProject(projectId); return saveAiRecovery({projectId,token:'seeded-run',baseRevision:current.revision,kind:'content',prompt:'Complete original brief',files:{...current.files,'index.tpl':source.replace('Completed photo','Retained complete photo')},values:{title:'Recovered completed title'},valid,steps:52,attachments:[],summary:'Ready draft with a complete photo.'});},
 seedLong:async()=>{await state.seed(false);const current=await getAiRecovery(projectId),marker='FULL_BRIEF_END_MARKER';await saveAiRecovery({...current,prompt:'x'.repeat(6000-marker.length)+marker,clarifications:['RETAINED_USER_CLARIFICATION Preserve the completed source and photo.']});},
 makeStale:async()=>{const current=await getStudioProject(projectId);return saveStudioProject({...current,settings:{title:'Newer saved title'}},{expectedRevision:current.revision});}
};
const realPut=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(...args){if ((state.quotaRecovery&&this.transaction.db.name==='trafficops-studio-ai-recovery')||(state.quotaProject&&this.transaction.db.name==='trafficops-studio-library'))throw new DOMException('Synthetic full storage','QuotaExceededError');return realPut.apply(this,args);};
const actualFetch=window.fetch.bind(window);
const tool=(name,input)=>new Response('data: '+JSON.stringify({id:'gen-free-recovery',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(input)}}]},finish_reason:'tool_calls'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
window.fetch=async(url,options={})=>{if(!String(url).startsWith('https://openrouter.ai/'))return actualFetch(url,options);if(!String(url).endsWith('/chat/completions'))throw new Error('Image HTTP blocked');const body=JSON.parse(options.body),names=body.tools.map(t=>t.function.name);state.calls.push({model:body.model,hasBriefTail:JSON.stringify(body.messages).includes('FULL_BRIEF_END_MARKER'),hasClarification:JSON.stringify(body.messages).includes('RETAINED_USER_CLARIFICATION')});if(names.includes('submit_plan'))return tool('submit_plan',{summary:'Update headline and preserve source and photo.',tasks:['Update title']});if(names.includes('submit_review'))return tool('submit_review',{approved:true,summary:'Complete headline.',issues:[]});if(state.writer++===0)return tool('set_values',{values:{title:'Generated after quota'}});if(state.pauseAfterWrite){state.writerPaused=true;return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled synthetic continuation','AbortError')),{once:true});});}return tool('validate_draft',{});};
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({ stdin:{ contents:entry, resolveDir:repository, sourcefile:'retained-draft-settings-entry.jsx', loader:'jsx' }, bundle:true, write:false, platform:'browser', format:'esm', target:'chrome120', jsx:'automatic', define:{ 'process.env.NODE_ENV':'"production"' },
  plugins:[{ name:'retention-test-seams', setup(build) {
    build.onLoad({ filter:/\/editor\/src\/pwa\.js$/ },()=>({ loader:'js', contents:`const state={ offlineReady:true, error:null, update:async()=>{ window.recoveryTest.updateCalls=(window.recoveryTest.updateCalls||0)+1; } }; export const getPwaState=()=>state; export const subscribePwa=listener=>{ listener(state); return ()=>{}; };` }));
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
  const openAssistant=async()=>{await page.getByRole('tab',{name:'AI assistant',exact:true}).click(); await page.waitForFunction(()=>window.recoveryTest);};
  const waitDatabase=async predicate=>{const deadline=Date.now()+10000;while(!(await page.evaluate(predicate))){if(Date.now()>deadline)throw new Error('Timed out waiting for durable database state');await page.waitForTimeout(25);}};
  const saved=()=>page.evaluate(()=>window.recoveryTest.readSaved());
  const pending=()=>page.evaluate(()=>window.recoveryTest.readRecovery());
  const zipDownload=async(button)=>{const event=page.waitForEvent('download');await button.click();const download=await event;const path=await download.path();return (await import('@trafficops/template-editor-core')).readZipProject(new Uint8Array(await readFile(path)));};
  await page.goto(origin); await openAssistant();
  await page.evaluate(()=>window.recoveryTest.seed(true)); await page.reload(); await openAssistant();
  await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
  assert.equal((await saved()).settings.title,'Original saved title','restored draft is separate from committed values');
  assert.equal((await pending()).valid,true); assert.equal((await pending()).steps,52);
  assert.deepEqual(Object.values((await pending()).files['images/photo.png']),Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=','base64')));
  await page.getByRole('tab',{name:'Content',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:/Page title/}).inputValue(),'Recovered completed title');
  await page.getByRole('tab',{name:'AI assistant',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.recoveryTest.calls.length),0,'restoring ready draft must not restart generation');
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  assert.ok(await pending(),'Apply itself must not clear recovery before the deferred project save');
  await page.reload(); await openAssistant(); await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
  assert.equal((await saved()).settings.title,'Original saved title','reload before autosave restores pending draft');
  await page.evaluate(()=>window.recoveryTest.quotaProject=true);
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await page.getByText('Browser storage is full.',{exact:false}).first().waitFor();
  assert.ok(await pending(),'failed project write cannot clear recovery');
  assert.equal((await saved()).settings.title,'Original saved title');
  await page.reload(); await openAssistant(); await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await waitDatabase(async()=>!(await window.recoveryTest.readRecovery())&&(await window.recoveryTest.readSaved()).settings.title==='Recovered completed title');
  await page.reload(); await openAssistant(); assert.equal(await pending(),null); assert.equal((await saved()).settings.title,'Recovered completed title');
  // Quota while storing a new completed draft remains visible and allows a
  // complete source/value download directly from memory.
  await page.evaluate(()=>window.recoveryTest.quotaRecovery=true);
  await page.getByRole('button',{name:'Fill content',exact:true}).click();
  await page.locator('.ai-prompt textarea').fill('Update the title and preserve the photo.');
  await page.getByRole('button',{name:'Generate changes',exact:true}).click();
  await page.getByRole('button',{name:'Apply changes',exact:true}).waitFor();
  await page.getByText('The AI draft could not be saved for recovery.',{exact:false}).waitFor();
  assert.equal(await pending(),null); assert.equal((await saved()).settings.title,'Recovered completed title');
  const quotaZip=await zipDownload(page.getByRole('button',{name:'Download draft source ZIP',exact:true}));
  assert.equal(quotaZip.settings.title,'Generated after quota'); assert.ok(quotaZip.files['images/photo.png'] instanceof Uint8Array); assert.match(quotaZip.files['index.tpl'],/@layout/);
  await page.evaluate(()=>window.recoveryTest.quotaRecovery=false); await page.getByRole('button',{name:'Discard',exact:true}).click();
  // A newer committed project cannot be overlaid by an older recovery snapshot.
  await page.evaluate(async()=>{await window.recoveryTest.seed(false);await window.recoveryTest.makeStale();});
  await page.reload(); await openAssistant();
  await page.getByText('A saved AI draft belongs to an older project revision.',{exact:false}).waitFor();
  assert.equal((await saved()).settings.title,'Newer saved title'); assert.ok(await pending());
  assert.equal(await page.getByRole('button',{name:'Generate changes',exact:true}).isDisabled(),true);
  await page.getByRole('tab',{name:'Content',exact:true}).click(); assert.equal(await page.getByRole('textbox',{name:/Page title/}).inputValue(),'Newer saved title');
  await page.getByRole('tab',{name:'AI assistant',exact:true}).click();
  const staleZip=await zipDownload(page.getByRole('button',{name:'Download recovered source ZIP',exact:true}));
  assert.equal(staleZip.settings.title,'Recovered completed title'); assert.match(staleZip.files['index.tpl'],/Retained complete photo/);
  assert.ok(await pending(),'download alone does not delete stale work'); assert.equal(await page.evaluate(()=>window.recoveryTest.calls.length),0);
  await page.getByRole('button',{name:'Discard recovered draft',exact:true}).click(); await waitDatabase(async()=>!(await window.recoveryTest.readRecovery()));
  assert.equal((await saved()).settings.title,'Newer saved title');
  // Cancel stops further provider work and retains complete accepted operations
  // in both fresh and continued runs. Only Discard removes the saved draft.
  await page.evaluate(()=>{window.recoveryTest.pauseAfterWrite=true;window.recoveryTest.writer=0;});
  await page.getByRole('button',{name:'Fill content',exact:true}).click();
  await page.locator('.ai-prompt textarea').fill('Update the title, then allow cancellation.');
  await page.getByRole('button',{name:'Generate changes',exact:true}).click();
  await waitDatabase(async()=>window.recoveryTest.writerPaused&&(await window.recoveryTest.readRecovery())?.values.title==='Generated after quota');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Continue generation',exact:true}).waitFor();
  await waitDatabase(async()=>(await window.recoveryTest.readRecovery())?.values.title==='Generated after quota');
  assert.equal((await pending()).valid,false);
  assert.equal((await saved()).settings.title,'Newer saved title');
  await page.getByRole('button',{name:'Discard',exact:true}).click(); await waitDatabase(async()=>!(await window.recoveryTest.readRecovery()));
  await page.evaluate(()=>window.recoveryTest.seedLong());
  await page.reload(); await openAssistant();
  await page.evaluate(()=>{window.recoveryTest.pauseAfterWrite=true;window.recoveryTest.writer=0;});
  await page.getByRole('button',{name:'Continue generation',exact:true}).click();
  await waitDatabase(async()=>window.recoveryTest.writerPaused&&(await window.recoveryTest.readRecovery())?.values.title==='Generated after quota');
  assert.equal(await page.evaluate(()=>window.recoveryTest.calls[0].hasBriefTail),true,'continuation preserves the entire6000character original brief');
  assert.equal(await page.evaluate(()=>window.recoveryTest.calls[1].hasClarification),true,'restored user instructions reach continuation tools');
  await page.getByRole('textbox',{name:'Clarify while the assistant works',exact:true}).fill('Keep the requested button label in Polish.');
  await page.getByRole('button',{name:'Send clarification',exact:true}).click();
  await waitDatabase(async()=>(await window.recoveryTest.readRecovery())?.clarifications.length===2);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Continue generation',exact:true}).waitFor();
  await waitDatabase(async()=>(await window.recoveryTest.readRecovery())?.values.title==='Generated after quota');
  assert.equal((await saved()).settings.title,'Newer saved title');
  assert.equal((await pending()).clarifications.length,2,'stopping preserves old and new user clarification context alongside all completed files');
  await page.getByRole('button',{name:'Discard',exact:true}).click(); await waitDatabase(async()=>!(await window.recoveryTest.readRecovery()));
  assert.deepEqual(blocked,[]); assert.deepEqual(errors,[]);
  await writeFile('/tmp/studio-durable-ai-recovery-browser-report.json',JSON.stringify({passed:true,paidRequests:0,checks:['ready restoration with complete binary and values','reload before autosave','project quota retains draft','durable save clears','recovery quota visible + memory source export','stale revision not overlaid + source export','no automatic provider runs','fresh stop retains complete checkpoints','continuation stop retains newly completed work','6000character original brief preserved','restored and newly submitted user clarifications retained'],blockedExternalRequests:blocked,pageErrors:errors},null,2));
  console.log('PASS: durable IndexedDB ready/binary recovery, reload/save race, quota retention and export, stale-revision protection and explicit discard; no paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path:'/tmp/studio-durable-ai-recovery-failure.png',fullPage:true }); console.error((await page.locator('body').innerText()).slice(-5000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
