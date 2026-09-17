import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTemplate, parseProject, getDefaults, validateValues, renderTemplate, generateProject, safePath} from '../src/index.js';

const template = `@template "Campaign" version=1 description="A campaign"
@section content "Content"
@param headline String = "Welcome" required
@param featured Boolean = true
@param destination Url = "https://example.com/start"
@param image Image = "assets/hero.svg"
@param alignment Select = "left" options="left:Left aligned|center:Centered"
@endsection
@type Card
@param title String required
@param copy Text = "Details"
@endtype
@param cards Card[] min_items=1 max_items=3
@block card(item: Card, heading: String)
<article><h2>{{item.title}}</h2><p>{{item.copy}}</p><small>{{heading}}</small></article>
@endblock
@layout
<!doctype html><html><head><title>Campaign</title></head><body>
<h1>{{headline}}</h1>
@if featured
<a href="{{destination}}">Start</a><img src="{{image}}" alt="{{headline}}">
@endif
@each item in cards:
@render card(item, headline)
@endeach
</body></html>
@endlayout`;

test('parses metadata, defaults, sections, typed blocks, repeaters and safe scalar output', () => {
  const definition = parseTemplate(template);
  assert.equal(definition.name, 'Campaign');
  assert.equal(definition.sections[0].id, 'content');
  const defaults = getDefaults(definition);
  assert.deepEqual(defaults.cards, [{title:'', copy:'Details'}]);
  assert.equal(defaults.alignment, 'left');
  const html = renderTemplate(definition, {...defaults, headline:'<Campaign>', cards:[{title:'A & B'}]});
  assert.match(html, /<h1>&lt;Campaign&gt;<\/h1>/);
  assert.match(html, /<h2>A &amp; B<\/h2>/);
  assert.match(html, /<p>Details<\/p>/);
  assert.match(html, /<small>&lt;Campaign&gt;<\/small>/);
  assert.doesNotMatch(html, /@(?:each|render)/);
});

test('single pass: setting values and runtime values are never scanned again', () => {
  const def = parseTemplate('@param title String\n@layout\n<p>{{title}}</p><span>{query.q}</span>\n@endlayout');
  const html = renderTemplate(def, {title:'{{title}} {query.q} @render nope()'}, {query:{q:'{{title}} <script>'}});
  assert.match(html, /\{\{title\}\} \{query.q\} @render nope\(\)/);
  assert.match(html, /<span>\{\{title\}\} &lt;script&gt;<\/span>/);
});

test('nested loops retain outer aliases and block arguments have lexical scope', () => {
  const def = parseTemplate(`@type Reply
@param body String
@endtype
@type Comment
@param name String
@param replies Reply[]
@endtype
@param comments Comment[]
@block reply(item: Reply, owner: String)
<p>{{owner}}: {{item.body}}</p>
@endblock
@layout
@each comment in comments
@each reply in comment.replies:
@render reply(reply, comment.name)
@endeach
@endeach
@endlayout`);
  assert.match(renderTemplate(def, {comments:[{name:'Ada', replies:[{body:'Hello'}]}]}), /Ada: Hello/);
  assert.throws(() => parseTemplate('@param title String\n@block hidden()\n{{title}}\n@endblock\n@layout\n@render hidden()\n@endlayout'), /Unknown expression/);
});

test('Mustache groups, repeaters, inversion and parent/root paths', () => {
  const def = parseTemplate(`@type Item
@param name String
@endtype
@param title String = "Root"
@param items Item[]
@layout
{{#items}}<p>{{name}} {{../title}} {{@root.title}}</p>{{/items}}
{{^items}}Empty{{/items}}
@endlayout`);
  assert.match(renderTemplate(def, {items:[{name:'One'}]}), /One Root Root/);
  assert.match(renderTemplate(def, {}), /Empty/);
});

test('project shares declarations across pages, resolves nested includes and keeps asset bytes', () => {
  const asset = Uint8Array.of(0,1,255);
  const files = {'index.tpl':'@include "shared/fields.tpl"\n@layout\n<h1>{{title}}</h1>\n@endlayout', 'shared/fields.tpl':'@include "types.tpl"\n@param title String = "Home"', 'shared/types.tpl':'@type Card\n@param text String\n@endtype', 'thanks.tpl.html':'@layout\n<p>Thanks, {{title}}</p>\n@endlayout', 'assets/image.png':asset};
  const project = parseProject(files);
  assert.equal(project.pages.length, 2);
  assert.equal(project.definition.entrypoint, 'index.html');
  const output = generateProject(files, {title:'Ada'});
  assert.deepEqual(Object.keys(output).sort(), ['assets/image.png','index.html','thanks.html']);
  assert.equal(output['assets/image.png'], asset);
  assert.match(output['thanks.html'], /Thanks, Ada/);
});

