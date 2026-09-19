import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseTemplate, getDefaults, renderTemplate} from '../src/index.js';

const helper = fileURLToPath(new URL('./php-render.php', import.meta.url));
const autoload = process.env.TEMPLATE_DSL_TEST_AUTOLOAD || fileURLToPath(new URL('../../vendor/autoload.php', import.meta.url));
const php = process.env.PHP_BINARY || 'php';
const available = existsSync(autoload) && spawnSync(php, ['-v'], {encoding:'utf8'}).status === 0;
const skip = available ? false : 'Install root Composer dependencies and PHP 8.4+ to run PHP/JavaScript parity fixtures.';
const normalize = (html) => html.replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').trim();

function phpRender(input) {
  const result = spawnSync(php, [helper], {input:JSON.stringify(input), encoding:'utf8', timeout:15000, maxBuffer:2 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function javascriptRender(input) {
  const definition = parseTemplate(input.source, {
    filename:input.filename || 'index.tpl.html',
    resolveInclude:path => input.includes?.[path],
  });
  return {defaults:getDefaults(definition), html:renderTemplate(definition, input.values || {}, input.context || {})};
}
function compare(input, {defaults = false} = {}) {
  const expected = phpRender(input);
  assert.equal(expected.ok, true, expected.error);
  const actual = javascriptRender(input);
  assert.equal(normalize(actual.html), normalize(expected.html));
  if (defaults) assert.deepEqual(actual.defaults, expected.defaults);
}

test('PHP parity: scalar values, conditionals, escaped data and safe runtime URL components', {skip}, () => {
  compare({source:`@template "Parity"
@param title String = "Default"
@param active Boolean = true
@param count Number = 4
@layout
<main><h1>{{title}}</h1>
@if active
<p>Count: {{count}}</p>
@endif
<p>{query.q} / {locale}</p>
<a href="/search?q={query.q}">Search</a>
<form action="{actions.submit}"></form></main>
@endlayout`, values:{title:'A < B & {{count}} {query.q}', active:true, count:12}, context:{query:{q:'A & B <tag>'}, locale:'en-GB', actions:{submit:'/submit'}}}, {defaults:true});
});

test('PHP parity: typed groups, nested repeaters and lexical block arguments', {skip}, () => {
  compare({source:`@type Reply
@param text String
@endtype
@type Card
@param title String
@param replies Reply[]
@endtype
@param featured Card
@param cards Card[]
@block reply(item: Reply, heading: String)
<p>{{heading}}: {{item.text}}</p>
@endblock
@layout
<main><h1>{{featured.title}}</h1>
@each card in cards:
<section><h2>{{card.title}}</h2>
@each item in card.replies:
@render reply(item, card.title)
@endeach
</section>
@endeach
</main>
@endlayout`, values:{featured:{title:'Featured', replies:[]}, cards:[{title:'One & two', replies:[{text:'Reply <A>'},{text:'{query.secret}'}]},{title:'Empty', replies:[]}]}});
});

test('PHP parity: declarations and typed blocks loaded through source includes', {skip}, () => {
  compare({source:`@template "Includes"
@include "shared.tpl"
@layout
<main>
@render heading(title)
</main>
@endlayout`, includes:{'shared.tpl':`@param title String = "Welcome"
@block heading(text: String)
<h1>{{text}}</h1>
@endblock`}, values:{title:'Included & escaped'}}, {defaults:true});
});

test('PHP parity: valid negative numeric defaults, default color and falsey string zero', {skip}, () => {
  compare({source:`@param offset Number max=-1
@param color Color
@param show String
@layout
<p>{{offset}} / {{color}}</p>
@if show
<strong>Visible</strong>
@endif
@endlayout`, values:{show:'0'}}, {defaults:true});
});

test('PHP parity: runtime tokens reject quoted-tag and raw-text context bypasses', {skip}, () => {
  for (const body of [
    '<a title=">" href="{query.q}">Link</a>',
    '<button title=">" onclick="{query.q}">Button</button>',
    '<script>const fake="</style>"; {query.q}</script>',
    '<p>{headers.secret}</p>',
  ]) {
    const input = {source:`@layout\n${body}\n@endlayout`, context:{query:{q:'javascript:alert(1)'}}};
    assert.equal(phpRender(input).ok, false, `PHP must reject ${body}`);
    assert.throws(() => javascriptRender(input), undefined, `JavaScript must reject ${body}`);
  }
});

test('PHP parity: inverse sections preserve their enclosing scope for empty lists and nested fields', {skip}, () => {
  const source = `@type Item
@param title String
@endtype
@param title String
@param items Item[]
@layout
@unless items
<p>Empty: {{title}}</p>
@endunless
@each item in items
@unless item.title
<p>Missing: {{title}}</p>
@endunless
@endeach
@endlayout`;
  compare({source, values: {title: 'Root', items: []}});
  compare({source, values: {title: 'Root', items: [{title: ''}, {title: 'present'}]}});
});
