import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import formatter from '@trafficops/template-language/formatter';
import { registerTplFormatting } from '@trafficops/template-editor-monaco/formatting';
import { TPL_LANGUAGE_ID } from '@trafficops/template-editor-monaco/language';
import { starterProject } from '../src/starter.js';
import { getDefaults, parseTemplate, renderTemplate } from '@trafficops/template-runtime';

function registration() {
  const calls = []; let disposed = 0;
  const monaco = { languages: { registerDocumentFormattingEditProvider(id, provider) { calls.push({ id, provider }); return { dispose() { disposed++; } }; } } };
  const disposable = registerTplFormatting(monaco, { getDialect: () => ({ schema: 1, id: 'safe-html-v1' }) });
  return { monaco, calls, provider: calls[0].provider, disposable, disposed: () => disposed };
}
function model(source) {
  const lines = source.split('\n');
  const range = { startLineNumber: 1, startColumn: 1, endLineNumber: lines.length, endColumn: lines.at(-1).length + 1 };
  return { version: 1, disposed: false, getValue: () => source, getVersionId() { return this.version; }, isDisposed() { return this.disposed; }, getFullModelRange: () => range, setValue() { assert.fail('A formatting provider must not reset the model or its Undo history'); } };
}
const options = { tabSize: 2, insertSpaces: true };
async function formatted(source, settings = options) {
  const { provider } = registration();
  const edits = await provider.provideDocumentFormattingEdits(model(source), settings);
  return edits[0]?.text ?? source;
}
const normalizeHtml = html => html
  .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${css.replace(/\s*([{}:;,])\s*/g, '$1').replace(/;}/g, '}').trim()}</style>`)
  .replace(/>\s+</g, '><').trim();

test('registers both dialect providers and returns a disposable that permits clean registration again', () => {
  const state = registration();
  assert.equal(state.calls[0].id, TPL_LANGUAGE_ID);
  assert.equal(registerTplFormatting(state.monaco, { getDialect: () => ({ schema: 1, id: 'safe-html-v1' }) }), state.disposable);
  assert.equal(state.calls.length, 2);
  state.disposable.dispose(); state.disposable.dispose();
  assert.equal(state.disposed(), 2);
  assert.notEqual(registerTplFormatting(state.monaco, { getDialect: () => ({ schema: 1, id: 'safe-html-v1' }) }), state.disposable);
  assert.equal(state.calls.length, 4);
});

test('Format Document returns one full-document TextEdit without changing the model', async () => {
  const source = '@section content "Content"\n@param title String = "Hello"\n@endsection\n@layout\n<main><h1>{{title}}</h1></main>\n@endlayout';
  const input = model(source), { provider } = registration();
  const edits = await provider.provideDocumentFormattingEdits(input, options);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].range, input.getFullModelRange());
  assert.equal(edits[0].text, await formatter.formatDocument(source, options));
  assert.match(edits[0].text, /@section content "Content"\n  @param title/);
  assert.match(edits[0].text, /@layout\n  <main>\n    <h1>/);
  assert.equal(input.getValue(), source);
  assert.equal(input.getVersionId(), 1);
});

test('respects Monaco tabSize/insertSpaces and retains existing line endings', async () => {
  const source = '@layout\r\n<div><h1>Title</h1></div>\r\n@endlayout\r\n';
  const tabs = await formatted(source, { tabSize: 4, insertSpaces: false });
  assert.match(tabs, /\r\n\t<div>\r\n\t\t<h1>/);
  assert.equal(/(?<!\r)\n/.test(tabs), false);
  const spaces = await formatted(source, { tabSize: 4, insertSpaces: true });
  assert.match(spaces, /\r\n    <div>\r\n        <h1>/);
});

test('returns no edit for no-ops, cancelled requests, disposed models or newer typing', async () => {
  const { provider } = registration(), source = '@layout\n<div><h1>Title</h1></div>\n@endlayout';
  const canonical = await formatted(source);
  assert.deepEqual(await provider.provideDocumentFormattingEdits(model(canonical), options), []);
  assert.deepEqual(await provider.provideDocumentFormattingEdits(model(source), options, { isCancellationRequested: true }), []);
  const closed = model(source); closed.disposed = true;
  assert.deepEqual(await provider.provideDocumentFormattingEdits(closed, options), []);
  const edited = model(source), stale = provider.provideDocumentFormattingEdits(edited, options); edited.version++;
  assert.deepEqual(await stale, []);
  const closing = model(source), pendingClose = provider.provideDocumentFormattingEdits(closing, options); closing.disposed = true;
  assert.deepEqual(await pendingClose, []);
  const token = { isCancellationRequested: false }, pendingCancel = provider.provideDocumentFormattingEdits(model(source), options, token); token.isCancellationRequested = true;
  assert.deepEqual(await pendingCancel, []);
});

test('both starter templates already use stable two-space DSL and HTML indentation', async () => {
  for (const blank of [true, false]) {
    const source = starterProject(blank)['index.tpl'];
    assert.equal(await formatted(source), source);
    assert.match(source, /@section [^\n]+\n  @param /);
    assert.match(source, /@layout\n  <!doctype html>\n  <html lang="en">\n    <head>/);
    assert.ok(!/^\t/m.test(source));
    const definition = parseTemplate(source), compact = source.split('\n').map(line => line.trimStart()).join('\n');
    assert.deepEqual(getDefaults(parseTemplate(compact)), getDefaults(definition));
    assert.equal(normalizeHtml(renderTemplate(parseTemplate(compact))), normalizeHtml(renderTemplate(definition)));
  }
});

const semanticSource = `@template "Format semantics" version=1
@section content "Content"
@param title String = "A & B" required
@param accent Color = "#e75d45"
@param enabled Boolean = true
@param body Markdown = "**Strong** text"
@endsection
@type Card
@param title String = "One" required
@endtype
@param cards Card[] min_items=1 max_items=3
@block card(item: Card)
<article><h2>{{item.title}}</h2></article>
@endblock
@layout
<html lang="{locale}"><head><title>{{title}}</title><style>body{color:{{accent}}}</style></head><body>
<h1>{{title}}</h1><div>{{& body}}</div>
<form action="{actions.submit}"><a href="/search?q={query.q}">Search</a></form>
@if enabled
@each item in cards:
@render card(item)
@endeach
@endif
<pre>  first\n    second  </pre><textarea> first\n  last </textarea>
</body></html>
@endlayout
`;
const semanticContext = { locale: 'en-GB', query: { q: 'A & B' }, actions: { submit: '/submit' } };

test('formatting preserves JS schema, defaults, safe runtime tokens and rendered page semantics', async () => {
  const result = await formatted(semanticSource);
  assert.equal(await formatted(result), result, 'idempotent');
  assert.ok(!result.includes('tplfmtx'), 'no placeholders escape');
  for (const token of ['{locale}', '{actions.submit}', '{query.q}', '{{& body}}']) assert.ok(result.includes(token));
  for (const tag of ['pre', 'textarea']) {
    const body = text => text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
    assert.equal(body(result), body(semanticSource));
  }
  const before = parseTemplate(semanticSource), after = parseTemplate(result);
  assert.deepEqual(before.sections, after.sections);
  assert.deepEqual(getDefaults(before), getDefaults(after));
  assert.equal(normalizeHtml(renderTemplate(before, {}, semanticContext)), normalizeHtml(renderTemplate(after, {}, semanticContext)));
});

test('preserves literal declaration strings, raw bodies and complete multiline comments', async () => {
  const declaration = '@param title String = "<script>const x=1;</script>" help="Keep  two spaces"';
  const comment = '<!-- Keep  these spaces\n  {locale} {{title}}\n @not_a_directive\n  <script>const x=1;</script>\n-->';
  const pre = '\n  first\n    <b> second </b>\n\n last  \n';
  const source = `@section content\n${declaration}\n@endsection\n@layout\n${comment}\n<pre>${pre}</pre><textarea>${pre}</textarea>\n<script>const message='Keep  spaces';const raw=String.raw\`line\\n  next\`;</script>\n@endlayout`;
  const result = await formatted(source);
  assert.ok(result.includes(declaration)); assert.ok(result.includes(comment));
  assert.ok(result.includes(`<pre>${pre}</pre>`)); assert.ok(result.includes(`<textarea>${pre}</textarea>`));
  assert.ok(result.includes("'Keep  spaces'")); assert.ok(result.includes('String.raw`line\\n  next`'));
  assert.equal(await formatted(result), result);
});

