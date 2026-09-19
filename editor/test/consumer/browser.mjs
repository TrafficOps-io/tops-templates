import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(process.argv[2] || 'dist');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname, file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();const bytes=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[extname(file)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}), errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const dialect of ['trusted','unknown','schema']){
  await page.goto(`http://127.0.0.1:${server.address().port}/?dialect=${dialect}`);
  await page.getByRole('button',{name:'index.tpl.php',exact:true}).click();
  await page.locator('.monaco-editor textarea').waitFor();
  const expected=dialect==='trusted'?'trafficops-tpl-trusted':'trafficops-tpl-plain';
  await page.waitForFunction(language=>window.editorModels().some(model=>model.language===language),expected);
  assert.equal(await page.getByRole('tab',{name:'AI assistant',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Publish',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Download landing',exact:true}).count(),0);
  assert.equal(await page.locator('.browser-frame iframe').count(),0);
  assert.equal(await page.getByRole('button',{name:'Format',exact:true}).count(),dialect==='trusted'?1:0);
  await page.getByRole('button',{name:'Create file or folder',exact:true}).click();await page.getByRole('menuitem',{name:'New file',exact:true}).click();
  await page.getByRole('combobox').fill('notes.txt');await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.hosted-heading').textContent.includes('Unsaved'));
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: clean tarball consumer and third host; trusted DSL, unknown ID/schema plain mode; create/save still work; unavailable AI/publication/HTML export and PHP preview remain gated.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
