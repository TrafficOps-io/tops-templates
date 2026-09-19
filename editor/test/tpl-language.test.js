import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { compile } from 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js';
import { MonarchTokenizer } from 'monaco-editor/editor/standalone/common/monarch/monarchLexer.js';
import { TokenizationRegistry } from 'monaco-editor/editor/common/languages.js';
import { language as css } from 'monaco-editor/languages/definitions/css/css.js';
import { tplLanguage, withTemplateExpressions, TPL_LANGUAGE_ID } from '@trafficops/template-editor-monaco/language';
import { languageFor } from '../src/project.js';

// Use Monaco's actual compiler, state machine and embedded-language registry.
// The service stubs supply configuration only; they do not tokenize text.
const service = {
  getLanguageIdByLanguageName: value => value,
  getLanguageIdByMimeType: () => undefined,
  isRegisteredLanguageId: () => true,
  requestBasicLanguageFeatures() {},
};
const configuration = { getValue: () => 100000, onDidChangeConfiguration: () => ({ dispose() {} }) };
const disposables = [];
function provider(id, language) {
  const tokenizer = new MonarchTokenizer(service, {}, id, compile(id, language), configuration);
  disposables.push(tokenizer, TokenizationRegistry.register(id, tokenizer));
  return tokenizer;
}
provider('trafficops-tpl-css', withTemplateExpressions(css, { schema: 1, id: 'safe-html-v1' }));
const tpl = provider(TPL_LANGUAGE_ID, tplLanguage);
after(() => disposables.reverse().forEach(value => value.dispose()));

function tokenize(source, tokenizer = tpl) {
  let state = tokenizer.getInitialState();
  return source.split('\n').map(line => {
    const result = tokenizer.tokenize(line, true, state); state = result.endState;
    return { line, tokens: result.tokens };
  });
}
function tokenAt(line, needle, occurrence = 0) {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) offset = line.line.indexOf(needle, offset + 1);
  assert.ok(offset >= 0, `Missing ${needle} in ${line.line}`);
  return line.tokens.findLast(token => token.offset <= offset)?.type;
}
function has(line, text, expected, occurrence = 0) { assert.equal(tokenAt(line, text, occurrence), expected, `${text} in ${line.line}`); }

test('TPL extensions select the dedicated language without replacing HTML', () => {
  for (const path of ['index.tpl', 'pages/about.tpl.html', 'INDEX.TPL']) assert.equal(languageFor(path), TPL_LANGUAGE_ID);
  assert.equal(languageFor('index.html'), 'html'); assert.equal(languageFor('styles.css'), 'css');
});

test('real Monaco tokenizes declarations, types, options, escaped strings and numeric values', () => {
  const lines = tokenize('@template "Example" version=1\n@param cards Card[] label="Cards" min_items=2 required\n@param size Range = -1.5 min=-2 step=.5\n@block card(item: Card, heading: String)\n@each item in cards:\n@render card(item)');
  has(lines[0], '@template', 'keyword.directive.tpl'); has(lines[0], 'version', 'attribute.name.tpl'); has(lines[0], '1', 'number.tpl');
  has(lines[1], 'cards', 'variable.tpl'); has(lines[1], 'Card[]', 'type.identifier.tpl'); has(lines[1], '[]', 'delimiter.tpl'); has(lines[1], 'required', 'attribute.name.tpl');
  has(lines[2], '-1.5', 'number.tpl'); has(lines[2], '.5', 'number.tpl', 1);
  has(lines[3], 'card', 'entity.name.function.tpl'); has(lines[3], 'item', 'variable.parameter.tpl'); has(lines[3], 'Card', 'type.identifier.tpl');
  has(lines[4], 'in', 'keyword.tpl'); has(lines[5], 'card', 'entity.name.function.tpl');
});

test('all core directives highlight; unknown, inline and escaped directives stay literal', () => {
  for (const line of tokenize('@template\n@section\n@param\n@type\n@block\n@render\n@each\n@if\n@include\n@layout\n@endsection\n@endtype\n@endblock\n@endeach\n@endif\n@endlayout')) has(line, '@', 'keyword.directive.tpl');
  for (const line of tokenize('@@param title String\n  @@render literal()\n@else\n@unknown\n<p>@param title String</p>')) assert.notEqual(tokenAt(line, '@'), 'keyword.directive.tpl');
});

