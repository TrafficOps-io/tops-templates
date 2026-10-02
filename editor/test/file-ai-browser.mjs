import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { studioChat } from './support/studio-chat.js';
import { configureAi, installFolderPicker, openProject, readProjectFolder, seedProjectFolder } from './support/studio-folders.js';

// Runs against an existing production build. All provider traffic is intercepted
// before it reaches the network, and every context seeds its own project folder (OPFS through the test picker).
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '../dist'));
const out = '/tmp/studio-file-ai-browser';
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

function pngChunk(type, bytes) {
  const kind = Buffer.from(type), size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([kind, bytes])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, kind, bytes, checksum]);
}
function png(red, green, blue) {
  const width = 16, height = 12, header = Buffer.alloc(13), pixels = Buffer.alloc((width * 4 + 1) * height);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([red, green, blue, 255], y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
const originalPng = png(220, 40, 80), editedPng = png(30, 90, 230), referencePng = png(60, 180, 100);
const target = 'images/hero.png', stylesheet = 'styles.css', changedCss = 'body{margin:0;padding:24px;background:#234;color:white}\n';
const vector = 'images/icon.svg', changedSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="blue"/></svg>\n';
const fixture = { name: 'Synthetic selected-file AI QA', files: {
  'index.tpl': '@template "Single file QA"\n@section page "Page"\n@param headline String = "Original heading" label="Heading" required\n@param cover Image = "images/hero.png" label="Cover"\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><h1>{{ headline }}</h1><img src="{{cover}}" alt="Selected image"></body></html>\n@endlayout\n',
  [stylesheet]: 'body{margin:0;padding:24px;background:#eee;color:#234}\n',
  [target]: new Uint8Array(originalPng),
  'images/neighbor.png': new Uint8Array(referencePng),
  [vector]: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="red"/></svg>\n',
  'private.txt': 'ORIGINAL_PRIVATE_NEIGHBOR: do not include this unrelated source in selected-file prompts.\n',
}, settings: { headline: 'Saved field stays unchanged', cover: target, customValue: { count: 7 } } };
const folder = 'picker/file-ai';
const model = 'test/file-language-model', imageModel = 'test/file-image-model';
const referenceText = 'Synthetic reference: keep the existing image framing and use a blue background.';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const report = { kind: 'isolated production selected-file AI UI + synthetic providers', build: root, paidRequests: 0, states: [], controlIssues: [], pageErrors: [], blockedExternalRequests: [] };
const server = createServer(async (request,response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    const value = await readFile(file); response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(value);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0, '127.0.0.1', resolve); });
let browser, activePage;
const touchSessions = new WeakMap();

// The project folder as the editor saved it: files (bytes as arrays), folders and values.
async function snapshot(page) {
  const { files, folders, values } = await readProjectFolder(page, folder);
  return { files: Object.fromEntries(Object.entries(files).map(([path,content]) => [path,typeof content === 'string' ? content : [...content]])), folders, settings: values };
}
async function savedFile(page,path,expected) {
  await pollSavedFile(page,path,content=>JSON.stringify(content)===JSON.stringify(expected));
  await page.waitForTimeout(150);
  assert.deepEqual((await snapshot(page)).files[path],expected,path+': durable write stays saved');
}
async function savedFileChanged(page,path,previous) {
  await pollSavedFile(page,path,content=>content && JSON.stringify(content)!==JSON.stringify(previous));
}
async function pollSavedFile(page,path,matches) {
  // Playwright waitForFunction treats a Promise as an immediate truthy result;
  // poll completed folder reads in Node so the 650ms autosave really finishes.
  const deadline=Date.now()+15000;
  do { if(matches((await snapshot(page)).files[path]))return; await page.waitForTimeout(100); } while(Date.now()<deadline);
  assert.fail('Selected file was not durably saved: '+path);
}
async function selectFile(page,path) {
  await page.getByRole('tab', {name:'Files',exact:true}).click();
  await page.locator('.file-sidebar').getByTitle(path,{exact:true}).click();
}
async function openAssistant(page,path) {
  await selectFile(page,path);
  await page.getByRole('button', {name:'Edit file with AI',exact:true}).click();
  const chat = studioChat(page), panel = chat.root;
  await chat.scope.getByRole('button',{name:'File',pressed:true,exact:true}).waitFor();
  await chat.composer.locator('.studio-chip-mention').getByText('@'+path,{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Edit file with AI',exact:true}).count(),0,'Selected-file action opens a scoped conversation');
  assert.equal(await panel.getByLabel('Use on page',{exact:true}).count(),0,'Single-file attachments have no page-placement control');
  return panel;
}
const lastRun = panel => panel.locator('[data-testid="studio-chat-feed"] [data-role="assistant"]').last();
const runIn = (panel,status) => lastRun(panel).and(panel.page().locator(`[data-run-status="${status}"]`));
// Ready run, then the explicit draft preview (RunActions); result cards render with the message.
async function ready(panel,path) {
  await runIn(panel,'ready').waitFor({timeout:15000});
  await lastRun(panel).getByRole('button',{name:'Preview draft',exact:true}).click();
}
async function apply(panel) {
  await lastRun(panel).locator('[data-testid="studio-chat-apply"]').click();
  await runIn(panel,'applied').waitFor();
}
const composer = panel => studioChat(panel.page());
async function capture(page,panel,width,phase) {
  // Chromium's full-page screenshot resets touch emulation. Restore the real
  // touch media condition before checking each subsequent state.
  // matchMedia may already report a coarse pointer while styles still use the reset one, so toggle the emulation
  // to make Chromium re-evaluate (pointer: coarse) rules.
  {
    let cdp = touchSessions.get(page);
    if (!cdp) { cdp = await page.context().newCDPSession(page); touchSessions.set(page, cdp); }
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.waitForFunction(() => matchMedia('(pointer: coarse)').matches);
    // Wait until the stylesheet itself applies (pointer: coarse) again, not only matchMedia.
    await page.evaluate(() => { if (document.getElementById('touch-media-probe')) return; const style = document.createElement('style'); style.textContent = '#touch-media-probe{position:fixed;left:-99px;top:0;width:1px;height:1px}@media (pointer: coarse){#touch-media-probe{width:44px}}'; const probe = document.createElement('div'); probe.id = 'touch-media-probe'; document.head.append(style); document.body.append(probe); });
    await page.waitForFunction(() => document.getElementById('touch-media-probe').getBoundingClientRect().width === 44);
  }
  const data = await panel.evaluate(element => {
    const bounds=element.getBoundingClientRect(), result=element.querySelector('[data-testid="studio-chat-card"]');
    const controls=[...element.querySelectorAll('button,details>summary')].filter(control=>!control.disabled && control.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})).map(control=>{const rect=control.getBoundingClientRect();return{text:control.getAttribute('aria-label') || control.innerText.trim(),width:rect.width,height:rect.height};});
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,panelWidth:element.clientWidth,panelScrollWidth:element.scrollWidth,panelBounds:{x:bounds.x,right:bounds.right,width:bounds.width,y:bounds.y},controls,resultTop:result?.getBoundingClientRect().top};
  });
  assert.ok(data.documentWidth <= width+1, `No document overflow at ${width}px (${phase})`);
  assert.ok(data.panelBounds.x >= -1 && data.panelBounds.right <= width+1, `Conversation fits ${width}px (${phase})`);
  assert.ok(data.panelScrollWidth <= data.panelWidth+1, `No panel overflow at ${width}px (${phase})`);
  for(const control of data.controls)if(control.width<43.9 || control.height<43.9)report.controlIssues.push({viewport:width,phase,...control});
  if(phase.endsWith('ready')) {
    await page.getByText('Conversation draft · Project files unchanged',{exact:true}).waitFor();
    assert.ok(await panel.locator('[data-testid="studio-chat-feed"] [data-role="user"]').count(),'The original request stays visible in its conversation');
    const action=lastRun(panel).locator('[data-testid="studio-chat-apply"]');await action.scrollIntoViewIfNeeded();
    const reachable=await action.evaluate(element=>{const rect=element.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return rect.y>=-1 && rect.bottom<=innerHeight+1 && (element===hit || element.contains(hit)) || JSON.stringify({y:rect.y,bottom:rect.bottom,innerHeight,hit:hit?.outerHTML.slice(0,200)});});
    assert.ok(reachable===true,'Apply can be reached and is unobstructed (1px subpixel tolerance, as the layout checks) '+reachable);
  }
  await page.screenshot({path:`${out}/${width}-${phase}.png`,fullPage:true});
  report.states.push({width,phase,...data});
}

