/** Install the real tarball outside the monorepo and execute its public binaries. */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
  const template = path.join(consumer,'template'); await mkdir(template);
  await writeFile(path.join(template,'index.tpl'),'@param title String\n@param body Markdown\n@layout\n<h1>{{title}}</h1>{{& body}}\n@endlayout');
  await writeFile(path.join(consumer,'data.json'),'{"title":"Installed tarball","body":"**Safe** <script>bad()</script>"}');
  const output = path.join(consumer,'generated');
  run(process.execPath,[executable,'--template',template,'--data',path.join(consumer,'data.json'),'--output',output],consumer);
  const html = await readFile(path.join(output,'index.html'),'utf8'); assert.match(html,/<h1>Installed tarball<\/h1>/); assert.match(html,/<strong>Safe<\/strong>/); assert.doesNotMatch(html,/<script>/);
  console.log(`Installed ${metadata.filename} in an isolated consumer; version and generation passed.`);
} finally { await rm(temporary,{recursive:true,force:true}); }
