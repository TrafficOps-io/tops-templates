import test from 'node:test';
import assert from 'node:assert/strict';
import {generateEditorPreview, generateProject, indexEditorBlocks, validateEditorBlockFragment} from '../src/index.js';

const withoutInstances = html => html.replace(/ data-tops-block-instance="[^"]*"/g,'');
const paths = instance => instance.valuePaths.map(path => JSON.stringify(path)).sort();

test('editor catalog preserves original UTF-16/CRLF ranges and ignores declarations and dynamic markers', () => {
  const source = `@template "😀"\r\n@param rich Wysiwyg = "<div data-block='metadata'>x</div>"\r\n@previewData\r\n{"rich":"<p data-block='json'>x</p>"}\r\n@endpreviewData\r\n@layout\r\n<section data-block="Comment &amp; 1">\r\n<p>😀</p>\r\n</section>\r\n<div data-block="{{rich}}">dynamic</div>\r\n<div data-block={{rich}}>dynamic</div>\r\n<article data-block="broken">\r\n@endlayout`;
  const blocks = indexEditorBlocks({'index.tpl':source});
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].label,'Comment & 1');
  assert.equal(blocks[0].start,source.indexOf('<section'));
  assert.equal(blocks[0].end,source.indexOf('</section>') + '</section>'.length);
  assert.equal(blocks[0].content,source.slice(blocks[0].start,blocks[0].end));
  assert.match(blocks[0].content,/\r\n/);
});

test('ordinary unquoted static block attributes retain selection IDs and original export markup', () => {
  const files = {'index.tpl':'@layout\n<form data-block=order_form><input data-block=order_field></form>\n@endlayout'};
  const sources = indexEditorBlocks(files);
  assert.deepEqual(sources.map(source => source.label),['order_form','order_field']);
  assert.equal(sources[0].content,'<form data-block=order_form><input data-block=order_field></form>');
  const preview = generateEditorPreview(files);
  assert.equal(preview.blockInstances.length,2);
  for (const instance of preview.blockInstances) assert.ok(preview.files['index.html'].includes(`data-tops-block-instance="${instance.id}"`));
  assert.equal(withoutInstances(preview.files['index.html']),generateProject(files)['index.html']);
  assert.equal(validateEditorBlockFragment('<form data-block=order_form>Updated</form>','order_form'),true);
  assert.equal(validateEditorBlockFragment('<form data-block=order_form data-block=other>Updated</form>','order_form'),false);
});

test('editor preview distinguishes same labels and nested consumers without altering export or input', () => {
  const files = {'index.tpl':`@param title String\n@layout\n<section data-block="Same"><h1>{{title}}</h1><div data-block="Same">{{title}}</div></section>\n@endlayout`};
  const original = structuredClone(files), preview = generateEditorPreview(files,{title:'Welcome'});
  assert.deepEqual(files,original);
  assert.equal(preview.blockSources.length,2);
  const [parent,child] = preview.blockInstances;
  assert.notEqual(parent.sourceId,child.sourceId);
  assert.equal(child.parentId,parent.id);
  assert.deepEqual(parent.valuePaths,[['title']]);
  assert.deepEqual(preview.valueUses.filter(use => !use.control).map(use => use.instanceIds),[[parent.id],[child.id]]);
  assert.equal(withoutInstances(preview.files['index.html']),generateProject(files,{title:'Welcome'})['index.html']);
  assert.doesNotMatch(preview.files['index.html'],/data-tops-source-/);
  assert.doesNotMatch(generateProject(files,{title:'Welcome'})['index.html'],/data-tops-block-instance/);
});