test('expressions and safe runtime paths highlight inside HTML text and quoted attributes', () => {
  const lines = tokenize('<img src="{{header.logo}}" alt=\'{{& title}}\'><b>{{@root.brand}}</b> &amp;\n{{#items}}{{../title}}{{^shown}}x{{/shown}}{{>footer}}{{/items}}\n<a href="{actions.open}">{query.name} {locale}</a>');
  has(lines[0], 'img', 'tag.tpl'); has(lines[0], 'src', 'attribute.name.tpl'); has(lines[0], 'header', 'variable.tpl'); has(lines[0], '.', 'delimiter.tpl'); has(lines[0], '& title', 'operator.tpl'); has(lines[0], 'b>', 'tag.tpl'); has(lines[0], '&amp;', 'string.escape.tpl');
  has(lines[0], '@root', 'variable.predefined.tpl'); has(lines[1], '../', 'operator.tpl'); has(lines[1], 'footer', 'variable.tpl');
  has(lines[2], 'actions', 'variable.predefined.tpl'); has(lines[2], 'query', 'variable.predefined.tpl'); has(lines[2], 'locale', 'variable.predefined.tpl');
});

test('metadata strings and preview JSON remain literal and incomplete expressions recover', () => {
  const lines = tokenize('@param title String = "{{literal}} fake: Type"\n@previewData\n{"title":"{{literal}}","enabled":true,"n":2}\n@endpreviewData\n@layout\n<h1>{{title\n<p>Recovered</p>\n@param title String = "unfinished\n@layout');
  has(lines[0], '{{literal}}', 'string.tpl'); has(lines[0], 'Type', 'string.tpl');
  has(lines[1], '@previewData', 'keyword.directive.tpl'); has(lines[2], '{{literal}}', 'string.tpl'); has(lines[2], 'true', 'keyword.tpl'); has(lines[2], '2', 'number.tpl');
  has(lines[3], '@endpreviewData', 'keyword.directive.tpl'); has(lines[4], '@layout', 'keyword.directive.tpl'); has(lines[6], 'p>', 'tag.tpl'); has(lines[8], '@layout', 'keyword.directive.tpl');
});

test('real Monaco CSS embedding preserves rules and quoted strings around template expressions', () => {
  const lines = tokenize('<style>\n.x { color: {{accent}}; content: "Before {{title}} after"; width: 12px; }\n@media (max-width: 600px) { body { display: none; } }\n</style>\n<p>{{title}}</p>');
  has(lines[1], 'color:', 'attribute.name.css'); has(lines[1], 'accent', 'variable.css'); has(lines[1], 'title', 'variable.css'); has(lines[1], ' after', 'string.css'); has(lines[1], 'width:', 'attribute.name.css');
  assert.notEqual(tokenAt(lines[2], '@media'), 'keyword.directive.tpl');
  has(lines[3], 'style', 'tag.tpl'); has(lines[4], 'p>', 'tag.tpl'); has(lines[4], 'title', 'variable.tpl');
});

test('trusted grammar exposes its request sources, wildcards and validation only in its profile', async () => {
  const { languageForDialect } = await import('@trafficops/template-editor-monaco/language');
  const trusted = provider('trafficops-tpl-trusted', languageForDialect({ schema: 1, id: 'fast-landings-v1' }));
  const source = '@validation body\n@param name String required\n@endvalidation\n{body.name} {headers.user-agent} {query.*} {locale}';
  const lines = tokenize(source, trusted);
  has(lines[0], '@validation', 'keyword.directive.tpl'); has(lines[2], '@endvalidation', 'keyword.directive.tpl');
  has(lines[3], 'body', 'variable.predefined.tpl'); has(lines[3], 'headers', 'variable.predefined.tpl'); has(lines[3], '*', 'variable.tpl');
  assert.notEqual(tokenAt(lines[3], 'locale'), 'variable.predefined.tpl');
  const safe = tokenize(source);
  assert.notEqual(tokenAt(safe[0], '@validation'), 'keyword.directive.tpl');
  assert.notEqual(tokenAt(safe[3], 'body'), 'variable.predefined.tpl');
});
