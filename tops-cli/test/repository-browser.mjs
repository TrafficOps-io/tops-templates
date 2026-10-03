// A bundle made by the public CLI, moved to a separate static host, then used in real Landing Studio.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, readFile, rename, rm, realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {editorReady, installFolderPicker, readOpfs, usePicker} from '../../editor/test/support/studio-folders.js';

const require = createRequire(import.meta.url), {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const studio = path.resolve(process.argv[2] || 'editor/dist');
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tops-repository-browser-')));
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.zip':'application/zip', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json'};
const servers = [];
async function serve(root, cors = false) {
  const server = createServer(async (request, response) => {
    if (cors) response.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(root + path.sep)) throw new Error('Invalid path');
      const contents = await readFile(filename);
      response.writeHead(200, {'Content-Type':types[path.extname(filename)] || 'application/octet-stream'}); response.end(contents);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const run = (...args) => execFileSync(process.execPath, [cli, ...args], {cwd:temporary, encoding:'utf8', timeout:30000});
let browser;
try {
  const source = path.join(temporary, 'source'), repository = path.join(temporary, 'repository');
  await mkdir(path.join(source, 'images'), {recursive:true}); await mkdir(path.join(source, 'empty-assets'));
  const template = '@section content "Content"\n@param headline String = "Default" label="Headline"\n@endsection\n@layout\n<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CLI template</title></head><body><h1>{{ headline }}</h1><img src="images/logo.svg" alt="Local logo"></body></html>\n@endlayout\n';
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#345678"/></svg>';
  await writeFile(path.join(source, 'offer.tpl'), template); await writeFile(path.join(source, 'images/logo.svg'), logo);
  await writeFile(path.join(temporary, 'values.json'), JSON.stringify({headline:'Published with the CLI'}));
  run('repo', 'init', repository, '--name', 'CLI browser repository', '--author', 'CLI test');
  run('repo', 'add', repository, '--path', source, '--name', 'CLI offer', '--data', path.join(temporary, 'values.json'));
  run('repo', 'bundle', repository);
  const hosted = path.join(temporary, 'hosted'); await rename(path.join(repository, 'dist'), hosted);
  await rm(source, {recursive:true}); await rm(repository, {recursive:true});
  const [base, external] = await Promise.all([serve(studio), serve(hosted, true)]);
  browser = await chromium.launch({headless:true, ...(process.platform === 'darwin' ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
  const context = await browser.newContext(); await installFolderPicker(context);
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?studio=1`);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  const settings = page.getByRole('region', {name:'Template repositories', exact:true});
  await settings.getByLabel('Repository index URL').fill(`${external}/index.json`);
  await settings.getByRole('button', {name:'Add repository', exact:true}).click();
  await settings.getByRole('article', {name:'CLI browser repository', exact:true}).waitFor();
  await page.getByRole('button', {name:'Back to projects', exact:true}).click();
  await page.getByRole('tab', {name:'Templates', exact:true}).click();
  const group = page.getByRole('region', {name:'CLI browser repository', exact:true});
  const card = group.locator('.library-thumbnail'); await card.scrollIntoViewIfNeeded();
  await card.frameLocator('iframe').getByRole('heading', {name:'Published with the CLI', exact:true}).waitFor();
  await group.getByRole('button', {name:'Use CLI offer', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'New project', exact:true});
  await dialog.getByLabel('Project name', {exact:true}).fill('CLI imported project');
  await usePicker(page, 'cli-created-project');
  await dialog.getByRole('button', {name:'Create landing', exact:true}).click();
  await dialog.waitFor({state:'hidden'}); await editorReady(page);
  assert.equal(await readOpfs(page, 'picker/cli-created-project/offer.tpl'), template);
  assert.equal(await readOpfs(page, 'picker/cli-created-project/images/logo.svg'), logo);
  assert.equal(JSON.parse(await readOpfs(page, 'picker/cli-created-project/.trafficops/values.json')).headline, 'Published with the CLI');
  const meta = JSON.parse(await readOpfs(page, 'picker/cli-created-project/.trafficops/project.json'));
  assert.equal(meta.name, 'CLI imported project'); assert.match(meta.sourceTemplateId, /^repository:/);
  assert.ok(await page.evaluate(async () => {
    const storage = await navigator.storage.getDirectory(), picker = await storage.getDirectoryHandle('picker');
    const project = await picker.getDirectoryHandle('cli-created-project'); return Boolean(await project.getDirectoryHandle('empty-assets'));
  }));
  assert.deepEqual(errors, []);
  console.log('PASS: installed-format CLI bundle survives relocation/source deletion, serves its non-index preview cross-origin, and creates a Studio project with source, values, local assets and empty folders.');
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await rm(temporary, {recursive:true, force:true});
}
