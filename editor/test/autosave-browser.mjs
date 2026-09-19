import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const entry = '/autosave-hook-test.js';
const script = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { useEditorProject } from '/packages/template-editor-shell/src/useEditorProject.js';
  window.saveAttempts = 0;
  window.allowSave = false;
  const state = {name:'Initial', revision:1, files:{'index.html':'<h1>Initial</h1>'}, folders:[], locale:'en', translations:{en:{}}, entrypoint:'index.html', availability:{inlinePreview:false}, actions:[], history:[]};
  const host = {
    capabilities:{autosave:true, inlinePreview:false},
    project:{open:async()=>state, save:async value=>{
      window.saveAttempts++;
      if(!window.allowSave) throw new Error('Browser storage is full.');
      return {...value,revision:value.revision+1};
    }},
    analyzer:{analyze:async()=>({definition:null,entrypoint:'index.html',sourceDiagnostics:[],diagnostics:[]})}
  };
  function Harness(){
    const [externalBusy,setExternalBusy]=React.useState(false);
    window.setExternalBusy=setExternalBusy;
    const editor=useEditorProject(host,value=>{window.snapshot=value;},null,externalBusy);
    window.editor=editor;
    return React.createElement('div',null,
      React.createElement('div',{role:'alert'},editor.error),
      React.createElement('div',{id:'save-state'},editor.dirty?'Unsaved':'Saved'));
  }
  createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const server = await createServer({
  configFile: false, root: resolve('.'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'autosave-hook-test',
    resolveId(id) { if (id === entry) return entry; },
    load(id) { if (id === entry) return script; },
    configureServer(vite) {
      vite.middlewares.use('/', (request, response, next) => {
        if (request.url !== '/') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="' + entry + '"></script></body></html>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForFunction(() => window.editor?.state);
  await page.evaluate(() => window.editor.change({ name: 'First edit' }));
  await page.getByRole('alert').filter({ hasText: 'Browser storage is full.' }).waitFor();
  await page.waitForTimeout(1600);
  assert.equal(await page.evaluate(() => window.saveAttempts), 1, 'a failed autosave must stay paused across multiple debounce intervals');
  assert.equal(await page.locator('#save-state').textContent(), 'Unsaved');
  assert.equal(await page.getByRole('alert').textContent(), 'Browser storage is full.');

  await page.evaluate(() => window.editor.change({ name: 'Second edit' }));
  await page.waitForFunction(() => window.saveAttempts === 2 && !window.editor.busy);
  await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(() => window.saveAttempts), 2, 'the next edit allows one new attempt');
  assert.equal(await page.getByRole('alert').textContent(), 'Browser storage is full.');

  await page.evaluate(async () => { window.allowSave = true; await window.editor.save(); });
  await page.waitForFunction(() => !window.editor.dirty);
  assert.equal(await page.evaluate(() => window.saveAttempts), 3, 'manual Save retries while background autosave is paused');
  assert.equal(await page.getByRole('alert').textContent(), '');
  await page.evaluate(() => window.editor.change({ name: 'After recovery' }));
  await page.waitForFunction(() => window.saveAttempts === 4 && !window.editor.dirty);
  assert.equal(await page.evaluate(() => window.editor.state.name), 'After recovery');

  await page.evaluate(() => window.setExternalBusy(true));
  await page.waitForFunction(() => window.editor.locked);
  await page.evaluate(() => window.editor.change({ name: 'Before switching' }));
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.saveAttempts), 4, 'external navigation pauses background autosave');
  assert.equal(await page.evaluate(() => window.snapshot.busy), false, 'external locking does not masquerade as an editor operation');
  await page.evaluate(() => window.snapshot.flush());
  await page.waitForFunction(() => !window.editor.dirty);
  assert.equal(await page.evaluate(() => window.editor.state.revision), 4, 'navigation flush installs the saved revision before the next operation');

  await page.evaluate(() => { window.allowSave = false; window.editor.change({ name: 'Keep after failed switch' }); });
  await page.waitForFunction(() => window.editor.dirty);
  const flushError = await page.evaluate(async () => { try { await window.snapshot.flush(); } catch (error) { return error.message; } });
  assert.equal(flushError, 'Browser storage is full.', 'flush propagates failures to stop navigation');
  assert.equal(await page.evaluate(() => window.editor.state.name), 'Keep after failed switch');
  assert.equal(await page.evaluate(() => window.editor.dirty), true);
  assert.deepEqual(errors, []);
  console.log('PASS: autosave failure pause/recovery, external navigation locking, revision-aware flush and failure propagation.');
} finally {
  await browser?.close();
  await server.close();
}
