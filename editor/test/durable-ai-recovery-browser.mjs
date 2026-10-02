import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { openThread, studioChat } from './support/studio-chat.js';

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
const tool=(name,input)=>new Response('data: '+JSON.stringify({id:'gen-free-recovery',model:'test/recovery',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(input)}}]},finish_reason:'tool_calls'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
window.fetch=async(url,options={})=>{if(!String(url).startsWith('https://openrouter.ai/'))return actualFetch(url,options);if(!String(url).endsWith('/chat/completions'))throw new Error('Image HTTP blocked');const body=JSON.parse(options.body),names=body.tools.map(t=>t.function.name);state.calls.push({model:body.model,hasBriefTail:JSON.stringify(body.messages).includes('FULL_BRIEF_END_MARKER'),hasClarification:JSON.stringify(body.messages).includes('RETAINED_USER_CLARIFICATION')});if(names.includes('select_intent')){const call={id:'route',type:'function',function:{name:'select_intent',arguments:JSON.stringify({intent:'content'})}};return Response.json({id:'gen-free-route',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[call]},finish_reason:'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});}if(names.includes('submit_plan'))return tool('submit_plan',{summary:'Update headline and preserve source and photo.',tasks:['Update title']});if(names.includes('submit_review'))return tool('submit_review',{approved:true,summary:'Complete headline.',issues:[]});if(state.writer++===0)return tool('set_values',{values:{title:'Generated after quota'}});if(state.pauseAfterWrite){state.writerPaused=true;return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled synthetic continuation','AbortError')),{once:true});});}return tool('validate_draft',{});};
// Test seam: a legacy recovery record written before the conversation runtime first opens the project (#seed-ready, #seed-stale, #seed-long).
const seedKind=location.hash.slice(1);
if (seedKind && !(await getAiRecovery(projectId))) { if (seedKind==='seed-ready') await state.seed(true); else if (seedKind==='seed-stale') { await state.seed(false); await state.makeStale(); } else if (seedKind==='seed-long') await state.seedLong(); }
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({ stdin:{ contents:entry, resolveDir:repository, sourcefile:'retained-draft-settings-entry.jsx', loader:'jsx' }, bundle:true, write:false, platform:'browser', format:'esm', target:'chrome120', jsx:'automatic', loader:{ '.css':'empty' }, // styles come from the production CSS
  define:{ 'process.env.NODE_ENV':'"production"' },
  plugins:[{ name:'retention-test-seams', setup(build) {
    build.onLoad({ filter:/\/editor\/src\/pwa\.js$/ },()=>({ loader:'js', contents:`const state={ offlineReady:true, error:null, update:async()=>{ window.recoveryTest.updateCalls=(window.recoveryTest.updateCalls||0)+1; } }; export const getPwaState=()=>state; export const subscribePwa=listener=>{ listener(state); return ()=>{}; };` }));
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
  const origin=`http://127.0.0.1:${server.address().port}`, blocked=[], errors=[];
  const waitDatabase=async predicate=>{const deadline=Date.now()+10000;while(!(await page.evaluate(predicate))){if(Date.now()>deadline)throw new Error('Timed out waiting for durable database state');await page.waitForTimeout(25);}};
  const saved=()=>page.evaluate(()=>window.recoveryTest.readSaved());
  const calls=()=>page.evaluate(()=>window.recoveryTest.calls.length);
  let chat;
  // Each scenario opens a fresh browser profile: the legacy recovery record migrates into a conversation run once,
  // when the conversation runtime first opens the project (conversation-runtime.js migrateLegacy).
  const openFresh=async seed=>{
    if (page) await page.context().close();
    const context=await browser.newContext({ viewport:{ width:1280,height:1100 } });
    await context.route('**/*',route=>{ if (route.request().url().startsWith(origin+'/')) return route.continue(); blocked.push(route.request().url().split('?')[0]); return route.abort(); });
    page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+(seed?'#'+seed:'')); await page.waitForFunction(()=>window.recoveryTest);
    await page.getByRole('tab',{name:'Conversations',exact:true}).click();
    chat=studioChat(page); await chat.composer.waitFor();
  };
  const reopen=async()=>{await page.reload(); await page.waitForFunction(()=>window.recoveryTest); await page.getByRole('tab',{name:'Conversations',exact:true}).click(); await chat.composer.waitFor();};

  // A completed legacy draft becomes a recovered conversation run; it is separate from committed values and never restarts generation.
  await openFresh('seed-ready'); await openThread(chat,'Original creation brief');
  const recovered=chat.assistant.last(); await recovered.waitFor();
  // A valid recovered draft is offered as ready changes (Apply, Preview, Discard), with the recovery note as its status message.
  assert.equal(await recovered.getAttribute('data-run-status'),'ready');
  await chat.user.getByText('Complete original brief',{exact:true}).waitFor();
  await chat.cards('values').getByText('Recovered completed title',{exact:false}).waitFor();
  await chat.cards('diff').filter({hasText:'index.tpl'}).getByText('Retained complete photo',{exact:false}).first().waitFor();
  assert.equal((await saved()).settings.title,'Original saved title','restored draft is separate from committed values');
  await page.getByRole('tab',{name:'Content',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:/Page title/}).inputValue(),'Original saved title');
  await page.getByRole('tab',{name:'Conversations',exact:true}).click();
  assert.equal(await calls(),0,'restoring ready draft must not restart generation');
  await reopen(); await openThread(chat,'Original creation brief'); await chat.assistant.last().waitFor();
  assert.equal(await calls(),0,'reload must not restart generation');
  // A valid recovered draft is applicable (the former panel offered "Apply to project" for valid interrupted runs).
  await page.evaluate(()=>window.recoveryTest.quotaProject=true);
  await chat.apply.click();
  await page.getByText('Browser storage is full.',{exact:false}).first().waitFor();
  assert.equal((await saved()).settings.title,'Original saved title','failed project write keeps the draft');
  await page.evaluate(()=>window.recoveryTest.quotaProject=false);
  await chat.apply.click();
  await waitDatabase(async()=>(await window.recoveryTest.readSaved()).settings.title==='Recovered completed title');
  await chat.status('applied').waitFor();
  const savedFiles=(await saved()).files;
  assert.match(savedFiles['index.tpl'],/Retained complete photo/);
  assert.deepEqual(Object.values(savedFiles['images/photo.png']),Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=','base64')),'binary files survive recovery');

  // A newer committed project cannot be overlaid by an older recovery snapshot.
  await openFresh('seed-stale'); await openThread(chat,'Original creation brief');
  const stale=chat.assistant.last(); await stale.waitFor();
  // The run explains why it cannot be applied (the former panel showed run.error for every state).
  await stale.getByText('This recovered draft belongs to an older project revision.',{exact:false}).first().waitFor();
  assert.equal(await stale.getAttribute('data-run-status'),'interrupted');
  assert.equal(await chat.apply.count(),0,'a stale recovered draft is not applicable');
  assert.equal((await saved()).settings.title,'Newer saved title');
  await page.getByRole('tab',{name:'Content',exact:true}).click(); assert.equal(await page.getByRole('textbox',{name:/Page title/}).inputValue(),'Newer saved title');
  await page.getByRole('tab',{name:'Conversations',exact:true}).click();
  assert.equal(await calls(),0);

  // Continuation keeps the whole 6000-character brief and the restored clarification; Stop retains completed work.
  await openFresh('seed-long'); await openThread(chat,'Original creation brief');
  await chat.assistant.last().waitFor();
  await page.evaluate(()=>{window.recoveryTest.pauseAfterWrite=true;window.recoveryTest.writer=0;});
  await chat.continueRun.last().click();
  await page.waitForFunction(()=>window.recoveryTest.writerPaused);
  assert.equal(await page.evaluate(()=>window.recoveryTest.calls[0].hasBriefTail),true,'continuation preserves the entire 6000-character original brief');
  assert.equal(await page.evaluate(()=>window.recoveryTest.calls.some(call=>call.hasClarification)),true,'restored user instructions reach continuation tools');
  const working=chat.status('running').last(); await working.waitFor();
  // A clarification sent while the assistant works joins the running run (the former panel accepted messages during a run).
  if (!process.env.T7_SKIP_CLARIFY) {
    await chat.prompt.fill('Keep the requested button label in Polish.');
    await chat.send.click();
    await chat.user.getByText('Keep the requested button label in Polish.',{exact:true}).waitFor();
  } // T7_SKIP
  await working.getByRole('button',{name:'Stop',exact:true}).click();
  const stopped=chat.status('cancelled').last(); await stopped.waitFor();
  await stopped.locator('[data-testid="studio-chat-continue"]').waitFor();
  await chat.cards('values').last().getByText('Generated after quota',{exact:false}).waitFor();
  assert.equal((await saved()).settings.title,'Original saved title','stopping never applies');

  // A fresh run stopped after a completed write retains its checkpoint.
  await openFresh('');
  // The editor opens on the latest conversation (the migrated one); this run starts a new conversation.
  if (await chat.threads.isVisible()) await chat.threads.getByRole('button',{name:'New conversation',exact:true}).click();
  else { const header=chat.root.locator('.studio-chat-header'); await header.getByRole('button',{name:'Conversations',exact:true}).click(); await header.getByRole('menuitem',{name:'New conversation',exact:true}).click(); }
  await chat.root.locator('.studio-chat-header').getByRole('heading',{name:'New conversation',exact:true}).waitFor();
  await page.evaluate(()=>{window.recoveryTest.pauseAfterWrite=true;window.recoveryTest.writer=0;});
  await chat.scope.getByRole('button',{name:'Content only',exact:true}).click();
  await chat.prompt.fill('Update the title, then allow cancellation.');
  await chat.send.click();
  await page.waitForFunction(()=>window.recoveryTest.writerPaused);
  await chat.status('running').last().getByRole('button',{name:'Stop',exact:true}).click();
  const cancelled=chat.status('cancelled').last(); await cancelled.waitFor();
  await cancelled.locator('[data-testid="studio-chat-continue"]').waitFor();
  await chat.cards('values').last().getByText('Generated after quota',{exact:false}).waitFor();
  await reopen(); await openThread(chat,'Update the title, then allow cancellation.'); await chat.status('cancelled').last().waitFor();
  await chat.cards('values').last().getByText('Generated after quota',{exact:false}).waitFor();
  assert.equal((await saved()).settings.title,'Original saved title');
  assert.deepEqual(blocked,[]); assert.deepEqual(errors,[]);
  await writeFile('/tmp/studio-durable-ai-recovery-browser-report.json',JSON.stringify({passed:true,paidRequests:0,checks:['legacy ready draft migrates to a recovered conversation run','reload does not restart','project quota keeps the draft; apply saves values and binary','stale revision not overlaid','no automatic provider runs','fresh stop retains complete checkpoints','continuation stop retains newly completed work','6000-character original brief preserved','restored and newly submitted user clarifications reach the run'],blockedExternalRequests:blocked,pageErrors:errors},null,2));
  console.log('PASS: legacy recovery migrates into conversation runs, quota keeps the draft, stale-revision protection, stop retains checkpoints, full brief reaches continuation; no paid requests.');
} catch (error) {
  if (page) { await page.screenshot({ path:'/tmp/studio-durable-ai-recovery-failure.png',fullPage:true }); console.error((await page.locator('body').innerText()).slice(-5000)); }
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