const php = process.env.PHP_BINARY || 'php';
const autoload = process.env.TEMPLATE_DSL_TEST_AUTOLOAD || fileURLToPath(new URL('../../vendor/autoload.php', import.meta.url));
const phpAvailable = existsSync(autoload) && spawnSync(php, ['-v'], { encoding: 'utf8' }).status === 0;
test('formatted safe-dialect templates retain PHP defaults and rendered semantics', { skip: phpAvailable ? false : 'PHP and Composer dependencies are optional for editor-only tests' }, async () => {
  const helper = fileURLToPath(new URL('../../runtime/test/php-render.php', import.meta.url));
  const render = source => {
    const response = spawnSync(php, [helper], { input: JSON.stringify({ source, context: semanticContext }), encoding: 'utf8', timeout: 15000 });
    assert.ifError(response.error); assert.equal(response.status, 0, response.stderr);
    const parsed = JSON.parse(response.stdout); assert.equal(parsed.ok, true, parsed.error); return parsed;
  };
  const before = render(semanticSource), after = render(await formatted(semanticSource));
  assert.deepEqual(before.defaults, after.defaults);
  assert.equal(normalizeHtml(before.html), normalizeHtml(after.html));
});

test('unknown descriptors and dialect changes during formatting never apply edits', async () => {
  const state = registration(), input = model('@layout\n<div><h1>Title</h1></div>\n@endlayout');
  let descriptor = { schema: 1, id: 'safe-html-v1' };
  registerTplFormatting(state.monaco, { getDialect: () => descriptor });
  const pending = state.provider.provideDocumentFormattingEdits(input, options);
  descriptor = { schema: 1, id: 'fast-landings-v1' };
  assert.deepEqual(await pending, []);
  descriptor = { schema: 2, id: 'safe-html-v1' };
  assert.deepEqual(await state.provider.provideDocumentFormattingEdits(input, options), []);
  descriptor = { schema: 1, id: 'safe-html-v1' };
  const closing = state.provider.provideDocumentFormattingEdits(input, options);
  state.disposable.dispose();
  assert.deepEqual(await closing, []);
});
