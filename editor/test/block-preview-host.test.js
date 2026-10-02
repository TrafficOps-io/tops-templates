import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProject,validateValues} from '@trafficops/template-runtime';
import {memoryFolderHost} from './support/folder-host.js';
import {createBlockEditScope,blockScopeValueTargets,setBlockScopeValue,assertBlockDraftScope} from '../../packages/template-editor-shell/src/block-edit-scope.js';

test('Studio preview metadata authorizes one repeated leaf, preserves defaults, and accounts for hidden/shared consumers', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'DOMParser');
  Object.defineProperty(globalThis,'DOMParser',{configurable:true,value:class {
    parseFromString(source) { return {querySelectorAll:() => [],documentElement:{outerHTML:source}}; }
  }});
  t.after(() => { if (previous) Object.defineProperty(globalThis,'DOMParser',previous); else delete globalThis.DOMParser; });
  const files = {
    'index.tpl':`@type Row\n@param body String = "Default body"\n@endtype\n@param title String = "Shared heading"\n@param show Boolean = false\n@param rows Row[]\n@block row(item: Row, heading: String)\n<article data-block="Row"><h2>{{heading}}</h2><p>{{item.body}}</p></article>\n@endblock\n@layout\n<section data-block="List">\n@each item in rows:\n@render row(item,title)\n@endeach\n@if show\n<aside data-block="Hidden">{{title}}</aside>\n@endif\n</section>\n@endlayout`,
    'other.tpl':'@layout\n<footer>{{title}}</footer>\n@endlayout',
  };
  const rawValues = {rows:[{},{}]};
  const host = await memoryFolderHost({language:'en',files,values:rawValues,ai:{}});
  const state = await host.project.open(), frame = await host.livePreview.render(state,{locale:'en',page:'index.html'});
  assert.ok(frame.selection?.token);
  assert.equal(frame.selection.blockInstances.filter(instance => instance.label === 'Row').length,2);
  const first = frame.selection.blockInstances.find(instance => instance.label === 'Row');
  const values = validateValues(parseProject(files).definition,rawValues);
  const scope = createBlockEditScope({...frame.selection,page:frame.page,locale:'en',selectedInstanceIds:[first.id]},{files,rawValues,values});
  assert.deepEqual(blockScopeValueTargets(scope),['/rows/0/body']);
  const next = setBlockScopeValue(scope,rawValues,['rows',0,'body'],'Updated body');
  assert.deepEqual(next,{rows:[{body:'Updated body'},{}]});
  assertBlockDraftScope(scope,{files,rawValues:next});
  assert.throws(() => setBlockScopeValue(scope,rawValues,['title'],'Other heading'),/shared outside the selection/);
  assert.throws(() => setBlockScopeValue(scope,rawValues,['rows',1,'body'],'Other row'),/shared outside the selection/);
  const exportFiles = (await host.analyzer.render(state,{locale:'en'}));
  assert.doesNotMatch(exportFiles['index.html'],/data-tops-block-instance/);
  const withoutAi = await memoryFolderHost({language:'en',files,values:rawValues});
  assert.equal((await withoutAi.livePreview.render(await withoutAi.project.open(),{locale:'en'})).selection,undefined);
});
