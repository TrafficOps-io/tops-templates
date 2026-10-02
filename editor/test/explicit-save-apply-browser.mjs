import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Applying a conversation draft on an explicit-save host (embedded PW Apps: capabilities.autosave false) changes only
// the working copy: no implicit save of the draft or of the user's unsaved edits. Autosaving hosts still persist it.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const entry = '/explicit-save-apply-test.js';
const script = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { useEditorProject } from '/packages/template-editor-shell/src/useEditorProject.js';
  const autosave = new URLSearchParams(location.search).get('autosave') === '1';
  window.saves = [];
  const state = {name:'Initial', revision:1, files:{'index.html':'<h1>Initial</h1>', 'notes.md':'Saved notes'}, folders:[], locale:'en', translations:{en:{title:'Saved title'}}, entrypoint:'index.html', availability:{inlinePreview:false}, actions:[], history:[]};
  window.run = {id:'run-apply', state:'ready', locale:'en', base:state, result:{valid:true, files:{...state.files, 'index.html':'<h1>AI draft</h1>'}, values:{title:'AI title'}}};
  const host = {
    capabilities:{autosave, inlinePreview:false},
    project:{open:async()=>state, save:async value=>{ window.saves.push(value); return {...value, revision:value.revision+1}; }},
    analyzer:{analyze:async()=>({definition:null,entrypoint:'index.html',sourceDiagnostics:[],diagnostics:[]}), render:async()=>({})}
  };
  function Harness(){
    const editor=useEditorProject(host,()=>{},false);
    window.editor=editor;
    return React.createElement('div',{id:'save-state'},editor.dirty?'Unsaved':'Saved');
  }
  createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const server = await createServer({
  configFile: false, root: resolve('.'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'explicit-save-apply-test',
    resolveId(id) { if (id === entry) return entry; },
    load(id) { if (id === entry) return script; },
    configureServer(vite) {
      vite.middlewares.use('/', (request, response, next) => {
        if (!/^\/(\?|$)/.test(request.url)) return next();
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
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

  await page.goto(origin + '/');
  await page.waitForFunction(() => window.editor?.state);
  await page.evaluate(() => window.editor.change({ files: { ...window.editor.state.files, 'notes.md': 'Unsaved notes' } }));
  await page.evaluate(() => window.editor.applyConversationDraft(window.run));
  await page.waitForFunction(() => window.editor.state.files['index.html'] === '<h1>AI draft</h1>');
  const explicit = await page.evaluate(() => ({ saves: window.saves.length, dirty: window.editor.dirty, state: window.editor.state }));
  assert.equal(explicit.saves, 0, 'an explicit-save host is not saved by Apply');
  assert.equal(explicit.dirty, true, 'applied changes remain unsaved edits');
  assert.equal(explicit.state.translations.en.title, 'AI title');
  assert.equal(explicit.state.files['notes.md'], 'Unsaved notes', 'unsaved user edits are kept in the working copy');
  assert.deepEqual(explicit.state.appliedAiRuns, ['run-apply']);
  assert.equal(await page.locator('#save-state').textContent(), 'Unsaved');
  await page.evaluate(() => window.editor.applyConversationDraft(window.run));
  assert.equal(await page.evaluate(() => window.saves.length), 0, 'repeated Apply stays idempotent and unsaved');
  await page.evaluate(() => window.editor.save());
  const saved = await page.evaluate(() => window.saves);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].files['index.html'], '<h1>AI draft</h1>', 'Save draft persists the applied changes');

  await page.goto(origin + '/?autosave=1');
  await page.waitForFunction(() => window.editor?.state);
  await page.evaluate(() => window.editor.applyConversationDraft(window.run));
  await page.waitForFunction(() => !window.editor.dirty && window.editor.state.revision === 2);
  assert.equal(await page.evaluate(() => window.saves.at(-1).translations.en.title), 'AI title', 'an autosaving host still persists Apply');
  assert.deepEqual(errors, []);
  console.log('PASS: Apply on an explicit-save host updates only the working copy; autosaving hosts persist it.');
} finally {
  await browser?.close();
  await server.close();
}