test('nested named repeaters and @render preserve absolute per-item argument paths', () => {
  const source = `@type Reply\n@param body String\n@endtype\n@type Comment\n@param name String\n@param replies Reply[]\n@endtype\n@param comments Comment[]\n@block reply(item: Reply, owner: String)\n<p data-block="Reply" title="{{owner}}">{{item.body}}</p>\n@endblock\n@block comment(item: Comment)\n<article data-block="Comment">\n<h2>{{item.name}}</h2>\n@each reply in item.replies:\n@render reply(reply, item.name)\n@endeach\n</article>\n@endblock\n@layout\n@each comment in comments:\n@render comment(comment)\n@endeach\n@endlayout`;
  const preview = generateEditorPreview({'index.tpl':source},{comments:[{name:'Ada',replies:[{body:'One'},{body:'Two'}]},{name:'Ben',replies:[{body:'Three'}]}]});
  const comments = preview.blockInstances.filter(instance => instance.label === 'Comment');
  const replies = preview.blockInstances.filter(instance => instance.label === 'Reply');
  assert.equal(comments.length,2);
  assert.equal(replies.length,3);
  assert.deepEqual(paths(replies[1]),[JSON.stringify(['comments',0,'name']),JSON.stringify(['comments',0,'replies',1,'body'])].sort());
  assert.equal(replies[1].parentId,comments[0].id);
  assert.deepEqual(paths(replies[2]),[JSON.stringify(['comments',1,'name']),JSON.stringify(['comments',1,'replies',0,'body'])].sort());
  assert.equal(replies[2].parentId,comments[1].id);
  assert.equal(new Set(preview.blockInstances.map(instance => instance.id)).size,preview.blockInstances.length);
});

test('Mustache groups/repeaters, parent paths and root paths keep precise Values provenance', () => {
  const source = `@type Item\n@param name String\n@endtype\n@type Group\n@param name String\n@param items Item[]\n@endtype\n@param title String\n@param group Group\n@layout\n{{#group}}\n<section data-block="Group">{{name}}\n{{#items}}<p data-block="Item">{{name}}/{{../name}}/{{@root.title}}</p>{{/items}}\n</section>\n{{/group}}\n@endlayout`;
  const preview = generateEditorPreview({'index.tpl':source},{title:'Root',group:{name:'Group',items:[{name:'Item'}]}});
  const item = preview.blockInstances.find(instance => instance.label === 'Item');
  assert.deepEqual(paths(item),[['group','items',0,'name'],['group','name'],['title']].map(JSON.stringify).sort());
});

test('reverse usage includes hidden branches, control reads, unmarked consumers and other pages', () => {
  const files = {
    'index.tpl':`@param title String\n@param show Boolean\n@layout\n<section data-block="Visible">{{title}}</section>\n@if show\n<aside>{{title}}</aside>\n@endif\n@unless show\n<div data-block="Inverse">{{title}}</div>\n@endunless\n@endlayout`,
    'other.tpl':`@layout\n<footer>{{title}}</footer>\n@endlayout`,
  };
  const preview = generateEditorPreview(files,{title:'Title',show:false});
  assert.deepEqual(preview.blockInstances.map(instance => instance.label),['Visible','Inverse']);
  const visible = preview.blockInstances.find(instance => instance.label === 'Visible');
  assert.ok(preview.valueUses.some(use => use.path[0] === 'title' && use.instanceIds[0] === visible.id));
  assert.ok(preview.valueUses.some(use => use.path[0] === 'title' && use.page === 'index.html' && !use.instanceIds.length));
  assert.ok(preview.valueUses.some(use => use.path[0] === 'title' && use.page === 'other.html' && !use.instanceIds.length));
  assert.ok(preview.valueUses.some(use => use.path[0] === 'show' && use.control));
  for (const instance of preview.blockInstances) assert.ok(preview.valueUses.some(use => use.instanceIds.includes(instance.id)));
});

test('hidden marked consumers resolve to their visible parent or conservatively remain unowned', () => {
  const source = `@param title String\n@param show Boolean\n@layout\n<section data-block="Parent">\n<p>{{title}}</p>\n@if show\n<aside data-block="Hidden child">{{title}}</aside>\n@endif\n</section>\n@if show\n<footer data-block="Hidden outside">{{title}}</footer>\n@endif\n@endlayout`;
  const preview = generateEditorPreview({'index.tpl':source},{title:'Text',show:false});
  assert.equal(preview.blockInstances.length,1);
  const parent = preview.blockInstances[0], visibleIds = new Set(preview.blockInstances.map(instance => instance.id));
  assert.ok(preview.valueUses.every(use => use.instanceIds.every(id => visibleIds.has(id))));
  assert.ok(preview.valueUses.some(use => use.path[0] === 'title' && use.instanceIds[0] === parent.id));
  assert.ok(preview.valueUses.some(use => use.path[0] === 'title' && !use.instanceIds.length));
});

