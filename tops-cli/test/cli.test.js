import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readProject, writeProject} from '../src/io.js';
import {promptsFor} from '../src/tui.js';
import {parseTemplate, getDefaults} from '../../runtime/src/index.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const source = '@param title String = "Welcome" required\n@layout\n<title>{{title}}</title><h1>{{title}}</h1>\n@endlayout';
const run = (args, cwd) => spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',timeout:15000});
async function fixture(t) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(),'tops-cli-test-')));
  t.after(() => rm(temporary,{recursive:true,force:true}));
  const template = path.join(temporary,'template'); await mkdir(template); await writeFile(path.join(template,'index.tpl'),source); await writeFile(path.join(temporary,'data.json'),JSON.stringify({title:'A & B'}));
  return {temporary,template,output:path.join(temporary,'output'),data:path.join(temporary,'data.json')};
}
test('Commander exposes help and version without starting the form', () => {
  const help = run(['--help']); assert.equal(help.status,0,help.stderr); assert.match(help.stdout,/--template/); assert.match(help.stdout,/--data/);
  const version = run(['--version']); assert.equal(version.status,0); assert.equal(version.stdout.trim(),'0.1.0');
});
test('headless generation escapes JSON values and retains binary project assets', async (t) => {
  const {temporary,template,output,data} = await fixture(t); await mkdir(path.join(template,'assets')); await writeFile(path.join(template,'assets','image.png'),Uint8Array.of(0,1,255));
  const result = run(['--template',template,'--data',data,'--output',output],temporary);
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/Generated 2 file/);
  assert.match(await readFile(path.join(output,'index.html'),'utf8'),/<h1>A &amp; B<\/h1>/);
  assert.deepEqual(new Uint8Array(await readFile(path.join(output,'assets','image.png'))),Uint8Array.of(0,1,255));
});
test('existing outputs require --force; a failed preflight preserves all existing content', async (t) => {
  const {temporary,template,output,data} = await fixture(t); await mkdir(output); await writeFile(path.join(output,'index.html'),'Keep this');
  const rejected = run(['--template',template,'--data',data,'--output',output],temporary);
  assert.equal(rejected.status,1); assert.match(rejected.stderr,/--force/); assert.equal(await readFile(path.join(output,'index.html'),'utf8'),'Keep this');
  const forced = run(['--template',template,'--data',data,'--output',output,'--force'],temporary);
  assert.equal(forced.status,0,forced.stderr); assert.match(await readFile(path.join(output,'index.html'),'utf8'),/A &amp; B/);
});
test('file mode follows includes, preserves entry output name, and does not copy unrelated files', async (t) => {
  const {template,temporary,output,data} = await fixture(t); await mkdir(path.join(template,'parts'));
  await writeFile(path.join(template,'index.tpl'),'@param title String\n@include "parts/layout.tpl"');
  await writeFile(path.join(template,'parts','layout.tpl'),'@layout\n<h1>{{title}}</h1>\n@endlayout');
  await writeFile(path.join(template,'private.json'),'not an asset');
  const loaded = await readProject(path.join(template,'index.tpl')); assert.deepEqual(Object.keys(loaded.files).sort(),['index.tpl','parts/layout.tpl']);
  const result = run(['--template',path.join(template,'index.tpl'),'--data',data,'--output',output],temporary);
  assert.equal(result.status,0,result.stderr); assert.match(await readFile(path.join(output,'index.html'),'utf8'),/A &amp; B/);
});
test('noninteractive invocation requires JSON and invalid input creates no output', async (t) => {
  const {template,temporary,output,data} = await fixture(t);
  const noninteractive = run(['--template',template,'--output',output],temporary); assert.equal(noninteractive.status,1); assert.match(noninteractive.stderr,/Provide --data/);
  await writeFile(data,'{"title":" "}'); const invalid = run(['--template',template,'--data',data,'--output',output],temporary); assert.equal(invalid.status,1); assert.match(invalid.stderr,/required/);
  await assert.rejects(readFile(path.join(output,'index.html')),/ENOENT/);
});
test('symlink inputs/outputs and writing into the source project are rejected', async (t) => {
  const {template,temporary,output} = await fixture(t); const outside = path.join(temporary,'outside'); await mkdir(outside); await writeFile(path.join(outside,'secret'),'keep');
  await symlink(outside,path.join(template,'escape')); await assert.rejects(readProject(template),/Symbolic links/); await rm(path.join(template,'escape'));
  await mkdir(output); await symlink(outside,path.join(output,'escape'));
  await assert.rejects(writeProject({'escape/secret':'replace'},output,{force:true}),/Symbolic links/); assert.equal(await readFile(path.join(outside,'secret'),'utf8'),'keep');
  await assert.rejects(writeProject({'index.html':'x'},path.join(template,'generated'),{sourceRoot:template,sourceIsDirectory:true}),/outside the template/);
});
test('Ink prompts recurse into groups and repeaters using normalized field metadata', () => {
  const definition = parseTemplate('@type Card\n@param title String = "Item"\n@param enabled Boolean = true\n@endtype\n@param featured Card\n@param cards Card[] min_items=2 max_items=4\n@layout\nX\n@endlayout');
  const prompts = promptsFor(definition.fields,getDefaults(definition));
  assert.deepEqual(prompts.map((prompt) => prompt.path),[['featured','title'],['featured','enabled'],['cards'],['cards',0,'title'],['cards',0,'enabled'],['cards',1,'title'],['cards',1,'enabled']]);
  assert.equal(prompts[2].count,true); assert.equal(prompts[2].field.max_items,4);
});
