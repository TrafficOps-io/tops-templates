import { workspaceUrl } from './support/workspace-url.js';
import { revealConversationTab } from './support/studio-chat.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { studioChat, showPane } from './support/studio-chat.js';
import { configureAi, installFolderPicker, seedAndOpen } from './support/studio-folders.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist'), out = '/tmp/studio-ai-panel-ui';
await mkdir(out, { recursive:true });
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2', '.ttf':'font/ttf', '.webmanifest':'application/manifest+json' };
const fixture = {name:'Synthetic AI summary UI QA',files:{
  'index.tpl':'@template "UI QA"\n@section page "Page"\n@param headline String = "Original heading" label="Heading" required\n@endsection\n@layout\n<!doctype html><html lang="pl"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>{{ headline }}</h1></body></html>\n@endlayout\n',
  'styles.css':'body{margin:0;padding:24px;font-family:system-ui;color:#234}h1{overflow-wrap:anywhere}'
},settings:{headline:'Original heading'}};
const server = createServer(async (request,response) => {
  try { const path = decodeURIComponent(new URL(request.url,'http://localhost').pathname), file = resolve(root,'.'+(path === '/' ? '/index.html' : path)); if (!file.startsWith(root+'/')) throw new Error('Invalid path'); const value = await readFile(file); response.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream'}); response.end(value); }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
let browser, activePage;
const report = {kind:'isolated production StudioChat + real workflow SDK + synthetic provider',paidRequests:0,build:root,states:[],findings:[],pageErrors:[],blockedExternalRequests:[]};
const model = 'google/gemini-3.8-flash';
function expect(condition,message,details={}) { if (!condition) report.findings.push({message,...details}); }
try {
  browser = await chromium.launch({headless:true,...(process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390,1280]) {
    // 390 px is a phone: touch emulation gives pointer: coarse, where the spec asks for 44 px targets (32 px otherwise).
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',...(width < 640 ? {isMobile:true,hasTouch:true} : {})});
    await context.route('**/*',route => {
      const url = route.request().url(); if (url.startsWith(origin+'/')) return route.continue();
      report.blockedExternalRequests.push({width,url:new URL(url).origin+new URL(url).pathname});
      return route.abort();
    });
    await installFolderPicker(context);
    const page = activePage = await context.newPage(); page.on('pageerror',error => report.pageErrors.push({width,message:error.message}));
    await page.addInitScript(() => {
      // The installed presentation: its chat layout and touch targets are checked below.
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
        // The conversation runtime routes a project-scope request first; this request changes the source.
        if (names.includes('select_intent')) {
          const call={id:'route',type:'function',function:{name:'select_intent',arguments:JSON.stringify({intent:'source'})}};
          if (!body.stream) return Response.json({id:'gen-synthetic-route',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[call]},finish_reason:'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
          return new Response('data: '+JSON.stringify({id:'gen-synthetic-route',model:body.model,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,...call}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
        }
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
    await page.goto(workspaceUrl(origin)); await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
    await configureAi(page,{apiKey:'mock-ui-key-no-paid-requests',model});
    await seedAndOpen(page,{name:fixture.name,folder:'ai-panel-ui',files:fixture.files,values:fixture.settings});
    const collapse = page.getByRole('button',{name:'Collapse editor',exact:true}); if (await collapse.count()) await collapse.click();
    const chat = studioChat(page); await revealConversationTab(chat.root); await chat.root.waitFor();
    await chat.prompt.fill('Change the main heading to Polski tytuł and preserve the rest of the page.');
    await chat.send.click();
    await page.waitForFunction(()=>typeof window.aiUi.release === 'function');
    await chat.status('running').waitFor();
    // Run state is the assistant message: status badge, run message, cards and run actions (the former run summary with
    // model name, five stages and collapsed source/activity/diagnostics disclosures is gone with the assistant panel).
    async function capture(state,primary,run) {
      await run.scrollIntoViewIfNeeded();
      const data = await page.evaluate(() => {
        const panel=document.querySelector('[data-testid="studio-chat"]');
        const visible = e => {
          if (!e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})) return false;
          const r=e.getBoundingClientRect(); return r.width>0 && r.height>0;
        };
        const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const target = matchMedia('(pointer: coarse)').matches ? 43.9 : 31.9;
        const panelRect = rect(panel), controls=[...panel.querySelectorAll('[data-testid="studio-chat-feed"] [data-role="assistant"] button')].filter(visible).filter(e=>!e.disabled).map(e=>({text:e.getAttribute('aria-label') || e.innerText.trim().slice(0,90),className:e.className,bounds:rect(e)}));
        return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panel:panelRect,panelScrollWidth:panel.scrollWidth,panelClientWidth:panel.clientWidth,target,controls};
      });
      data.phase=state; data.status=await run.getAttribute('data-run-status');
      expect(data.scrollWidth <= width+1,'Global horizontal overflow',{width,state,scrollWidth:data.scrollWidth});
      expect(data.panelScrollWidth <= data.panelClientWidth+1 && data.panel.x >= -1 && data.panel.right <= width+1,'Chat horizontal overflow',{width,state,panel:data.panel,panelScrollWidth:data.panelScrollWidth});
      for (const control of data.controls) expect(control.bounds.height >= data.target && control.bounds.width >= data.target,'Actionable run control is smaller than the spec target',{width,state,target:data.target,control});
      if (primary) {
        const button=run.getByRole('button',{name:primary,exact:true});
        expect(await button.isVisible() && await button.isEnabled(),'Primary run action is available on the assistant message',{width,state,primary});
        expect(await button.locator('xpath=ancestor::details').count()===0,'Primary action requires no disclosure',{width,state,primary});
        await button.scrollIntoViewIfNeeded();
        data.primary = await button.evaluate(e => {
          const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {name:e.innerText || e.getAttribute('aria-label'),bounds:{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom},inViewport:r.top>=0 && r.bottom<=innerHeight,unobstructed:hit===e || e.contains(hit)};
        });
        expect(data.primary.inViewport && data.primary.unobstructed,'Primary action can be reached and is not covered by another element',{width,state,primary:data.primary});
      }
      await page.screenshot({path:`${out}/${width}-${state}.png`,fullPage:width >= 640}); // a full-page capture drops touch emulation (pointer: coarse) for the rest of the page
      await page.screenshot({path:`${out}/${width}-${state}-viewport.png`});
      await run.screenshot({path:`${out}/${width}-${state}-summary.png`});
      report.states.push(data);
    }
    await capture('working','Stop',chat.status('running'));
    // Completed source of the running draft is a diff card on the assistant message.
    const source=chat.status('running').locator('[data-testid="studio-chat-card"][data-card="diff"]').filter({hasText:'index.tpl'});
    await source.filter({hasText:'Polski tytuł'}).waitFor({timeout:15000}).catch(()=>{});
    expect(await source.filter({hasText:'Polski tytuł'}).count()===1,'Completed live source is available during generation',{width});
    await page.evaluate(()=>window.aiUi.release());
    const failed=chat.status('failed'); await failed.waitFor({timeout:15000});
    expect((await failed.locator('.studio-chat-run-message').innerText()).includes('Synthetic provider is temporarily unavailable'),'Failed run explains the provider error',{width});
    await capture('failed','Continue generation',failed);
    expect(await failed.locator('[data-testid="studio-chat-keep-draft"]').isVisible(),'Retained draft recovery action is visible',{width,action:'Keep draft in editor'});
    await page.evaluate(()=>Object.assign(window.aiUi,{outcome:'success',writer:0,hold:false}));
    await failed.getByRole('button',{name:'Continue generation',exact:true}).click();
    const ready=chat.status('ready'); await ready.waitFor({timeout:15000});
    await capture('ready','Apply',ready);
    await ready.locator('[data-testid="studio-chat-apply"]').click();
    await showPane(page,'Preview'); // on a phone the preview is its own panel
    await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading',{name:'Polski tytuł',exact:true}).waitFor();
    await showPane(page,'Edit'); await chat.apply.waitFor({state:'detached'});
    await chat.status('applied').getByText('Changes applied',{exact:true}).waitFor();
    expect(!(await chat.apply.count()),'Apply closes reviewed draft actions',{width});
    await context.close();
  }
  expect(report.pageErrors.length===0,'Browser page errors',{errors:report.pageErrors});
  expect(report.blockedExternalRequests.length===0,'Unexpected external requests were blocked',{requests:report.blockedExternalRequests});
  report.passed=report.findings.length===0;
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  assert.equal(report.passed,true,JSON.stringify(report.findings));
  console.log('PASS:390/1280px working/retained-failure/Ready on StudioChat, live source card, spec touch targets, visible recovery/apply, no overflow. Zero paid requests.');
} catch(error) {
  report.passed=false; report.error=error.message;
  if(activePage && !activePage.isClosed()) await activePage.screenshot({path:`${out}/failure.png`,fullPage:true});
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)); throw error;
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
