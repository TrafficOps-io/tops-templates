/** Install the real tarball outside the monorepo and execute its public binaries. */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';

const packageDirectory = fileURLToPath(new URL('../',import.meta.url));
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(),'trafficops-pack-')));
function run(command,args,cwd) {
  const result = spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,npm_config_update_notifier:'false',npm_config_cache:path.join(temporary,'npm-cache')}});
  assert.ifError(result.error); assert.equal(result.status,0,result.stderr || result.stdout); return result.stdout;
}
try {
  const packed = run('npm',['pack','--json','--pack-destination',temporary],packageDirectory);
  const match = packed.match(/\[\s*\{[\s\S]*\}\s*\]\s*$/); assert.ok(match,packed);
  const metadata = JSON.parse(match[0])[0];
  assert.ok(metadata.files.some((file) => file.path === 'dist/cli.js'));
  assert.ok(!metadata.files.some((file) => file.path.startsWith('src/') || file.path.includes('../runtime')));
  const consumer = path.join(temporary,'consumer'); await mkdir(consumer); await writeFile(path.join(consumer,'package.json'),'{"private":true,"type":"module"}');
  run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--omit=dev',path.join(temporary,metadata.filename)],consumer);
  const executable = path.join(consumer,'node_modules','@trafficops','cli','dist','cli.js');
  assert.equal(run(process.execPath,[executable,'--version'],consumer).trim(),'0.1.0');
  const installedPackage = JSON.parse(await readFile(path.join(path.dirname(executable),'..','package.json'),'utf8'));
  for (const [name,version] of Object.entries(installedPackage.dependencies)) {
    assert.ok(!/^(?:workspace:|file:|link:)/.test(version), `Private workspace dependency in published package: ${name}`);
  }
  const {unzipSync} = createRequire(executable)('fflate');
  const template = path.join(consumer,'template'); await mkdir(template);
  const source = '@param title String\n@param body Markdown\n@layout\n<h1>{{title}}</h1>{{& body}}\n@endlayout';
  await writeFile(path.join(template,'index.tpl'),source);
  await writeFile(path.join(template,'styles.css'),'body { color: #123456; }');
  await writeFile(path.join(consumer,'data.json'),'{"title":"Installed tarball","body":"**Safe** <script>bad()</script>"}');
  const output = path.join(consumer,'generated');
  run(process.execPath,[executable,'--template',template,'--data',path.join(consumer,'data.json'),'--output',output],consumer);
  const html = await readFile(path.join(output,'index.html'),'utf8'); assert.match(html,/<h1>Installed tarball<\/h1>/); assert.match(html,/<strong>Safe<\/strong>/); assert.doesNotMatch(html,/<script>/);
  const repository = path.join(consumer,'team-templates');
  run(process.execPath,[executable,'repo','init',repository,'--name','Installed repository','--description','Built from the npm artifact','--author','Test team','--homepage','https://example.com/templates'],consumer);
  const thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>';
  await writeFile(path.join(consumer,'preview.svg'),thumbnail);
  run(process.execPath,[executable,'repo','add','--path',template,'--name','Launch page','--description','Portable source and preview','--version','2.3.0','--thumbnail',path.join(consumer,'preview.svg'),'--data',path.join(consumer,'data.json')],repository);
  const manifest = JSON.parse(await readFile(path.join(repository,'repository.json'),'utf8'));
  assert.deepEqual(manifest.repository,{name:'Installed repository',description:'Built from the npm artifact',author:'Test team',homepage:'https://example.com/templates'});
  assert.equal(manifest.templates[0].id,'launch-page');
  assert.equal(await readFile(path.join(repository,'templates','launch-page','index.tpl'),'utf8'),source);

  // A repository holds a snapshot, independent of the template's original directory.
  await writeFile(path.join(template,'index.tpl'),'@layout\n<h1>Changed original</h1>\n@endlayout');
  run(process.execPath,[executable,'repo','bundle'],repository);
  const bundled = path.join(repository,'dist');
  const index = JSON.parse(await readFile(path.join(bundled,'index.json'),'utf8'));
  assert.equal(index.schemaVersion,1); assert.equal(index.templates.length,1);
  const entry = index.templates[0];
  assert.equal(entry.name,'Launch page'); assert.equal(entry.version,'2.3.0');
  assert.equal(entry.description,'Portable source and preview');
  for (const key of ['archive','preview','thumbnail']) {
    assert.equal(typeof entry[key],'string',`${key} is present`);
    assert.ok(!/^(?:[a-z]+:|[\\/])/.test(entry[key]) && !entry[key].split('/').includes('..'),`${key} is portable`);
  }
  const zip = await readFile(path.join(bundled,entry.archive));
  assert.equal(createHash('sha256').update(zip).digest('hex'),entry.sha256);
  const files = unzipSync(zip);
  assert.equal(Buffer.from(files['index.tpl']).toString(),source);
  assert.equal(Buffer.from(files['styles.css']).toString(),'body { color: #123456; }');
  assert.deepEqual(JSON.parse(Buffer.from(files['.trafficops/values.json']).toString()),JSON.parse(await readFile(path.join(consumer,'data.json'),'utf8')));
  const preview = await readFile(path.join(bundled,entry.preview),'utf8');
  assert.match(preview,/<h1>Installed tarball<\/h1>/);
  assert.match(preview,/<strong>Safe<\/strong>/); assert.doesNotMatch(preview,/<script>|Changed original/);
  assert.equal(await readFile(path.join(bundled,path.dirname(entry.preview),'styles.css'),'utf8'),'body { color: #123456; }');
  assert.equal(await readFile(path.join(bundled,entry.thumbnail),'utf8'),thumbnail);
  assert.match(await readFile(path.join(bundled,'_headers'),'utf8'),/Access-Control-Allow-Origin: \*/);

  const rebuild = spawnSync(process.execPath,[executable,'repo','bundle'],{cwd:repository,encoding:'utf8',timeout:120000});
  assert.ifError(rebuild.error); assert.notEqual(rebuild.status,0); assert.match(rebuild.stderr,/--force/);
  await writeFile(path.join(bundled,'keep.txt'),'Unrelated hosting file');
  run(process.execPath,[executable,'repository','bundle',repository,'--output',bundled,'--force'],consumer);
  assert.equal(await readFile(path.join(bundled,'keep.txt'),'utf8'),'Unrelated hosting file');
  assert.deepEqual(await readFile(path.join(bundled,entry.archive)),zip,'Unchanged template produces a deterministic ZIP');
  console.log(`Installed ${metadata.filename} in an isolated consumer; version, generation and repository init/add/bundle passed.`);
} finally { await rm(temporary,{recursive:true,force:true}); }
