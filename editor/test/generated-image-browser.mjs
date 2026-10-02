import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(repository, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

function pngChunk(type, bytes) {
  const kind = Buffer.from(type), length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([kind, bytes])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, kind, bytes, checksum]);
}
// A complete, highly compressed transparent PNG just over the pixel limit.
// No oversized browser canvas is needed to construct this input fixture.
const oversizedHeader = Buffer.alloc(13); oversizedHeader.writeUInt32BE(4097, 0); oversizedHeader.writeUInt32BE(4097, 4); oversizedHeader[8] = 8; oversizedHeader[9] = 6;
const oversizedPng = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', oversizedHeader), pngChunk('IDAT', deflateSync(Buffer.alloc((4097 * 4 + 1) * 4097))), pngChunk('IEND', Buffer.alloc(0))]);

// Bundle the actual production functions for a real browser decoder/canvas.
// Both language and image-provider responses are local synthetic data. This
// check never reads connection settings or sends a paid OpenRouter request.
const entry = `
import { normalizeGeneratedImagePng } from './packages/template-editor-shell/src/generated-image-png.js';
import { runStudioAiWorkflow } from './packages/template-editor-shell/src/studio-ai-workflow.js';
import { createAiDraftValidator } from './packages/template-editor-shell/src/validate-ai-draft.js';
import { createFolderHost } from './editor/src/hosts/FolderHost.js';
import { createProjectInRoot } from './editor/src/storage/project-root.js';
import { parseProject, getDefaults } from './runtime/src/index.js';
const pngSignature = [137,80,78,71,13,10,26,10];
const checks = [];
const oversizedPngBase64 = ${JSON.stringify(oversizedPng.toString('base64'))};
function check(condition, label, details = {}) { checks.push({ label, passed: Boolean(condition), ...details }); if (!condition) throw new Error(label); }
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
async function fails(callback, label, expected = {}) { try { await callback(); } catch (error) { check(Object.entries(expected).every(([key,value]) => error[key] === value), label, { errorName: error.name, code: error.code, terminalImage: error.terminalImage, retryable: error.retryable }); return; } throw new Error(label); }
async function promptly(promise) { let timeout; try { return await Promise.race([promise, new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('Conversion did not cancel promptly')), 500); })]); } finally { clearTimeout(timeout); } }
async function withResourceTracking(callback) {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, active = new Set();
  URL.createObjectURL = function(...args) { const url = create.apply(this,args); active.add(url); return url; };
  URL.revokeObjectURL = function(url) { active.delete(url); return revoke.call(this,url); };
  try { await callback(); check(active.size === 0, 'Conversion releases all created object URLs', { activeObjectUrls:active.size }); }
  finally { for (const url of active) revoke.call(URL,url); URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
}
async function raster(type) {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 40;
  const context = canvas.getContext('2d'); context.fillStyle = '#b02070'; context.fillRect(0,0,64,40); context.fillStyle = '#20a080'; context.fillRect(32,0,32,40);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
  check(blob && blob.type === type, 'Browser produced genuine ' + type);
  return new File([blob], 'provider-image.' + ({'image/jpeg':'jpg','image/webp':'webp','image/png':'png'})[type], { type });
}
async function inspectPng(file, label) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  check(file.type === 'image/png', label + ': MIME is PNG');
  check(pngSignature.every((byte,index) => bytes[index] === byte), label + ': actual PNG signature');
  check(bytes.length > 8 && bytes.length <= 8 * 1024 * 1024, label + ': nonempty bounded file', { bytes: bytes.length });
  const decoded = await createImageBitmap(file);
  check(decoded.width === 64 && decoded.height === 40, label + ': dimensions preserved', { width: decoded.width, height: decoded.height });
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 40; const context = canvas.getContext('2d'); context.drawImage(decoded,0,0); decoded.close();
  const color = context.getImageData(8,8,1,1).data;
  check(color[0] > 120 && color[1] < 80 && color[2] > 60 && color[3] === 255, label + ': decoded pixels remain usable');
  return bytes;
}
function toolResponse(model, name, value) {
  const payload = { id: 'gen-synthetic-raster-test', model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: name + crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }] };
  return new Response('data: ' + JSON.stringify(payload) + '\\n\\ndata: [DONE]\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
const files = { 'index.tpl': '@template "Image conversion QA"\\n@section content "Content"\\n@param headline String = "Original headline" label="Heading" required\\n@param cover Image = "" label="Cover"\\n@endsection\\n@layout\\n<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{headline}}</title></head><body><h1>{{headline}}</h1>\\n@if cover\\n<img src="{{cover}}" alt="Synthetic image">\\n@endif\\n</body></html>\\n@endlayout\\n' };
const definition = parseProject(files).definition, values = getDefaults(definition);
// The host is the production folder host over a project written to a fresh OPFS folder (one per workflow).
async function folderHost(name) {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  await createProjectInRoot(root, { kind: 'landing', name: 'Image conversion QA', files, values });
  return createFolderHost({ root });
}
async function workflow(file) {
  const host = await folderHost('generated-image-' + file.type.replace('/', '-') + '-' + crypto.randomUUID()), state = await host.project.open();
  const validateDraft = createAiDraftValidator(host.analyzer, () => state);
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const imagePayload = { data: [{ media_type: file.type, b64_json: btoa(binary) }] };
  let writer = 0, imageRequests = 0, textRequests = 0;
  const original = JSON.stringify({ files, values });
  const result = await runStudioAiWorkflow({ mode:'content', files, values, definition, prompt:'Generate a cover illustration, use it on the page and change the headline to Polish.', generateImages:true, apiKey:'mock-raster-key-no-paid-requests', model:'test/tool-model', imageModel:'test/provider-raster', stream:true, validateDraft, staged:true, // the reviewed (plan → write → review) workflow
    fetchImpl:async (url, init) => {
      if (String(url).endsWith('/images')) { imageRequests++; return Response.json(imagePayload); }
      check(String(url).endsWith('/chat/completions'), 'Workflow requests stay in the synthetic OpenRouter adapter'); textRequests++;
      const body = JSON.parse(init.body), names = body.tools.map(tool => tool.function.name);
      if (names.includes('submit_plan')) return toolResponse(body.model,'submit_plan',{summary:'Generate and use the image, then independently review.',tasks:['Generate requested cover','Update saved fields','Validate and review'],imageRequests:['Synthetic cover']});
      if (names.includes('submit_review')) return toolResponse(body.model,'submit_review',{approved:true,summary:'Polish headline and real local cover match the request.',issues:[]});
      const step = writer++;
      if (step === 0) return toolResponse(body.model,'generate_image',{path:'images/cover.png',prompt:'Synthetic cover',referenceIds:[]});
      if (step === 1) return toolResponse(body.model,'set_values',{values:{headline:'Polski tytuł',cover:'images/cover.png'}});
      return toolResponse(body.model,'validate_draft',{});
    } });
  check(result.valid === true && result.review.approved === true, file.type + ': workflow independently reviewed and ready');
  check(result.values.cover === 'images/cover.png' && result.values.headline === 'Polski tytuł', file.type + ': actual field values point to the PNG path');
  check(result.files['images/cover.png'] instanceof Uint8Array, file.type + ': committed draft asset is binary');
  await inspectPng(new File([result.files['images/cover.png']], 'cover.png', {type:'image/png'}), file.type + ' workflow');
  check(imageRequests === 1, file.type + ': conversion does not repeat the paid image request', { imageRequests, textRequests });
  check(JSON.stringify({files,values}) === original, file.type + ': original project is unchanged until Apply');
  const reopened = await host.project.open();
  check(reopened.files['images/cover.png'] === undefined && JSON.stringify(reopened.translations?.[reopened.locale]) === JSON.stringify(values), file.type + ': the project folder is unchanged until Apply');
  host.dispose();
}
window.runGeneratedImageChecks = async () => {
  try {
    const png = await raster('image/png'); const preserved = await normalizeGeneratedImagePng(png);
    check(preserved === png, 'Existing valid PNG passes through unchanged'); await inspectPng(preserved, 'Existing PNG');
    for (const type of ['image/jpeg','image/webp']) { const file = await raster(type); await inspectPng(await normalizeGeneratedImagePng(file), type + ' conversion'); await workflow(file); }
    const terminalConversion = { name:'AiProviderError', code:'image_conversion_failed', terminalImage:true, retryable:false };
    await withResourceTracking(async () => {
      await fails(() => normalizeGeneratedImagePng(new File([new Uint8Array(pngSignature)], 'signature-only.png', {type:'image/png'})), 'PNG magic alone does not pass native image validation', terminalConversion);
      await fails(async () => normalizeGeneratedImagePng(new File([await png.slice(0,36).arrayBuffer()], 'truncated.png', {type:'image/png'})), 'A real truncated PNG rejects instead of passing through', terminalConversion);
      const originalPng = new Uint8Array(await png.arrayBuffer()), emptyPixelChunk = new Uint8Array(13), pixelView = new DataView(emptyPixelChunk.buffer);
      pixelView.setUint32(0,1); emptyPixelChunk.set([73,68,65,84],4); pixelView.setUint32(9,crc32(emptyPixelChunk.slice(4,9)));
      const brokenPixels = new Uint8Array(33 + emptyPixelChunk.length + 12); brokenPixels.set(originalPng.slice(0,33)); brokenPixels.set(emptyPixelChunk,33); brokenPixels.set(originalPng.slice(-12),33+emptyPixelChunk.length);
      const decode = HTMLImageElement.prototype.decode, bitmap = window.createImageBitmap; let attempts = 0;
      HTMLImageElement.prototype.decode = function(...args) { attempts++; return decode.apply(this,args); };
      window.createImageBitmap = function(...args) { attempts++; return bitmap.apply(this,args); };
      try { await fails(() => normalizeGeneratedImagePng(new File([brokenPixels], 'invalid-pixels.png', {type:'image/png'})), 'Complete PNG with invalid pixel data rejects native decoding', terminalConversion); }
      finally { HTMLImageElement.prototype.decode = decode; window.createImageBitmap = bitmap; }
      check(attempts >= 1, 'PNG with complete chunks and correct CRCs reaches actual native pixel validation', { nativeDecodeAttempts:attempts });
    });
    const originalCreateElement = document.createElement, originalDecode = HTMLImageElement.prototype.decode, originalBitmap = window.createImageBitmap;
    let oversizedCanvasAllocations = 0, oversizedNativeDecodes = 0;
    document.createElement = function(name,...args) { if (String(name).toLowerCase() === 'canvas') oversizedCanvasAllocations++; return originalCreateElement.call(this,name,...args); };
    HTMLImageElement.prototype.decode = function(...args) { oversizedNativeDecodes++; return originalDecode.apply(this,args); };
    window.createImageBitmap = function(...args) { oversizedNativeDecodes++; return originalBitmap.apply(this,args); };
    try { await fails(() => normalizeGeneratedImagePng(new File([Uint8Array.from(atob(oversizedPngBase64), char => char.charCodeAt(0))], 'too-many-pixels.png', {type:'image/png'})), 'Complete PNG over 16 megapixels rejects before conversion allocation', terminalConversion); }
    finally { document.createElement = originalCreateElement; HTMLImageElement.prototype.decode = originalDecode; window.createImageBitmap = originalBitmap; }
    check(oversizedCanvasAllocations === 0 && oversizedNativeDecodes === 0, 'Oversized PNG reaches neither native decoding nor canvas allocation', { oversizedCanvasAllocations, oversizedNativeDecodes });
    await fails(() => normalizeGeneratedImagePng(new File([new Uint8Array([1,2,3,4])], 'broken.jpg', {type:'image/jpeg'})), 'Invalid raster header rejects as a terminal conversion error', terminalConversion);
    await fails(() => normalizeGeneratedImagePng(new File([new Uint8Array([255,216,255,0,1,2,3,4,5,6,7,8])], 'undecodable.jpg', {type:'image/jpeg'})), 'Real browser decoder rejects an invalid JPEG body as terminal', terminalConversion);
    await fails(() => normalizeGeneratedImagePng(new File([png], 'mismatched.jpg', {type:'image/jpeg'})), 'MIME and actual raster signature must agree', terminalConversion);
    await fails(() => normalizeGeneratedImagePng(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'oversized.jpg', {type:'image/jpeg'})), 'Oversized provider raster rejects before decoding', terminalConversion);
    const before = new AbortController(); before.abort(); await fails(() => normalizeGeneratedImagePng(png,{signal:before.signal}), 'Pre-cancelled conversion rejects', {name:'AbortError'});
    const jpeg = await raster('image/jpeg'), during = new AbortController();
    const pending = normalizeGeneratedImagePng(jpeg,{signal:during.signal}); during.abort();
    await fails(() => pending, 'Cancellation during format inspection rejects', {name:'AbortError'});
    const late = new AbortController(), originalToBlob = HTMLCanvasElement.prototype.toBlob;
    let encodedCanvas, nativeEncoderFinished = false;
    HTMLCanvasElement.prototype.toBlob = function(callback,...args) { encodedCanvas = this; return originalToBlob.call(this, blob => { nativeEncoderFinished = Boolean(blob); late.abort(); callback(blob); }, ...args); };
    try { await fails(() => normalizeGeneratedImagePng(jpeg,{signal:late.signal}), 'Cancellation after actual JPEG decoding and native PNG encoding rejects', {name:'AbortError'}); }
    finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; }
    check(nativeEncoderFinished && encodedCanvas.width === 0 && encodedCanvas.height === 0, 'Late cancellation releases the real conversion canvas');
    await withResourceTracking(async () => {
      const controller = new AbortController(), decode = HTMLImageElement.prototype.decode;
      let enter, release, image; const entered = new Promise(resolve => { enter = resolve; });
      HTMLImageElement.prototype.decode = function() { image = this; const actual = decode.call(this); actual.catch(() => {}); enter(); return new Promise((resolve,reject) => { release = () => actual.then(resolve,reject); }); };
      try {
        const operation = normalizeGeneratedImagePng(jpeg,{signal:controller.signal}); await promptly(entered); controller.abort();
        await fails(() => promptly(operation), 'Abort promptly rejects while native image decoding is in flight', {name:'AbortError'});
        check(!image.getAttribute('src'), 'In-flight decode cancellation clears the image source');
      } finally { HTMLImageElement.prototype.decode = decode; release?.(); }
    });
    await withResourceTracking(async () => {
      const controller = new AbortController(), encode = HTMLCanvasElement.prototype.toBlob;
      let enter, release, canvas; const entered = new Promise(resolve => { enter = resolve; });
      HTMLCanvasElement.prototype.toBlob = function(callback,...args) { canvas = this; return encode.call(this, blob => { release = () => callback(blob); enter(); }, ...args); };
      try {
        const operation = normalizeGeneratedImagePng(jpeg,{signal:controller.signal}); await promptly(entered); controller.abort();
        await fails(() => promptly(operation), 'Abort promptly rejects while native encoder callback is withheld', {name:'AbortError'});
        check(canvas.width === 0 && canvas.height === 0, 'In-flight encoder cancellation releases the conversion canvas');
      } finally { HTMLCanvasElement.prototype.toBlob = encode; release?.(); }
    });
    const pngAbort = new AbortController(), nativeBitmap = window.createImageBitmap;
    let enterBitmap, releaseBitmap, closeCount = 0;
    const bitmapEntered = new Promise(resolve => { enterBitmap = resolve; });
    window.createImageBitmap = function(...args) { return nativeBitmap.apply(this,args).then(bitmap => { const close = bitmap.close; bitmap.close = function() { closeCount++; return close.call(this); }; enterBitmap(); return new Promise(resolve => { releaseBitmap = () => resolve(bitmap); }); }); };
    try {
      const operation = normalizeGeneratedImagePng(png,{signal:pngAbort.signal}); await promptly(bitmapEntered); pngAbort.abort();
      await fails(() => promptly(operation), 'Abort promptly rejects before a native PNG bitmap result arrives', {name:'AbortError'});
      releaseBitmap(); await new Promise(resolve => setTimeout(resolve,0));
      check(closeCount === 1, 'A native PNG bitmap arriving after cancellation is closed exactly once', { closeCount });
    } finally { window.createImageBitmap = nativeBitmap; releaseBitmap?.(); }
    return { passed:true, kind:'isolated browser real raster decoding + synthetic provider workflow', paidRequests:0, checks };
  } catch(error) { return { passed:false, error:error.message, checks }; }
};
`;
const bundled = await build({ stdin: { contents: entry, resolveDir: repository, sourcefile: 'generated-image-browser-entry.js' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } });
const script = bundled.outputFiles[0].contents;
const server = createServer((request, response) => {
  if (request.url === '/check.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); }
  else if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><p>Isolated generated image check</p><script type="module" src="/check.js"></script></body></html>'); }
  else { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const context = await browser.newContext(), origin = `http://127.0.0.1:${server.address().port}`, blocked = [], errors = [];
  await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); blocked.push(route.request().url().split('?')[0]); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => typeof window.runGeneratedImageChecks === 'function');
  const report = await page.evaluate(() => window.runGeneratedImageChecks()); report.blockedExternalRequests = blocked; report.pageErrors = errors;
  await writeFile('/tmp/studio-generated-image-browser-report.json', JSON.stringify(report, null, 2));
  assert.equal(report.passed, true, JSON.stringify(report)); assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log('PASS: actual JPEG/WebP decoder→PNG conversion, signature/dimensions/pixels/size/path, full reviewed image workflow, PNG passthrough, invalid raster rejection and cancellation. Zero paid requests.');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