test('types, fields, values and bounds are validated with actionable errors', () => {
  assert.throws(() => parseTemplate('@param a Missing\n@layout\nX\n@endlayout'), /Unknown type/);
  assert.throws(() => parseTemplate('@type A\n@param a A\n@endtype\n@param a A\n@layout\nX\n@endlayout'), /Recursive type/);
  assert.throws(() => parseTemplate('@param a String min=2\n@layout\nX\n@endlayout'), /does not apply/);
  assert.throws(() => parseTemplate('@param a String\n@layout\n@each i in a\nX\n@endeach\n@endlayout'), /requires a repeater/);
  const definition = parseTemplate(template);
  assert.throws(() => validateValues(definition, {}), /cards\[0\].title is required/);
  assert.throws(() => validateValues(definition, {unlisted:'x'}), /Unknown field/);
  assert.throws(() => validateValues(definition, {cards:[]}), /needs 1–3 items/);
  assert.throws(() => validateValues(definition, {cards:[{title:'x'}], destination:'javascript:alert(1)'}), /HTTP\(S\)/);
  assert.throws(() => validateValues(definition, {cards:[{title:'x'}], image:'../secret.png'}), /Unsafe project path/);
});

test('rejects recursive, unknown and incorrectly typed block calls', () => {
  assert.throws(() => parseTemplate('@block a()\n@render a()\n@endblock\n@layout\n@render a()\n@endlayout'), /Recursive/);
  assert.throws(() => parseTemplate('@layout\n@render missing()\n@endlayout'), /Unknown block/);
  assert.throws(() => parseTemplate('@param title String\n@block b(n: Number)\n{{n}}\n@endblock\n@layout\n@render b(title)\n@endlayout'), /expects Number/);
});

test('blocks include traversal, include cycles, unsafe keys and output collisions', () => {
  for (const path of ['../x', '/x', 'a//b', 'a/./b', '.env', 'a\\b', 'a:%20', '__proto__']) assert.throws(() => safePath(path), /Unsafe/);
  assert.throws(() => parseTemplate('@include "../secret.tpl"\n@layout\nX\n@endlayout', {resolveInclude:() => ''}), /Unsafe/);
  assert.throws(() => parseTemplate('@include "index.tpl"\n@layout\nX\n@endlayout', {resolveInclude:() => '@include "index.tpl"'}), /cycle/);
  assert.throws(() => parseTemplate('@param constructor String\n@layout\nX\n@endlayout'), /Invalid field/);
  assert.throws(() => generateProject({'index.tpl':'@layout\nX\n@endlayout','index.html':'keep'}), /collision/);
  assert.throws(() => parseTemplate('@template "Old" version=2\n@layout\nX\n@endlayout'), /version 1/);
});

test('safe runtime tokens escape text, encode URL components, and restrict actions', () => {
  const def = parseTemplate('@layout\n<p>{query.q} {locale}</p><a href="/search?q={query.q}">Search</a><form action="{actions.submit}"></form>\n@endlayout');
  const html = renderTemplate(def, {}, {query:{q:'<x>&a=1'}, locale:'en-GB', actions:{submit:'/submit'}});
  assert.match(html, /&lt;x&gt;&amp;a=1 en-GB/);
  assert.match(html, /href="\/search\?q=%3Cx%3E%26a%3D1"/);
  assert.match(html, /action="\/submit"/);
  assert.throws(() => renderTemplate(def, {}, {headers:{secret:'x'}}), /only accepts/);
  assert.throws(() => renderTemplate(def, {}, {actions:{submit:'http://example.com/'}}), /Unsafe action/);
  for (const html of ['<a href="{query.q}">X</a>', '<a href="https://{query.q}/">X</a>', '<p>{actions.go}</p>', '<a href="/prefix{actions.go}">X</a>']) assert.throws(() => renderTemplate(parseTemplate(`@layout\n${html}\n@endlayout`), {}, {query:{q:'test'}, actions:{go:'/go'}}));
});

test('refuses dynamic executable HTML contexts and URL schemes', () => {
  for (const html of ['<script>const x="{{value}}"</script>', '<style>x{color:{{value}}}</style>', '<img onerror="{{value}}">', '<p style="{{value}}">X</p>', '<a href={{value}}>X</a>', '<!-- {{value}} -->', '<{{value}}>X</{{value}}>']) {
    const def = parseTemplate(`@param value String\n@layout\n${html}\n@endlayout`);
    assert.throws(() => renderTemplate(def, {value:'alert(1)'}), undefined, html);
  }
  const def = parseTemplate('@param value String\n@layout\n<a href="{{value}}">X</a>\n@endlayout');
  for (const value of ['javascript:alert(1)','data:text/html,x','//evil.test','\\evil.test','java\nscript:x']) assert.throws(() => renderTemplate(def, {value}), /Unsafe URL/);
});

test('unsupported formatting of plain strings and JSON partials fail explicitly; escaped directives and CSS survive', () => {
  assert.throws(() => parseTemplate('@param body String\n@layout\n{{& body}}\n@endlayout'), /requires a Markdown/);
  assert.throws(() => parseTemplate('@layout\n{{>partial}}\n@endlayout'), /not supported/);
  const def = parseTemplate('@layout\n<style>\n@media (max-width: 600px) { body { margin: 0; } }\n</style>\n@@literal\n@endlayout');
  assert.match(renderTemplate(def), /@media/);
  assert.match(renderTemplate(def), /@literal/);
});

