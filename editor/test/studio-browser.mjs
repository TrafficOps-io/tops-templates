import { workspaceUrl } from './support/workspace-url.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { installFolderPicker, usePicker } from './support/studio-folders.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { zipSync, strToU8, unzipSync } = require('fflate');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };
const server = createServer(async (req,res) => { try { const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); const file=resolve(join(root,path==='/'?'index.html':path)); if(!file.startsWith(root+'/'))throw Error('path'); const value=await readFile(file); res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}); res.end(value); } catch {res.writeHead(404);res.end('Not found');} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1600,height:1100}}); await installFolderPicker(context);
 const page=await context.newPage(), errors=[];
 let blockedProviderCalls=0;
 await page.route('https://openrouter.ai/**',route=>{blockedProviderCalls++;return route.abort();});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(workspaceUrl(`http://127.0.0.1:${server.address().port}`));
 await usePicker(page,'browser-test');
 await page.getByRole('button', { name: 'New project', exact: true }).first().click();
 await page.getByRole('dialog',{name:'New project'}).getByRole('button',{name:'From template',exact:true}).click();
 await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Browser test');
 await page.getByRole('button', { name: 'Create landing', exact: true }).click();
 await page.locator('.browser-frame iframe.is-visible').waitFor();
 await page.getByRole('tablist',{name:'Authoring mode'}).getByRole('tab',{name:'Content',exact:true}).click();
 // Section tabs flag fields that need attention with a text badge, not a glyph.
 const identity=page.getByRole('tab',{name:/^Identity/});
 assert.equal((await identity.innerText()).includes('\u26a0'),false);
 await page.locator('#setting-brand').fill('');
 await identity.getByText(/\d+ issues/).waitFor();
 await page.locator('#setting-brand').fill('STUDIO / 01');
 await page.waitForFunction(()=>![...document.querySelectorAll('[role=tab]')].some(tab=>/\d+ issues/.test(tab.textContent)));
 // Section tabs follow the WAI-ARIA tabs keyboard pattern: arrows move selection and focus, Home/End jump to the ends.
 {
  const tabs=page.getByRole('tablist',{name:'Sections',exact:true}).getByRole('tab'), count=await tabs.count();
  assert.ok(count>=2,'a landing has several sections, got '+count);
  const state=()=>page.evaluate(()=>{const list=document.querySelector('[role=tablist][aria-label=Sections]'),all=[...list.querySelectorAll('[role=tab]')];return{selected:all.findIndex(tab=>tab.getAttribute('aria-selected')==='true'),focused:all.indexOf(document.activeElement)};});
  await tabs.first().click(); await tabs.first().focus();
  assert.deepEqual(await state(),{selected:0,focused:0});
  await page.keyboard.press('ArrowRight'); assert.deepEqual(await state(),{selected:1,focused:1});
  await page.keyboard.press('ArrowRight'); assert.deepEqual(await state(),{selected:0,focused:0},'ArrowRight wraps from the last section');
  await page.keyboard.press('End'); assert.deepEqual(await state(),{selected:count-1,focused:count-1});
  await page.keyboard.press('Home'); assert.deepEqual(await state(),{selected:0,focused:0});
  await page.keyboard.press('ArrowLeft'); assert.deepEqual(await state(),{selected:count-1,focused:count-1},'ArrowLeft wraps from the first section');
  await page.keyboard.press('Home');
 }
 // Icon and toolbar buttons keep a 32px target even in the dense desktop layout.
 const shortButtons=await page.locator('.preview-panel .btn, .file-sidebar .btn, .studio-toolbar .btn').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height>0&&node.getBoundingClientRect().height<32).map(node=>node.className));
 assert.deepEqual(shortButtons,[]);
 // Panel minimums follow the studio spec: dragging both separators far left stops at 192 / 320 and leaves the preview 288.
 {
  const drag=async(selector,to)=>{const box=await page.locator(selector).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(to,box.y+box.height/2,{steps:8});await page.mouse.up();};
  await drag('.resizer-0',0); await drag('.resizer-1',0);
  assert.ok(Number(await page.locator('.resizer-0').getAttribute('aria-valuenow'))>=192,'sidebar keeps at least 192px');
  assert.ok(Number(await page.locator('.resizer-1').getAttribute('aria-valuenow'))>=320,'author panel keeps at least 320px');
  assert.ok((await page.locator('.preview-panel').boundingBox()).width>=288,'preview keeps at least 288px');
  await page.locator('.resizer-0').dblclick();
 }
 // An empty tree shows a state, but one with folders still lists them (rendered directly: Studio never lets a project drop index.tpl).
 {
  const { build }=require('esbuild');
  const entry=`import { createRoot } from 'react-dom/client'; import ProjectSidebar from './packages/template-editor-shell/src/ProjectSidebar.jsx';
   const noop=()=>{}; const props={ active:'', onSelect:noop, onCreate:noop, onRename:noop, onDelete:noop, onMove:noop, onUpload:noop, onToggleCollapsed:noop, isCollapsed:false };
   window.mountSidebar=(files,folders)=>createRoot(document.querySelector('#sidebar-mount')).render(<ProjectSidebar {...props} files={files} folders={folders} />);`;
  const bundle=await build({ stdin:{ contents:entry, resolveDir:resolve('.'), sourcefile:'sidebar-entry.jsx', loader:'jsx' }, bundle:true, write:false, platform:'browser', format:'iife', target:'chrome120', jsx:'automatic', loader:{ '.css':'empty' }, define:{ 'process.env.NODE_ENV':'"production"' } });
  const harness=await browser.newPage(); await harness.setContent('<div id="sidebar-mount"></div>'); await harness.addScriptTag({ content:bundle.outputFiles[0].text });
  await harness.evaluate(()=>window.mountSidebar({},[])); await harness.getByText('No files yet',{exact:true}).waitFor();
  assert.equal(await harness.getByRole('status').filter({hasText:'No files yet'}).count(),1);
  await harness.evaluate(()=>window.mountSidebar({},['empty-folder'])); await harness.getByText('empty-folder',{exact:true}).waitFor();
  assert.equal(await harness.getByText('No files yet').count(),0);
  await harness.close();
 }
 assert.equal(await page.getByRole('button',{name:'Manage project folders',exact:true}).count(),0);
 // Browser tabs open a project in the same full-height workspace as the installed app: no site header or footer,
 // no expand mode, and only the panels scroll.
 assert.equal(await page.locator('.topbar').count(),0); assert.equal(await page.locator('.site-footer').count(),0);
 assert.equal(await page.getByRole('button',{name:'Expand editor',exact:true}).count(),0);
 const box=await page.locator('.editor-shell').boundingBox(); assert.equal(box.x,0);assert.equal(box.y,0);assert.equal(box.width,1600);assert.equal(box.height,1100);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),1100,'the page itself does not scroll');
 await page.getByRole('button',{name:'Create file or folder',exact:true}).click();
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu',{name:'Create file or folder'}).count(),0);
 // Rename and Delete live on the open file's row.
 await page.getByRole('button',{name:'File actions',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();await page.getByRole('dialog',{name:'Rename file',exact:true}).waitFor();
 // The nested dialog takes modality: the panes and separators behind it are inert.
 assert.equal(await page.locator('.file-sidebar').getAttribute('inert'),'');assert.equal(await page.locator('.panel-resizer.resizer-1').getAttribute('inert'),'');
 for(let step=0;step<3;step++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('.studio-dialog'))),true);}
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.file-sidebar').getAttribute('inert'),null);assert.equal(await page.locator('.panel-resizer.resizer-1').getAttribute('inert'),null);
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='File actions');
 await page.getByRole('button',{name:'Mobile preview',exact:true}).click();assert.ok(Math.abs((await page.locator('.browser-frame').boundingBox()).width-375)<1);
 await page.locator('.editor-shell').screenshot({path:'/tmp/studio-shell-browser.png'});
 // The installed app is a permanent workspace, including while settings open.
 await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
 await page.reload(); await page.locator('.library').waitFor();
 await page.getByRole('button',{name:'Open Browser test',exact:true}).click(); await page.locator('.editor-shell.is-app').waitFor();
 assert.equal(await page.getByRole('button',{name:'Collapse editor',exact:true}).count(),0);
 await page.keyboard.press('Escape'); assert.equal(await page.locator('.editor-shell.is-app').count(),1);
 await page.getByRole('tab',{name:'Conversations',exact:true}).click();
 await page.getByRole('button',{name:'Set up AI in Settings',exact:true}).click();
 await page.locator('.ai-settings input[type=password]').waitFor();
 assert.equal(await page.getByRole('tab',{name:'Conversations',exact:true}).count(),0,'Settings hides the workspace from the accessibility tree');
 await page.getByRole('button',{name:'Back to project',exact:true}).click();
 assert.equal(await page.getByRole('tab',{name:'Conversations',exact:true}).getAttribute('aria-selected'),'true','returning from Settings preserves the selected tab');
 async function exportProject(format='source') { await page.getByRole('button',{name:'Export',exact:true}).click(); await page.getByRole('menuitem',{name:format==='source'?/Editable project/:/Landing for hosting/}).click(); await page.getByRole('dialog',{name:'Export',exact:true}).waitFor(); }
 await exportProject();
 await page.getByText('Backup or reopen this editable project in Studio.',{exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();assert.match((await download).suggestedFilename(),/source\.zip$/);
 // A static landing imported for GEO/link edits offers direct authoring actions,
 // rather than empty parameter controls. Both ZIP formats preserve its assets.
 await page.getByRole('button',{name:'Projects',exact:true}).click();
 const staticHtml='<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><h1>Statyczna strona GEO</h1><a href="#offer">Oferta</a><section id="offer">Przykład</section></body></html>';
 await usePicker(page,'static-traffic-page');
 const importChooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Import ZIP',exact:true}).click();
 await(await importChooser).setFiles({name:'Static-traffic-page.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({'index.html':strToU8(staticHtml),'styles.css':strToU8('body { margin: 0; padding: 24px; }')}))});
 await page.getByRole('dialog',{name:'Import Static-traffic-page'}).getByRole('button',{name:'Import as landing',exact:true}).click();
 await page.locator('.browser-frame iframe.is-visible').contentFrame().getByRole('heading',{name:'Statyczna strona GEO',exact:true}).waitFor();
 await page.getByRole('tab',{name:'Content',exact:true}).click();
 await page.getByText('This project has no editable fields.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Reset defaults',exact:true}).count(),0);
 await page.getByRole('button',{name:'Open files',exact:true}).click();
 assert.equal(await page.getByRole('tab',{name:'Code',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:'Content',exact:true}).click();
 await page.getByRole('button',{name:'Open AI assistant',exact:true}).click();
 assert.equal(await page.getByRole('tab',{name:'Conversations',exact:true}).getAttribute('aria-selected'),'true');
 await exportProject();
 await page.getByText('Backup or reopen this editable project in Studio.',{exact:true}).waitFor();
 const sourceDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
 const sourceFiles=unzipSync(new Uint8Array(await readFile(await(await sourceDownload).path())));
 assert.equal(new TextDecoder().decode(sourceFiles['index.html']),staticHtml);
 assert.ok(sourceFiles['styles.css']);
 await exportProject('html');
 await page.getByText('Extract this archive and upload its files to your hosting.',{exact:true}).waitFor();
 const htmlDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
 const htmlFiles=unzipSync(new Uint8Array(await readFile(await(await htmlDownload).path())));
 assert.match(new TextDecoder().decode(htmlFiles['index.html']),/Statyczna strona GEO/);assert.ok(htmlFiles['styles.css']);
 // Coarse pointers get 44px targets on raw daisy .btn-sm / .btn-square controls too.
 {
  const touch=await browser.newContext({viewport:{width:900,height:1000},hasTouch:true,isMobile:true}); await installFolderPicker(touch); const tp=await touch.newPage();
  assert.equal(await tp.evaluate(()=>matchMedia('(pointer: coarse)').matches),true);
  await tp.goto(workspaceUrl(`http://127.0.0.1:${server.address().port}`));
  await tp.evaluate(()=>localStorage.setItem('test-folder-picker','touch-test'));
  await tp.getByRole('button',{name:'New project',exact:true}).first().click();
  await tp.getByRole('dialog',{name:'New project'}).getByRole('button',{name:'From template',exact:true}).click();
  await tp.getByRole('textbox',{name:'Project name',exact:true}).fill('Touch test');
  await tp.getByRole('button',{name:'Create landing',exact:true}).click();
  await tp.locator('.editor-shell').waitFor();
  await tp.getByRole('button',{name:'Projects',exact:true}).first().click();
  await tp.getByRole('button',{name:'Project actions: Touch test',exact:true}).click();
  const duplicate=tp.getByRole('menuitem',{name:'Duplicate Touch test',exact:true}); await duplicate.waitFor();
  const small=await duplicate.boundingBox(); assert.ok(small.width>=44&&small.height>=44,`icon button is ${small.width}x${small.height}`);
  const labelled=await tp.locator('.library .btn-sm:not(.btn-square)').first().boundingBox(); assert.ok(labelled.height>=44,`text button is ${labelled.height}px tall`);
  await touch.close();
 }
 assert.equal(blockedProviderCalls,0,'opening the AI assistant never starts a paid request');
 assert.deepEqual(errors,[]);
 console.log('PASS: folder-first create; browser overlay/focus, permanent PWA workspace and settings, mobile preview, static HTML import→Files/conversations without paid calls, editable backup and hosting ZIP assets.');
} catch(error) { const failed=browser?.contexts()[0]?.pages()[0]; await failed?.screenshot({path:'/tmp/studio-import-export-ui-error.png'}).catch(()=>{}); if(failed)console.error((await failed.locator('body').innerText()).slice(-3500));throw error; } finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
