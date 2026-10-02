// Real opaque iframe and shared PreviewPanel; no model/provider calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundle = await build({
  stdin: { resolveDir: resolve('.'), loader: 'jsx', contents: `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import PreviewPanel from './packages/template-editor-shell/src/PreviewPanel.jsx';
    import {buildInteractivePreview} from './editor/src/preview/interactive-preview.js';
    const root=createRoot(document.getElementById('preview'));
    const pages={
      'index.html':[{id:'comments',label:'Comments',ancestorIds:[]},{id:'comment-1',label:'Comment 1',ancestorIds:['comments']},{id:'order',label:'Order form',ancestorIds:[]}],
      'next.html':[{id:'next-block',label:'Next block',ancestorIds:[]}],
    };
    const files={
      'index.html':'<!doctype html><style>body{margin:20px}section{padding:20px;margin-bottom:15px;border:1px solid}form{padding:20px}#unknown{margin:10px}</style><script>window.authorClicks=0;addEventListener("click",()=>window.authorClicks++,true);<\\/script><h1>Selection page</h1><button id="ordinary">Ordinary button</button><section id="comments" data-block="comments" data-tops-block-instance="comments"><a id="comment" href="next.html" data-block="Comment 1" data-tops-block-instance="comment-1">Comment link</a></section><form id="order" action="next.html" data-block="order_form" data-tops-block-instance="order"><input name="name"><button id="submit">Submit form</button></form><button id="unknown" data-tops-block-instance="unknown">Unknown instance</button>',
      'next.html':'<!doctype html><h1>Next page</h1><section data-block="next" data-tops-block-instance="next-block">Next selectable block</section><a id="back" href="index.html">Back</a>',
    };
    let revision=0;
    window.selectionEvents=[]; window.documents=[]; window.edits=0;
    function Harness(){
      const [frame,setFrame]=useState(()=>({...buildInteractivePreview(files,'index.html',{selection:{pages}}),revision:++revision}));
      const [enabled,setEnabled]=useState(false),[selected,setSelected]=useState([]),[locked,setLocked]=useState(false);
      frame.selection.blockInstances=Object.entries(pages).flatMap(([page,blocks])=>blocks.map(block=>({...block,page})));
      window.frameDescriptor=frame; window.selectedIds=selected.map(block=>block.id);
      window.setSelectionLocked=setLocked;
      window.refreshSelectionPreview=()=>setFrame({...buildInteractivePreview(files,'index.html',{selection:{pages}}),revision:++revision});
      window.mountPendingSelection=()=>setFrame({revision:++revision,page:'index.html',selection:{version:1,token:'pending-selection',blockInstances:frame.selection.blockInstances},readyToken:'pending-preview',html:'<h1>Pending page</h1><script>parent.postMessage({type:"trafficops-preview-selection-ready",version:1,token:"pending-selection",documentToken:"pending-document",page:"index.html",selectedIds:[]},"*");addEventListener("message",event=>{if(event.data.release)parent.postMessage({type:"trafficops-preview-ready",token:"pending-preview"},"*")});<\\/script>'});
      return <PreviewPanel pages={[{name:'index.html'},{name:'next.html'}]} page="index.html" onPageChange={()=>{}} mobile={false} onMobileChange={()=>{}} preview={frame} interactive ready selectionAvailable selectionEnabled={enabled} onSelectionEnabledChange={setEnabled} selectedBlocks={selected} selectionLocked={locked}
        onSelectionDocumentChange={(frame,page)=>{window.documents.push({revision:frame.revision,page});setSelected([]);}}
        onSelectionChange={(ids,frame,page)=>{window.selectionEvents.push({ids,revision:frame.revision,page});setSelected(ids.map(id=>frame.selection.blockInstances.find(block=>block.id===id&&block.page===page)).filter(Boolean));}}
        onEditSelected={()=>window.edits++} />;
    }
    addEventListener('message',event=>{if(event.source===document.querySelector('iframe.is-visible')?.contentWindow&&event.data?.type==='trafficops-preview-selection-ready')window.currentDocument=event.data;});
    root.render(<Harness/>);
  ` },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const css = (await readFile('packages/template-editor-shell/src/shell.css', 'utf8')).replace(/^@import[^\n]*\n/gm, '').replace(/^@plugin[^\n]*\n/gm, '');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/harness.js' ? 'text/javascript' : request.url === '/shell.css' ? 'text/css' : 'text/html');
  response.end(request.url === '/harness.js' ? bundle.outputFiles[0].text : request.url === '/shell.css' ? css : '<!doctype html><link rel="stylesheet" href="/shell.css"><style>.browser-frame{height:500px!important}.preview-stage{height:550px!important}</style><div id="preview" class="editor-root"></div><script type="module" src="/harness.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page, errors = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = () => page.frameLocator('iframe.is-visible');
  await frame().getByRole('heading', { name: 'Selection page' }).waitFor();
  const toggle = page.getByRole('button', { name: 'Select elements', exact: true });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('iframe.is-visible').getAttribute('sandbox'), 'allow-scripts allow-forms');
  await frame().locator('#ordinary').click();
  assert.equal(await frame().locator('body').evaluate(() => window.authorClicks), 1);
  await toggle.click();
  const choices = page.getByRole('button', { name: 'Choose sections', exact: true });
  await choices.click();
  const search = page.getByRole('combobox', { name: 'Search sections', exact: true });
  await search.fill('comments');
  await search.press('Enter');
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comments');
  assert.equal(await page.getByRole('listbox', { name: 'Page sections' }).getAttribute('aria-multiselectable'), 'true');
  await search.fill('order');
  await page.getByRole('option', { name: 'Order form', exact: true }).click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comments,order');
  assert.equal(await page.getByRole('option', { name: 'Order form', exact: true }).getAttribute('aria-selected'), 'true');
  await search.press('Enter');
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comments');
  await search.fill('absent');
  await page.getByText('No matching sections', { exact: true }).waitFor();
  await search.press('Escape');
  assert.equal(await choices.getAttribute('aria-expanded'), 'false');
  assert.equal(await choices.evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await frame().locator('#comment').click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comment-1');
  assert.equal(await frame().locator('body').evaluate(() => window.authorClicks), 1, 'selection captures before authored window handlers');
  await frame().getByRole('heading', { name: 'Selection page' }).waitFor();
  // Hover feedback must not echo a stale selection back over a newer choice made in the parent.
  await page.evaluate(() => { window.hoverSelectionReports = []; addEventListener('message', event => { if (event.data?.type === 'trafficops-preview-selection-change') window.hoverSelectionReports.push(event.data.selectedIds); }); });
  await frame().locator('#submit').hover();
  await choices.hover();
  await page.waitForTimeout(100); // Drain cross-frame pointer/message events before the next click.
  assert.deepEqual(await page.evaluate(() => window.hoverSelectionReports), [], 'hover does not report a selection change');
  await frame().locator('#submit').click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comment-1,order');
  await frame().getByRole('heading', { name: 'Selection page' }).waitFor();
  await frame().locator('#unknown').click();
  assert.deepEqual(await page.evaluate(() => window.selectedIds), ['comment-1', 'order'], 'unknown runtime identities cannot be selected');
  await frame().locator('[data-tops-selection-overlay]').waitFor();
  await page.getByRole('button', { name: 'Remove Order form from selection' }).click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comment-1');
  await page.getByRole('button', { name: 'Select parent block' }).click();
  await page.getByRole('menuitem', { name: 'Comments', exact: true }).click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comments');
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  assert.equal(await page.evaluate(() => window.edits), 1);

  // Invalid sender and stale document token never change the trusted selection.
  await page.evaluate(() => {
    const element=document.querySelector('iframe.is-visible'),descriptor=window.frameDescriptor;
    const forge=(source,documentToken)=>window.dispatchEvent(new MessageEvent('message',{source,data:{type:'trafficops-preview-selection-change',version:1,token:descriptor.selection.token,documentToken,page:'index.html',selectedIds:['order']}}));
    forge(window,'guessed');forge(element.contentWindow,'previous-document');
  });
  assert.deepEqual(await page.evaluate(() => window.selectedIds), ['comments']);
  await page.evaluate(() => window.setSelectionLocked(true));
  await page.waitForFunction(() => document.querySelector('.preview-selection-toggle')?.disabled);
  assert.equal(await toggle.isDisabled(), true);
  assert.equal(await choices.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Edit selected', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.setSelectionLocked(false));
  await page.waitForFunction(() => !document.querySelector('.preview-selection-toggle')?.disabled);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await toggle.click();
  await frame().locator('[data-tops-selection-overlay]').waitFor({ state: 'detached' });
  await frame().locator('#comment').click();
  await frame().getByRole('heading', { name: 'Next page' }).waitFor();
  await page.waitForFunction(() => window.documents.at(-1)?.page === 'next.html');
  await toggle.click();
  await choices.click();
  assert.deepEqual(await page.getByRole('listbox', { name: 'Page sections' }).getByRole('option').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label'))), ['Next block']);
  await page.getByRole('combobox', { name: 'Search sections' }).press('Escape');
  await frame().getByText('Next selectable block', { exact: true }).click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'next-block');
  assert.equal(await page.evaluate(() => window.selectionEvents.at(-1).page), 'next.html');

  const documentCount = await page.evaluate(() => window.documents.length);
  await page.evaluate(() => window.mountPendingSelection());
  await page.locator('iframe.is-preparing').waitFor();
  await page.evaluate(() => {
    const element=document.querySelector('iframe.is-preparing');
    window.dispatchEvent(new MessageEvent('message',{source:element.contentWindow,data:{type:'trafficops-preview-selection-change',version:1,token:'pending-selection',documentToken:'pending-document',page:'index.html',selectedIds:['order']}}));
  });
  assert.deepEqual(await page.evaluate(() => window.selectedIds), ['next-block']);
  assert.equal(await page.evaluate(() => window.documents.length), documentCount, 'pending ready does not reset visible selection');
  await frame().getByRole('heading', { name: 'Next page' }).waitFor();
  await page.evaluate(() => document.querySelector('iframe.is-preparing').contentWindow.postMessage({ release: true }, '*'));
  await frame().getByRole('heading', { name: 'Pending page' }).waitFor();
  await page.waitForFunction(() => window.selectedIds.length === 0);
  await page.evaluate(() => window.refreshSelectionPreview());
  await frame().getByRole('heading', { name: 'Selection page' }).waitFor();
  await frame().locator('#comment').click();
  await page.waitForFunction(() => window.selectedIds.join(',') === 'comment-1');
  assert.deepEqual(errors, []);
  console.log('PASS: selection default off, capture before author handlers, searchable list and keyboard multi-select, current-page filtering, form/link suppression, allowlist, chips/parent choice, locked state, opaque sandbox, page navigation, source/document matching, pending/visible separation and refresh.');
} catch (error) {
  console.error(JSON.stringify({ errors, state: await page?.evaluate(() => ({ documents: window.documents, selectionEvents: window.selectionEvents, selectedIds: window.selectedIds })).catch(String) }));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