test('quote-aware scanner rejects attribute and rawtext boundary bypasses', () => {
  for (const expression of ['{{value}}','{query.q}']) {
    for (const html of [`<a title=">" href="${expression}">X</a>`, `<button title=">" onclick="${expression}">X</button>`, `<script>const fake="</style>"; ${expression}</script>`, `<a title='>' href='${expression}'>X</a>`, `<script data-x=">">${expression}</script>`]) {
      const definition = parseTemplate(`@param value String\n@layout\n${html}\n@endlayout`);
      assert.throws(() => renderTemplate(definition,{value:'javascript:alert(1)'},{query:{q:'javascript:alert(1)'}}), undefined, html);
    }
  }
  const escapedScript = parseTemplate('@layout\n<script>\n<!--<script>\n// </script>\n{query.q}\n</script>\n@endlayout');
  assert.throws(() => renderTemplate(escapedScript,{},{query:{q:'alert(1)'}}),/Legacy escaped/);
});

test('title/textarea escape text and typed CSS accepts only Color/Number/Range', () => {
  const definition = parseTemplate('@param text String\n@param accent Color = "#abcdef"\n@param size Number = 14\n@layout\n<title>{{text}}</title><textarea>{{text}}</textarea><style>body{color:{{accent}};font-size:{{size}}px}</style><p style="--accent:{{accent}}">X</p>\n@endlayout');
  const output = renderTemplate(definition,{text:'</title><script>alert(1)</script>'});
  assert.match(output, /<title>&lt;\/title&gt;&lt;script&gt;/);
  assert.match(output, /color:#abcdef;font-size:14px/);
  assert.match(output, /style="--accent:#abcdef"/);
  assert.throws(() => renderTemplate(parseTemplate('@layout\n<style>body{color:{query.q}}</style>\n@endlayout'),{},{query:{q:'red'}}), /CSS interpolation/);
});

test('rich text uses a bounded sanitizer and never evaluates embedded template syntax', () => {
  const definition = parseTemplate('@param markdown Markdown\n@param html Wysiwyg\n@layout\n<section>{{& markdown}}</section><section>{{& html}}</section>\n@endlayout');
  const output = renderTemplate(definition,{markdown:'# Hello\n\n**Strong** {{html}} {query.q}\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))',html:'<p onclick="alert(1)">Safe <strong>text</strong></p><img src="assets/a.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Bad</a>'});
  assert.match(output, /<h1>Hello<\/h1>/);
  assert.match(output, /<strong>Strong<\/strong> \{\{html\}\} \{query.q\}/);
  assert.match(output, /<img src="assets\/a.png"/);
  assert.doesNotMatch(output,/onclick|onerror|<script|javascript:/);
  for (const html of ['<div title="{{& body}}">X</div>', '<title>{{& body}}</title>', '<script>{{& body}}</script>']) assert.throws(() => renderTemplate(parseTemplate(`@param body Wysiwyg\n@layout\n${html}\n@endlayout`),{body:'<b>Hi</b>'}));
  assert.throws(() => renderTemplate(parseTemplate('@param body Wysiwyg required\n@layout\n{{& body}}\n@endlayout'),{body:'<p><br></p>'}), /required/);
});

test('include-only entries retain output names; output paths cannot collide by case or hierarchy', () => {
  const output = generateProject({'index.tpl':'@include "parts/layout.tpl"','parts/layout.tpl':'@layout\nHello\n@endlayout'});
  assert.deepEqual(Object.keys(output), ['index.html']);
  assert.throws(() => generateProject({'index.tpl':'@layout\nHello\n@endlayout','index.html/image.png':new Uint8Array()}),/collision/);
  assert.throws(() => generateProject({'index.tpl':'@layout\nHello\n@endlayout','INDEX.tpl':'@layout\nHello\n@endlayout'}),/collision/);
});

test('negative numeric defaults, color defaults, required whitespace and falsey zero match PHP', () => {
  const definition = parseTemplate('@param number Number max=-1\n@param color Color\n@param name String required\n@layout\n@if name\n{{number}} {{color}}\n@endif\n@endlayout');
  assert.equal(getDefaults(definition).number,-1);
  assert.equal(getDefaults(definition).color,'#000000');
  assert.throws(() => validateValues(definition,{name:'   '}),/required/);
  assert.equal(renderTemplate(definition,{name:'0'}),'');
});

test('default generation rejects multiplicative repeaters before allocating their full tree', () => {
  const source = '@type A\n@param title String\n@endtype\n@type B\n@param items A[] min_items=50\n@endtype\n@type C\n@param items B[] min_items=50\n@endtype\n@type D\n@param items C[] min_items=50\n@endtype\n@param items D[] min_items=50\n@layout\nX\n@endlayout';
  const definition = parseTemplate(source);
  assert.throws(() => getDefaults(definition),/Default values exceed/);
  assert.throws(() => renderTemplate(definition),/Default values exceed/);
});