test('included blocks use original included ranges and duplicate include occurrences stay distinct', () => {
  const image = Uint8Array.of(1,2,3);
  const files = {'index.tpl':`@param title String\n@layout\n@include "shared/card.tpl"\n@include "shared/card.tpl"\n@endlayout`,'shared/card.tpl':'<section data-block="Card">{{title}}</section>','assets/image.png':image};
  const preview = generateEditorPreview(files,{title:'Card'});
  assert.equal(preview.blockSources.length,1);
  assert.equal(preview.blockSources[0].path,'shared/card.tpl');
  assert.equal(preview.blockSources[0].start,0);
  assert.equal(preview.blockSources[0].content,files['shared/card.tpl']);
  assert.equal(preview.blockInstances.length,2);
  assert.notEqual(preview.blockInstances[0].id,preview.blockInstances[1].id);
  assert.equal(preview.files['assets/image.png'],image);
});

test('identical shared block declarations remain compatible across multiple pages', () => {
  const block = '@block shared()\n<section data-block="Shared">Contents</section>\n@endblock\n';
  const files = {'index.tpl':block + '@layout\n@render shared()\n@endlayout','other.tpl':block + '@layout\n@render shared()\n@endlayout'};
  const preview = generateEditorPreview(files);
  assert.equal(preview.blockSources.length,2);
  assert.equal(preview.blockInstances.length,2);
  assert.equal(preview.blockInstances[0].sourceId,preview.blockInstances[1].sourceId);
  for (const [page,html] of Object.entries(generateProject(files))) assert.equal(withoutInstances(preview.files[page]),html);
});

test('catalog rejects inferred root closes and ranges crossing rendering declarations', () => {
  const files = {'index.tpl':`@block first()\n<div data-block="Cross">\n@endblock\n@block second()\n</div>\n@endblock\n@layout\n<p data-block="Implicit">Text<div>Nested</div></p>\n@endlayout`};
  assert.deepEqual(indexEditorBlocks(files),[]);
});

test('nested provenance work is bounded even when ordinary rendering is small', () => {
  const content = '<section data-block="Nested">'.repeat(400) + '{{title}}'.repeat(400) + '</section>'.repeat(400);
  const files = {'index.tpl':`@param title String\n@layout\n${content}\n@endlayout`};
  assert.doesNotThrow(() => generateProject(files,{title:'x'}));
  assert.throws(() => generateEditorPreview(files,{title:'x'}),/provenance exceeds its operation budget/);
});

test('rich text and runtime values cannot fabricate selectable source blocks or Values paths', () => {
  const files = {'index.tpl':'@param copy Wysiwyg\n@layout\n<section data-block="Copy">{{& copy}} {query.q}</section>\n@endlayout'};
  const preview = generateEditorPreview(files,{copy:'<p data-block="Forged">{{copy}}</p>'},{query:{q:'<section data-block="Runtime">'}});
  assert.equal(preview.blockInstances.length,1);
  assert.deepEqual(preview.blockInstances[0].valuePaths,[['copy']]);
  assert.deepEqual(preview.valueUses.map(use => use.path),[['copy']]);
  assert.match(preview.files['index.html'],/&lt;section data-block=&quot;Runtime&quot;&gt;/);
});

test('fragment validation retains one complete static marked root and supports void roots', () => {
  assert.equal(validateEditorBlockFragment('  <article data-block="Comment 1">Updated</article>\n','Comment 1'),true);
  assert.equal(validateEditorBlockFragment('<input data-block="Field" value="ok">','Field'),true);
  assert.equal(validateEditorBlockFragment('<article data-block="Comment 1">Unclosed','Comment 1'),false);
  assert.equal(validateEditorBlockFragment('<article data-block="Other">Updated</article>','Comment 1'),false);
  assert.equal(validateEditorBlockFragment('<article data-block="{{label}}">Updated</article>','{{label}}'),false);
  assert.equal(validateEditorBlockFragment('<article data-block="Comment 1">Updated</article><aside>Outside</aside>','Comment 1'),false);
  assert.equal(validateEditorBlockFragment('<article data-block="Comment 1" data-block="Other">Updated</article>','Comment 1'),false);
});