try {
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
  browser = await chromium.launch({headless:true,...(executablePath?{executablePath}: {})});
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',hasTouch:true});
    await context.route('**/*',route => {
      const url = route.request().url(); if (url.startsWith(origin+'/')) return route.continue();
      report.blockedExternalRequests.push({width,url:new URL(url).origin+new URL(url).pathname}); return route.abort();
    });
    await installFolderPicker(context);
    const page = activePage = await context.newPage(); page.on('pageerror',error => report.pageErrors.push({width,message:error.message}));
    await page.addInitScript(({editedBase64,changedCss,stylesheet}) => {
      // The installed presentation: its conversation panel layout and touch targets are checked below.
      Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
      const realFetch = window.fetch.bind(window);
      window.fileAiTest = {requests:[],holdImage:true,holdText:false,release:null,textPath:stylesheet,textContent:changedCss};
      function tool(body,name,args) {
        const call = {id:'synthetic-file-'+window.fileAiTest.requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}};
        if (!body.stream) return Response.json({id:call.id,model:body.model,choices:[{index:0,message:{role:'assistant',tool_calls:[call]},finish_reason:'tool_calls'}]});
        const payload = {id:call.id,model:body.model,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,...call}]},finish_reason:'tool_calls'}]};
        return new Response('data: '+JSON.stringify(payload)+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
      }
      async function held(options,value) {
        window.fileAiTest.heldSignal=options.signal;
        return new Promise((resolve,reject) => {
          const abort = () => { window.fileAiTest.release = null; reject(new DOMException('Synthetic request cancelled','AbortError')); };
          options.signal?.addEventListener('abort',abort,{once:true});
          window.fileAiTest.release = () => { window.fileAiTest.release = null; options.signal?.removeEventListener('abort',abort); resolve(value); };
        });
      }
      window.fetch = async (url,options={}) => {
        if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url,options);
        const state = window.fileAiTest, body = JSON.parse(options.body);
        state.requests.push({endpoint:String(url).split('/').at(-1),body});
        if (String(url).endsWith('/images')) {
          const value = Response.json({data:[{media_type:'image/png',b64_json:editedBase64}]});
          return state.holdImage ? held(options,value) : value;
        }
        if (!String(url).endsWith('/chat/completions')) return Response.json({error:{message:'Unexpected synthetic endpoint'}},{status:400});
        const names = (body.tools || []).map(item => item.function.name);
        if (names.includes('submit_image_prompt')) return tool(body,'submit_image_prompt',{prompt:'Preserve the selected image framing; use the uploaded references to make the background blue.',summary:'Edit only the selected image using the provided references.'});
        if (names.includes('submit_file_review')) return tool(body,'submit_file_review',{approved:true,summary:'Only the selected file changed and the requested result is present.',issues:[]});
        if (names.includes('submit_plan')) return tool(body,'submit_plan',{summary:'Update only the selected stylesheet.',tasks:['Edit selected file','Validate file','Review result']});
        const edited = body.messages.some(message => message.role === 'tool' && JSON.stringify(message).includes('set_file'));
        const previous = body.messages.some(message => message.role === 'assistant' && message.tool_calls?.some(call => call.function.name === 'set_file'));
        const value = previous || edited ? tool(body,'validate_draft',{}) : tool(body,'set_file',{path:state.textPath,content:state.textContent});
        return state.holdText ? held(options,value) : value;
      };
    },{editedBase64:editedPng.toString('base64'),changedCss,stylesheet});
    await page.goto(origin);
    await page.getByRole('heading',{name:'Ideas become pages.',exact:true}).waitFor();
    // JPEG and WebP copies of the PNG, encoded by the browser.
    const encoded = await page.evaluate(async png => {
      const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(png),char=>char.charCodeAt(0))],{type:'image/png'})), canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      const result={};
      for (const [path,mime] of [['images/photo.jpg','image/jpeg'],['images/scene.webp','image/webp']]) {const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,.9));if(blob.type!==mime)throw new Error('Browser did not encode '+mime);result[path]=[...new Uint8Array(await blob.arrayBuffer())];}canvas.width=0;canvas.height=0;
      return result;
    },originalPng.toString('base64'));
    await seedProjectFolder(page,{name:fixture.name,folder:'file-ai',files:{...fixture.files,...Object.fromEntries(Object.entries(encoded).map(([path,bytes])=>[path,new Uint8Array(bytes)]))},values:fixture.settings});
    await configureAi(page,{apiKey:'mock-file-key-no-paid-requests',model,imageModel});
    await openProject(page,fixture.name);
    const initial = await snapshot(page);
    let dialog = await openAssistant(page,target);
    await composer(dialog).prompt.fill('Use my uploaded references to change only this picture to a blue background.');
    await composer(dialog).attachmentInput.setInputFiles([
      {name:'reference.png',mimeType:'image/png',buffer:referencePng},
      {name:'instructions.txt',mimeType:'text/plain',buffer:Buffer.from(referenceText)},
      {name:'reference.pdf',mimeType:'application/pdf',buffer:pdf},
    ]);
    await composer(dialog).composer.getByRole('button',{name:'Remove reference.pdf',exact:true}).waitFor();
    assert.equal(await dialog.getByLabel('Use on page',{exact:true}).count(),0);
    await capture(page,dialog,width,'prompt');
    await composer(dialog).send.click();
    await page.waitForFunction(()=>typeof window.fileAiTest.release==='function');
    await capture(page,dialog,width,'working');
    assert.deepEqual(await snapshot(page),initial,'Generation never persists a speculative image');
    await page.evaluate(()=>window.fileAiTest.release());
    await ready(dialog,target);
    const imageCard=lastRun(dialog).locator('[data-testid="studio-chat-card"][data-card="image"]').filter({hasText:target});
    await imageCard.locator('figcaption').getByText('Before',{exact:true}).waitFor(); await imageCard.locator('figcaption').getByText('After',{exact:true}).waitFor();
    const imageRequests = await page.evaluate(()=>window.fileAiTest.requests);
    const image = imageRequests.find(request=>request.endpoint==='images');
    assert.ok(image,'Selected image uses the image provider');
    assert.equal(image.body.input_references[0].image_url.url,'data:image/png;base64,'+originalPng.toString('base64'),'Selected image is the first edit reference');
    assert.equal(image.body.input_references.length,2,'Only selected image and uploaded raster enter image references');
    assert.equal(image.body.input_references[1].image_url.url,'data:image/png;base64,'+referencePng.toString('base64'));
    const imageMessages = JSON.stringify(imageRequests.filter(request=>request.endpoint==='completions').map(request=>request.body.messages));
    assert.ok(imageMessages.includes(referenceText),'Text document enters image planning/review context');
    assert.ok(imageMessages.includes('reference.pdf') && imageMessages.includes('data:application/pdf;base64,'),'PDF enters provider context as a document');
    assert.ok(!imageMessages.includes('ORIGINAL_PRIVATE_NEIGHBOR'),'Unrelated file contents stay outside selected-file context');
    await capture(page,dialog,width,'image-ready');
    await dialog.locator('[data-testid="studio-chat-feed"] [data-role="user"]').getByText('Use my uploaded references to change only this picture to a blue background.',{exact:true}).waitFor();
    assert.deepEqual(await snapshot(page),initial,'Ready image remains a draft before Apply');
    await apply(dialog);
    await savedFile(page,target,[...editedPng]);
    let applied = await snapshot(page);
    assert.deepEqual(applied,{...initial,files:{...initial.files,[target]:[...editedPng]}},'Image Apply changes exactly one existing path and preserves settings and neighboring assets');
    const decoded = await page.evaluate(async bytes => {const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));const result={width:bitmap.width,height:bitmap.height};bitmap.close();return result;},applied.files[target]);
    assert.deepEqual(decoded,{width:16,height:12},'Applied PNG is an actual decodable image with preserved dimensions');

    await page.evaluate(()=>Object.assign(window.fileAiTest,{requests:[],holdImage:false}));
    dialog = await openAssistant(page,target);
    await composer(dialog).prompt.fill('Create another blue image draft for discard QA.');
    await composer(dialog).send.click();
    await ready(dialog,target);
    const beforeDiscard=await page.evaluate(()=>window.fileAiTest.requests.length);
    await lastRun(dialog).getByRole('button',{name:'Discard',exact:true}).click();
    await runIn(dialog,'discarded').waitFor();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.fileAiTest.requests.length),beforeDiscard,'Discard does not resubmit generation when the form actions change');
    assert.deepEqual(await snapshot(page),applied,'Discard leaves the persisted selected image and project unchanged');

    for (const [path,mime] of [['images/photo.jpg','image/jpeg'],['images/scene.webp','image/webp']]) {
      await page.evaluate(()=>Object.assign(window.fileAiTest,{requests:[],holdImage:false}));
      dialog = await openAssistant(page,path);
      await composer(dialog).prompt.fill('Change this existing image to blue and keep its original file format.');
      await composer(dialog).send.click();
      await ready(dialog,path);
      const request = await page.evaluate(()=>window.fileAiTest.requests.find(request=>request.endpoint==='images'));
      assert.equal(request.body.input_references[0].image_url.url,'data:'+mime+';base64,'+Buffer.from(applied.files[path]).toString('base64'),path+': original target is the first reference');
      assert.deepEqual(await snapshot(page),applied,path+': ready draft remains unpersisted');
      await capture(page,dialog,width,mime==='image/jpeg'?'jpeg-ready':'webp-ready');
      await apply(dialog);
      await savedFileChanged(page,path,applied.files[path]);
      const next = await snapshot(page), bytes = next.files[path];
      assert.deepEqual(next,{...applied,files:{...applied.files,[path]:bytes}},path+': Apply changes only the selected existing asset');
      assert.ok(mime==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : Buffer.from(bytes.slice(0,4)).toString()==='RIFF' && Buffer.from(bytes.slice(8,12)).toString()==='WEBP',path+': bytes preserve the selected format');
      const raster=await page.evaluate(async ({bytes,mime})=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:mime})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const result={width:bitmap.width,height:bitmap.height,pixel:[...ctx.getImageData(8,6,1,1).data]};bitmap.close();canvas.width=0;canvas.height=0;return result;},{bytes,mime});
      assert.equal(raster.width,16);assert.equal(raster.height,12);assert.ok(raster.pixel[2]>180 && raster.pixel[0]<80,path+': real decoded edited pixels are blue');
      applied=next;
    }

    const changedTemplate=initial.files['index.tpl'].replace('<h1>{{ headline }}</h1>','<h1>AI edited heading</h1>');
    for (const [path,content,phase] of [[stylesheet,changedCss,'css-ready'],[vector,changedSvg,'svg-ready'],['index.tpl',changedTemplate,'tpl-ready']]) {
      await page.evaluate(({path,content,hold})=>Object.assign(window.fileAiTest,{requests:[],release:null,holdText:hold,textPath:path,textContent:content}),{path,content,hold:path===stylesheet});
      dialog = await openAssistant(page,path);
      await composer(dialog).prompt.fill('Use the attached text reference to edit only the selected source file.');
      await composer(dialog).attachmentInput.setInputFiles({name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('Change only the selected source file. Keep every other file and saved field unchanged.')});
      await composer(dialog).composer.getByRole('button',{name:'Remove notes.md',exact:true}).waitFor();
      await composer(dialog).send.click();
      if (path===stylesheet) {
        await page.waitForFunction(()=>typeof window.fileAiTest.release==='function');
        await lastRun(dialog).getByRole('button',{name:'Stop',exact:true}).click();
        await runIn(dialog,'cancelled').waitFor({timeout:5000});
        await page.evaluate(()=>window.fileAiTest.release?.());
        await page.waitForTimeout(100);
        assert.deepEqual(await snapshot(page),applied,'Stop leaves the project unchanged');
        assert.equal(await page.evaluate(()=>window.fileAiTest.requests.length),1,'Stop does not submit another generation when action buttons change');
        await page.evaluate(()=>Object.assign(window.fileAiTest,{requests:[],holdText:false}));
        await composer(dialog).prompt.fill('Use the attached text reference to edit only the selected source file.');
        await composer(dialog).attachmentInput.setInputFiles({name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('Change only the selected source file. Keep every other file and saved field unchanged.')});
        await composer(dialog).composer.getByRole('button',{name:'Remove notes.md',exact:true}).waitFor();
        await composer(dialog).send.click();
      }
      await ready(dialog,path);
      await capture(page,dialog,width,phase);
      const textRequests = await page.evaluate(()=>window.fileAiTest.requests);
      assert.ok(!textRequests.some(request=>request.endpoint==='images'),path+': text editing never invokes the image provider');
      assert.ok(JSON.stringify(textRequests).includes('Change only the selected source file.'),path+': text document reaches the model');
      assert.ok(!JSON.stringify(textRequests).includes('ORIGINAL_PRIVATE_NEIGHBOR'),path+': unrelated file contents stay outside model context');
      assert.deepEqual(await snapshot(page),applied,path+': ready text remains a draft before Apply');
      await apply(dialog); await savedFile(page,path,content);
      const next=await snapshot(page);assert.deepEqual(next,{...applied,files:{...applied.files,[path]:content}},path+': Apply changes exactly the selected source file');applied=next;
    }
    await context.close();
  }
  assert.deepEqual(report.pageErrors,[],'No browser page errors'); assert.deepEqual(report.blockedExternalRequests,[],'No unexpected external requests');
  assert.equal(report.controlIssues.length,0,
   'All touch controls have reachable 44px areas: '+JSON.stringify([...new Map(report.controlIssues.map(issue=>[issue.text,issue])).values()]));
  report.passed=true; await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  console.log('PASS: 390/1280px PNG/JPEG/WebP original first + preserved formats, raster/TXT/PDF references, real image draft, one-file Apply, Discard, Stop, CSS/SVG/TPL source edits, preserved neighbors/values in the project folder, no overflow. Zero paid requests.');
} catch(error) {
  report.passed=false; report.error=error.message;
  if (activePage && !activePage.isClosed()) {
    report.diagnostics=await activePage.evaluate(()=>({requestCount:window.fileAiTest?.requests.length,requestTools:window.fileAiTest?.requests.map(request=>({endpoint:request.endpoint,tools:request.body.tools?.map(tool=>tool.function.name),roles:request.body.messages?.map(message=>message.role)})),heldResponse:typeof window.fileAiTest?.release==='function',heldSignalAborted:window.fileAiTest?.heldSignal?.aborted,status:[...document.querySelectorAll('[data-testid="studio-chat-feed"] [data-role="assistant"]')].at(-1)?.innerText,error:document.querySelector('[data-testid="studio-chat"] .studio-notice')?.innerText}));
    await activePage.screenshot({path:`${out}/failure.png`,fullPage:true});
  }
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)); throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
