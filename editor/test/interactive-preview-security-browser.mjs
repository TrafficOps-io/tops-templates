// Execute hostile author code through the real PreviewPanel and Studio runner.
// Playwright evaluates only the trusted test harness; capability probes run as
// ordinary template scripts, subject to the browser's CSP and iframe sandbox.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const secret = 'parent-only-secret-9d65e13';
const bundle = await build({
  stdin: {
    resolveDir: resolve('.'), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import PreviewPanel from './packages/template-editor-shell/src/PreviewPanel.jsx';
      import { useEditorProject } from './packages/template-editor-shell/src/useEditorProject.js';
      import { buildInteractivePreview } from './editor/src/preview/interactive-preview.js';
      const root = createRoot(document.getElementById('preview'));
      let revision = 0, previous, currentFrame;
      window.securityReports = [];
      window.addEventListener('message', event => {
        if (event.source === document.querySelector('iframe')?.contentWindow && event.data?.securityTest) {
          window.securityReports.push(event.data);
        }
      });
      window.setSecurityPanelState = ({pages=[{name:'index.html',isEntry:true}],error=''}={}) => {
        root.render(<PreviewPanel pages={pages} error={error}
          page="index.html" onPageChange={() => {}} mobile={false}
          onMobileChange={() => {}} preview={currentFrame}
          interactive={true} ready={true} note="Security fixture" />);
      };
      window.mountSecurityPreview = (files, descriptor) => {
        previous?.dispose?.();
        previous = descriptor || buildInteractivePreview(files, 'index.html');
        currentFrame = {...previous,revision:++revision};
        window.generatedPreviewHtml = previous.html || '';
        window.securityReports = [];
        window.setSecurityPanelState();
      };
      window.lifecycleDisposals = []; window.lifecycleRenders = [];
      const lifecycleHost = {
        capabilities:{inlinePreview:true,autosave:false},
        project:{open:async () => ({name:'Lifecycle fixture',revision:1,files:{'index.html':'1'},folders:[],
          entrypoint:'index.html',locale:'en',translations:{en:{}},availability:{inlinePreview:true},actions:[],history:[]})},
        analyzer:{analyze:async () => ({definition:null,pages:['index.html'],entrypoint:'index.html'})},
        livePreview:{
          render:async (state,options) => {
            const id=state.files['index.html'],readyToken=id==='1'?undefined:'lifecycle-'+id;
            window.lifecycleRenders.push({id,keepRevisionId:options.keepRevisionId});
            return {id,page:'index.html',readyToken,
              html:'<h1>Lifecycle '+id+'</h1><script>addEventListener("message",()=>parent.postMessage({type:"trafficops-preview-ready",token:'+JSON.stringify(readyToken)+'},"*"));<\\/script>',
              dispose:() => window.lifecycleDisposals.push(id)};
          },
          dispose:() => window.lifecycleDisposals.push('host'),
        },
      };
      function LifecycleHarness() {
        const editor=useEditorProject(lifecycleHost);
        window.lifecycleEditor=editor;
        return <PreviewPanel pages={[{name:'index.html',isEntry:true}]} page="index.html"
          onPageChange={() => {}} mobile={false} onMobileChange={() => {}}
          preview={editor.preview} interactive={true} ready={true} onDisplayed={editor.previewDisplayed} />;
      }
      window.mountLifecyclePreview=()=>root.render(<LifecycleHarness />);
      window.unmountLifecyclePreview=()=>root.render(null);
    `,
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const script = `
  const probe = action => { try { return {allowed:true,value:action()}; } catch(error) {return {allowed:false,error:error.name};} };
  const report = (phase, more={}) => parent.postMessage({securityTest:true,phase,
    origin:globalThis.origin,
    parentDOM:probe(() => parent.document.documentElement.dataset.secret),
    parentStorage:probe(() => parent.localStorage.getItem('secret')),
    cookie:probe(() => document.cookie),
    storage:probe(() => localStorage.getItem('secret')),
    database:probe(() => {indexedDB.open('parent-secret');return 'opened';}),
    frameElement:frameElement === null,
    ...more}, '*');
  document.getElementById('gesture').onclick = () => {
    const topNavigation = probe(() => {top.location.href='https://studio.test/escaped';return 'navigated';});
    const popup = window.open('https://outside.test/popup','_blank');
    report('gesture',{topNavigation,popupBlocked:popup===null});
  };
  document.getElementById('navigate').onclick = () => {location.href='https://outside.test/navigated';};
  (async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
    // Removing a parsed policy and adding a permissive one cannot relax CSP.
    document.querySelectorAll('meta[http-equiv]').forEach(node => node.remove());
    const policy = document.createElement('meta'); policy.httpEquiv='Content-Security-Policy';
    policy.content="default-src * data: blob: 'unsafe-inline'; frame-src * data: blob:; object-src * data:; base-uri *";
    document.head.append(policy);
    const base = document.createElement('base');base.href='https://studio.test/stolen-base/';document.head.append(base);
    const frame = document.createElement('iframe'); frame.src='https://outside.test/nested'; document.body.append(frame);
    const object = document.createElement('object');object.data='https://outside.test/object';document.body.append(object);
    const worker = probe(() => new Worker(URL.createObjectURL(new Blob(['postMessage("worker escaped")'], {type:'text/javascript'}))));
    if(worker.allowed) worker.value.terminate();
    let privateResponse;
    try {privateResponse={read:true,value:await (await fetch('https://studio.test/private',{credentials:'include'})).text()};}
    catch(error) {privateResponse={read:false,error:error.name};}
    let publicResponse;
    try {publicResponse=await (await fetch('https://outside.test/public')).text();} catch(error) {publicResponse=error.name;}
    setTimeout(() => report('initial',{privateResponse,publicResponse,violations,
      baseBlocked:document.baseURI!=='https://studio.test/stolen-base/',
      referrer:document.referrer}), 100);
  })();
`;

const files = {
  'index.html': `<!doctype html><html><head>
    <meta http-equiv="refresh" content="0;url=https://outside.test/meta-refresh">
    <base href="https://studio.test/stolen-base/" target="_top">
    <meta http-equiv="Content-Security-Policy" content="frame-src *; object-src *; base-uri *">
    </head><body><h1>Untrusted landing</h1>
    <button id="gesture">Try escaping</button><button id="navigate">Navigate frame</button>
    <script>${script}</script></body></html>`,
};
const afterNavigation = `<!doctype html><button id="gesture">Try escaping</button><button id="navigate">Navigate frame</button><script>
  ${script.slice(0, script.indexOf('  (async () =>'))}
  report('navigated');
</script>`;
const network = [];
const diagnostics = [];
const shellStyles = (await readFile('packages/template-editor-shell/src/shell.css','utf8'))
  .replace(/^@import[^\n]*\n/gm,'').replace(/^@plugin[^\n]*\n/gm,'');
let slowResponse, slowRequestedResolve;
const slowRequested = new Promise(resolve => {slowRequestedResolve=resolve;});
const certificateDirectory = await mkdtemp(`${tmpdir()}/interactive-preview-security-`);
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
  '-keyout',`${certificateDirectory}/key.pem`,'-out',`${certificateDirectory}/cert.pem`,
  '-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
let browser, page, panelOrigin, contentOrigin;
const localize = text => text.replaceAll('https://studio.test',panelOrigin).replaceAll('https://outside.test',contentOrigin);
const server = createServer({key:await readFile(`${certificateDirectory}/key.pem`),cert:await readFile(`${certificateDirectory}/cert.pem`)}, (request,response) => {
  const url = new URL(request.url,`https://${request.headers.host}`);
  network.push({host:url.host,path:url.pathname,origin:request.headers.origin});
  const send = (type,body,headers={}) => {response.writeHead(200,{'Content-Type':type,...headers});response.end(body);};
  if (url.pathname === '/') {
    send('text/html',`<!doctype html><html data-secret="${secret}">
      <head><link rel="stylesheet" href="/shell.css"><style>.browser-frame{height:500px!important}.preview-stage{height:550px!important}</style></head><body><div id="preview" class="editor-root"></div>
      <script>localStorage.setItem('secret',${JSON.stringify(secret)});document.cookie='secret=${secret}; Secure; SameSite=Lax';</script>
      <script type="module" src="/security-harness.js"></script></body></html>`);
  } else if (url.pathname === '/security-harness.js') send('text/javascript',bundle.outputFiles[0].text);
  else if (url.pathname === '/shell.css') send('text/css',shellStyles);
  else if (url.pathname === '/private') send('text/plain',secret);
  else if (url.pathname === '/public') send('text/plain','public CORS response',{'Access-Control-Allow-Origin':'*'});
  else if (url.pathname === '/navigated') send('text/html',localize(afterNavigation));
  else if (url.pathname === '/steady') send('text/html','<h1>Working version</h1><button onclick="this.textContent=\'Still interactive\'">Use working version</button>');
  else if (url.pathname === '/slow') {slowResponse=response;slowRequestedResolve();}
  else send('text/html','Unexpected resource');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
panelOrigin = `https://127.0.0.1:${server.address().port}`;
contentOrigin = `https://localhost:${server.address().port}`;
try {
  browser = await chromium.launch({headless:true,
    ...(process.platform === 'darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
  // Real loopback HTTPS endpoints exercise CORS without third-party traffic.
  // Avoid request interception: some Chrome/Playwright versions stall requests
  // from an opaque out-of-process srcdoc when routing is enabled.
  const context = await browser.newContext({ignoreHTTPSErrors:true});
  page = await context.newPage();
  page.on('pageerror', error => diagnostics.push(error.message));
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await page.goto(`${panelOrigin}/`);
  await page.waitForFunction(() => Boolean(window.mountSecurityPreview));
  await page.evaluate(files => window.mountSecurityPreview(files),Object.fromEntries(Object.entries(files).map(([name,body]) => [name,localize(body)])));
  await page.waitForFunction(() => window.securityReports.some(report => report.phase === 'initial'));
  const first = await page.evaluate(() => window.securityReports.find(report => report.phase === 'initial'));
  const assertOpaque = result => {
    assert.equal(result.origin, 'null');
    for (const key of ['parentDOM','parentStorage','cookie','storage','database']) {
      assert.equal(result[key].allowed,false,`${result.phase}: ${key} must reject`);
      assert.equal(result[key].error,'SecurityError',`${result.phase}: ${key} must fail at browser boundary`);
    }
    assert.equal(result.frameElement,true,'untrusted script cannot remove the outer sandbox');
  };
  assertOpaque(first);
  assert.equal(first.privateResponse.read,false,'opaque preview cannot read a panel response without CORS');
  assert.equal(first.publicResponse,'public CORS response','sandbox retains intentionally allowed HTTPS fetch');
  assert.equal(first.baseBlocked,true);
  assert.equal(first.referrer,'');
  assert.ok(first.violations.includes('base-uri'));
  assert.ok(first.violations.includes('frame-src'));
  assert.ok(first.violations.includes('object-src'));
  assert.ok(first.violations.includes('worker-src'));
  assert.equal(await page.locator('#preview > section iframe').first().getAttribute('sandbox'),'allow-scripts allow-forms');
  assert.equal(await page.locator('#preview > section iframe').first().getAttribute('referrerpolicy'),'no-referrer');
  assert.equal(await page.evaluate(secret => window.generatedPreviewHtml.includes(secret),secret),false,'parent secrets never enter the snapshot');

  await page.frameLocator('#preview > section iframe').getByRole('button',{name:'Try escaping'}).click();
  await page.waitForFunction(() => window.securityReports.some(report => report.phase === 'gesture'));
  const gesture = await page.evaluate(() => window.securityReports.find(report => report.phase === 'gesture'));
  assertOpaque(gesture);
  assert.equal(gesture.topNavigation.allowed,false,'a real user gesture cannot navigate the parent');
  assert.equal(gesture.popupBlocked,true,'a real user gesture cannot create an escaping popup');
  assert.equal(context.pages().length,1);
  assert.equal(page.url(),`${panelOrigin}/`);

  await page.frameLocator('#preview > section iframe').getByRole('button',{name:'Navigate frame'}).click();
  await page.waitForFunction(() => window.securityReports.some(report => report.phase === 'navigated'));
  assertOpaque(await page.evaluate(() => window.securityReports.find(report => report.phase === 'navigated')));
  assert.equal(page.url(),`${panelOrigin}/`,'self-navigation stays confined to the iframe');
  assert.equal(await page.evaluate(() => localStorage.getItem('secret')),secret);
  assert.equal(network.some(request => ['/nested','/object','/meta-refresh','/escaped','/popup'].includes(request.path)),false,
    'CSP and sandbox must block forbidden requests before sending them');

  // A hosted preview keeps its actual DOM and active controls until the next
  // response loads; it never exposes the preparing iframe's blank document.
  await page.evaluate(url => window.mountSecurityPreview({}, {url}),`${contentOrigin}/steady`);
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Working version'}).waitFor();
  await page.evaluate(() => {window.errorFrame=document.querySelector('iframe.is-visible');
    window.setSecurityPanelState({pages:[],error:'The layout block is temporarily incomplete'});});
  await page.getByRole('alert').filter({hasText:'The layout block is temporarily incomplete'}).waitFor();
  assert.equal(await page.evaluate(() => window.errorFrame === document.querySelector('iframe.is-visible')),true,
    'invalid TPL with zero recognized pages must preserve the exact working iframe');
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Working version'}).waitFor();
  await page.evaluate(() => window.setSecurityPanelState());
  const beforeSwap = await page.locator('iframe.is-visible').boundingBox();
  await page.evaluate(() => {window.previousFrame=document.querySelector('iframe.is-visible');});
  await page.evaluate(url => window.mountSecurityPreview({}, {url}),`${contentOrigin}/slow`);
  await slowRequested;
  assert.equal(await page.locator('.preview-document').count(),2);
  assert.equal(await page.evaluate(() => window.previousFrame === document.querySelector('iframe.is-visible')),true);
  assert.equal(await page.locator('iframe.is-visible').evaluate(frame => getComputedStyle(frame).opacity),'1');
  assert.equal(await page.locator('iframe.is-preparing').evaluate(frame => getComputedStyle(frame).opacity),'0');
  await page.frameLocator('iframe.is-visible').getByRole('button',{name:'Use working version'}).click();
  await page.frameLocator('iframe.is-visible').getByRole('button',{name:'Still interactive'}).waitFor();
  slowResponse.writeHead(200,{'Content-Type':'text/html'});slowResponse.end('<h1>Updated version</h1>');
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Updated version'}).waitFor();
  assert.equal(await page.locator('.preview-document').count(),1);
  assert.deepEqual(await page.locator('iframe.is-visible').boundingBox(),beforeSwap);
  assert.equal(await page.evaluate(() => window.previousFrame.isConnected),false);

  // The only child message consumed by PreviewPanel is a ready signal. Neither
  // an unrelated sender with the right token nor the right frame with a wrong
  // token may reveal unfinished content.
  const token = 'security-test-ready-token';
  await page.evaluate(token => window.mountSecurityPreview({}, {readyToken:token,
    html:`<h1>Token-controlled version</h1><script>
      parent.postMessage({type:'trafficops-preview-ready',token:'wrong-token'},'*');
      addEventListener('message',()=>parent.postMessage({type:'trafficops-preview-ready',token:${JSON.stringify(token)}},'*'));
    <\/script>`}),token);
  await page.locator('iframe.is-preparing').waitFor();
  await page.evaluate(token => window.postMessage({type:'trafficops-preview-ready',token},'*'),token);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Updated version'}).waitFor();
  await page.evaluate(() => document.querySelector('iframe.is-preparing').contentWindow.postMessage({release:true},'*'));
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Token-controlled version'}).waitFor();
  assert.equal(await page.locator('.preview-document').count(),1);

  // Verify the hook's resource contract with a host that actually disposes each
  // descriptor. Built-in no-op disposers could otherwise hide premature release.
  await page.evaluate(() => window.mountLifecyclePreview());
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Lifecycle 1'}).waitFor();
  await page.evaluate(() => {window.lifecycleFirstFrame=document.querySelector('iframe.is-visible');
    window.lifecycleEditor.change({files:{'index.html':'2'}});});
  await page.frameLocator('iframe.is-preparing').getByRole('heading',{name:'Lifecycle 2'}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.lifecycleDisposals),[],
    'the visible frame must retain its resources while a successor prepares');
  await page.evaluate(() => window.lifecycleEditor.change({files:{'index.html':'3'}}));
  await page.frameLocator('iframe.is-preparing').getByRole('heading',{name:'Lifecycle 3'}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.lifecycleDisposals),['2'],'abandoned pending resources are released once');
  assert.equal(await page.evaluate(() => window.lifecycleFirstFrame === document.querySelector('iframe.is-visible')),true);
  assert.equal(await page.evaluate(() => window.lifecycleRenders.at(-1).keepRevisionId),'1',
    'the server pin follows the displayed version, not the latest prepared descriptor');
  await page.evaluate(() => document.querySelector('iframe.is-preparing').contentWindow.postMessage({release:true},'*'));
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Lifecycle 3'}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.lifecycleDisposals),['2','1']);
  await page.evaluate(() => window.lifecycleEditor.change({files:{'index.html':'4'}}));
  await page.frameLocator('iframe.is-preparing').getByRole('heading',{name:'Lifecycle 4'}).waitFor();
  await page.evaluate(() => {
    window.pausedVisibleFrame=document.querySelector('iframe.is-visible');
    window.abandonedWindow=document.querySelector('iframe.is-preparing').contentWindow;
    window.lifecycleEditor.togglePreviewPaused();
  });
  await page.locator('iframe.is-preparing').waitFor({state:'detached'});
  assert.equal(await page.evaluate(() => window.lifecycleEditor.previewPaused),true);
  assert.deepEqual(await page.evaluate(() => window.lifecycleDisposals),['2','1','4']);
  // Model a ready event that had already been queued by the abandoned iframe.
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message',{source:window.abandonedWindow,
    data:{type:'trafficops-preview-ready',token:'lifecycle-4'}})));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.pausedVisibleFrame === document.querySelector('iframe.is-visible')),true,
    'pausing freezes the visible page even when a prepared iframe later reports ready');
  await page.frameLocator('iframe.is-visible').getByRole('heading',{name:'Lifecycle 3'}).waitFor();
  await page.evaluate(() => window.unmountLifecyclePreview());
  await page.waitForFunction(() => window.lifecycleDisposals.includes('host'));
  assert.deepEqual(await page.evaluate(() => window.lifecycleDisposals),['2','1','4','3','host'],
    'teardown releases the remaining descriptor and host exactly once');
  console.log('PASS: real PreviewPanel opaque origin, parent DOM/storage/cookies/IndexedDB isolation, CSP retention, base/frame/object/worker restrictions, CORS, gesture popup/top-navigation blocking, navigation isolation, seamless iframe swap, invalid-TPL retention, source/token readiness, delayed resource disposal, displayed-revision pin and immediate pause.');
} catch (error) {
  const frames = await Promise.all(page?.frames().map(async frame => ({url:frame.url(),content:(await frame.content().catch(String)).slice(0,1000)})) || []);
  console.error(JSON.stringify({diagnostics,network,frames},null,2));
  throw error;
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));
  await rm(certificateDirectory,{recursive:true,force:true});
}
