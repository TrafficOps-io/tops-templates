import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createStudioProject } from '../src/studio-library.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist'), out = '/tmp/studio-ai-panel-ui';
await mkdir(out, { recursive:true });
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2', '.ttf':'font/ttf', '.webmanifest':'application/manifest+json' };
const fixture = createStudioProject({kind:'landing',name:'Synthetic AI summary UI QA',files:{
  'index.tpl':'@template "UI QA"\n@section page "Page"\n@param headline String = "Original heading" label="Heading" required\n@endsection\n@layout\n<!doctype html><html lang="pl"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>{{ headline }}</h1></body></html>\n@endlayout\n',
  'styles.css':'body{margin:0;padding:24px;font-family:system-ui;color:#234}h1{overflow-wrap:anywhere}'
},settings:{headline:'Original heading'}});
const server = createServer(async (request,response) => {
  try { const path = decodeURIComponent(new URL(request.url,'http://localhost').pathname), file = resolve(root,'.'+(path === '/' ? '/index.html' : path)); if (!file.startsWith(root+'/')) throw new Error('Invalid path'); response.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream'}); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
let browser, activePage;
const report = {kind:'isolated production AI panel + real workflow SDK + synthetic provider',paidRequests:0,build:root,states:[],findings:[],pageErrors:[],blockedExternalRequests:[]};
const model = 'google/gemini-3.8-flash';
function expect(condition,message,details={}) { if (!condition) report.findings.push({message,...details}); }
try {
  browser = await chromium.launch({headless:true,...(process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.route('**/*',route => {
      const url = route.request().url(); if (url.startsWith(origin+'/')) return route.continue();
      report.blockedExternalRequests.push({width,url:new URL(url).origin+new URL(url).pathname});
      return route.abort();
    });
    const page = activePage = await context.newPage(); page.on('pageerror',error => report.pageErrors.push({width,message:error.message}));
    await page.addInitScript(() => {
      Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
      const realFetch = window.fetch.bind(window);
      window.aiUi = {writer:0,calls:0,outcome:'fail',hold:true,release:null};
      function tool(body,name,args) {
        const payload = {id:'gen-synthetic-ui-'+window.aiUi.calls,model:body.model,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'ui-'+window.aiUi.calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]};
        return new Response('data: '+JSON.stringify(payload)+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
      }
      const failure = () => Response.json({error:{code:503,message:'Synthetic provider is temporarily unavailable. Completed work remains available.'}},{status:503});
      window.fetch = async (url,options={}) => {
        if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url,options);
        const state = window.aiUi; state.calls++;
        if (!String(url).endsWith('/chat/completions')) return Response.json({error:{message:'Unexpected synthetic endpoint'}},{status:400});
        const body = JSON.parse(options.body), names = body.tools.map(item => item.function.name);
        if (names.includes('submit_plan')) return tool(body,'submit_plan',{summary:'Change the heading, validate and independently review.',tasks:['Update heading','Validate draft','Review changes'],imageRequests:[],requiresSourceChanges:false});
        if (names.includes('submit_review')) return tool(body,'submit_review',{approved:true,summary:'The requested Polish heading is present and the draft is valid.',issues:[],requiresSourceChanges:false});
        const step = ++state.writer;
        if (state.outcome === 'success') return step === 1
          ? tool(body,'edit_file',{path:'index.tpl',search:'<h1>Polski tytuł</h1>',replace:'<h1>Polski tytuł</h1>\n<!-- Independently reviewed retained draft -->'})
          : tool(body,'validate_draft',{});
        if (step === 1) return tool(body,'edit_file',{path:'index.tpl',search:'<h1>{{ headline }}</h1>',replace:'<h1>Polski tytuł</h1>'});
        if (state.hold) return new Promise((resolve,reject) => {
          const abort = () => reject(new DOMException('Cancelled','AbortError')); options.signal?.addEventListener('abort',abort,{once:true});
          state.release = () => { state.hold = false; state.release = null; options.signal?.removeEventListener('abort',abort); resolve(failure()); };
        });
        return failure();
      };
    });
    await page.goto(origin); await page.getByRole('heading',{name:'Ideas become pages.',exact:true}).waitFor();
    await page.evaluate(async ({fixture,model}) => {
      async function open(name,initialize) { return new Promise((resolve,reject) => { const request=indexedDB.open(name,1); request.onupgradeneeded=()=>initialize?.(request.result); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); }); }
      const library = await open('trafficops-studio-library'); await new Promise((resolve,reject) => { const tx=library.transaction(['projects','preferences'],'readwrite'); tx.objectStore('projects').put(fixture); tx.objectStore('preferences').put(fixture.id,'active-project'); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); library.close();
      const connection = await open('trafficops-template-studio-ai',db=>db.createObjectStore('settings',{keyPath:'id'})); await new Promise((resolve,reject) => { const tx=connection.transaction('settings','readwrite'); tx.objectStore('settings').put({id:'openrouter',apiKey:'mock-ui-key-no-paid-requests',model,imageModel:''}); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); connection.close();
    },{fixture,model});
    await page.reload();
    const collapse = page.getByRole('button',{name:'Collapse editor',exact:true}); if (await collapse.count()) await collapse.click();
    await page.getByRole('tab',{name:'AI assistant',exact:true}).click();
    await page.locator('.ai-prompt textarea').fill('Change the main heading to Polski tytuł and preserve the rest of the page.');
    await page.getByRole('button',{name:'Generate changes',exact:true}).click();
    await page.waitForFunction(()=>typeof window.aiUi.release === 'function');
    const summary = page.locator('.ai-run-summary');
    await summary.getByRole('heading',{name:'Building your page',exact:true}).waitFor();
    async function capture(state,primary) {
      await summary.scrollIntoViewIfNeeded();
      const data = await page.evaluate(() => {
        const panel=document.querySelector('.ai-panel'), summary=document.querySelector('.ai-run-summary');
        const visible = e => {
          if (!e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})) return false;
          const r=e.getBoundingClientRect(); return r.width>0 && r.height>0;
        };
        const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const panelRect = rect(panel), controls=[...panel.querySelectorAll('button,details>summary')].filter(visible).filter(e=>!e.disabled).map(e=>({text:e.getAttribute('aria-label') || e.innerText.trim().slice(0,90),tag:e.tagName,className:e.className,parentClass:e.parentElement.className,summaryAction:summary.contains(e),bounds:rect(e)}));
        return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panel:panelRect,panelScrollWidth:panel.scrollWidth,panelClientWidth:panel.clientWidth,state:summary.dataset.state,model:summary.querySelector('.ai-run-model')?.innerText,stages:[...summary.querySelectorAll('.ai-workflow li')].map(e=>({text:e.innerText,state:e.dataset.state})),controls,details:[...panel.querySelectorAll('details')].map(e=>({title:e.querySelector('summary')?.innerText,open:e.open})),sourceVisible:Boolean(panel.querySelector('.ai-live-file')?.open)};
      });
      data.phase=state;
      expect(data.scrollWidth <= width+1,'Global horizontal overflow',{width,state,scrollWidth:data.scrollWidth});
      expect(data.panelScrollWidth <= data.panelClientWidth+1 && data.panel.x >= -1 && data.panel.right <= width+1,'AI panel horizontal overflow',{width,state,panel:data.panel,panelScrollWidth:data.panelScrollWidth});
      expect(data.model?.includes(model),'Selected model is shown in summary',{width,state});
      expect(data.stages.length===5,'Five generation stages are visible',{width,state,stages:data.stages});
      expect(data.details.every(detail=>!detail.open),'Source, activity and diagnostics are collapsed by default',{width,state,details:data.details});
      for (const control of data.controls) expect(control.bounds.height >= 43.9 && control.bounds.width >= 43.9,'Actionable AI control is smaller than 44px',{width,state,control});
      if (primary) {
        const button=summary.getByRole('button',{name:primary,exact:true});
        expect(await button.isVisible() && await button.isEnabled(),'Primary result action is available in top summary',{width,state,primary});
        expect(await button.locator('xpath=ancestor::details').count()===0,'Primary action requires no source or diagnostic disclosure',{width,state,primary});
        await button.scrollIntoViewIfNeeded();
        data.primary = await button.evaluate(e => {
          const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {name:e.innerText,bounds:{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom},inViewport:r.top>=0 && r.bottom<=innerHeight,unobstructed:hit===e || e.contains(hit)};
        });
        expect(data.primary.inViewport && data.primary.unobstructed,'Primary action can be reached and is not covered by another element',{width,state,primary:data.primary});
      }
      await page.screenshot({path:`${out}/${width}-${state}.png`,fullPage:true});
      await page.screenshot({path:`${out}/${width}-${state}-viewport.png`});
      await summary.screenshot({path:`${out}/${width}-${state}-summary.png`});
      report.states.push(data);
    }
    await capture('working','Cancel');
    const source=page.locator('.ai-live-file'); expect(await source.count()===1,'Completed live source is available during generation',{width});
    await source.locator(':scope > summary').click(); expect(await source.evaluate(e=>e.open),'Source disclosure opens',{width});
    await source.getByLabel('Live file changes',{exact:true}).filter({hasText:'Polski tytuł'}).waitFor();
    await source.locator(':scope > summary').click(); expect(!(await source.evaluate(e=>e.open)),'Source disclosure closes',{width});
    await page.evaluate(()=>window.aiUi.release());
    await summary.getByRole('heading',{name:'Draft needs attention',exact:true}).waitFor({timeout:15000});
    await capture('failed','Continue generation');
    for (const action of ['Keep draft in editor','Change model','Discard']) expect(await summary.getByRole('button',{name:action,exact:true}).isVisible(),'Retained draft recovery action is visible',{width,action});
    await page.evaluate(()=>Object.assign(window.aiUi,{outcome:'success',writer:0,hold:false}));
    await summary.getByRole('button',{name:'Continue generation',exact:true}).click();
    await summary.getByRole('heading',{name:'Changes ready',exact:true}).waitFor({timeout:15000});
    await capture('ready','Apply changes');
    await summary.getByRole('button',{name:'Apply changes',exact:true}).click();
    await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading',{name:'Polski tytuł',exact:true}).waitFor();
    expect(!(await page.getByRole('button',{name:'Apply changes',exact:true}).count()),'Apply closes reviewed draft actions',{width});
    await context.close();
  }
  expect(report.pageErrors.length===0,'Browser page errors',{errors:report.pageErrors});
  expect(report.blockedExternalRequests.length===0,'Unexpected external requests were blocked',{requests:report.blockedExternalRequests});
  report.passed=report.findings.length===0;
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  assert.equal(report.passed,true,JSON.stringify(report.findings));
  console.log('PASS:390/1280px working/retained-failure/Ready, model/stages, collapsed details and source toggle,44px controls, visible recovery/apply, no overflow. Zero paid requests.');
} catch(error) {
  report.passed=false; report.error=error.message;
  if(activePage && !activePage.isClosed()) await activePage.screenshot({path:`${out}/failure.png`,fullPage:true});
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)); throw error;
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
