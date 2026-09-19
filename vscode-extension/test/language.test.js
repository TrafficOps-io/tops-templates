'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIALECTS, DEFAULT_DIALECT, DIALECT_PROFILES, normalizeDialect, parseDocument, buildProject, getCompletions, getDefinition, getHover, getSignatureHelp, getSymbols } = require('@trafficops/template-language');

const URI = 'file:///templates/template.tpl';
const declarations = `@type Avatar
@param src Image help="A reader avatar"
@endtype
@type Comment
@param author String label="Author"
@param avatar Avatar
@param replies Comment[]
@endtype
@type Discussion
@param title String
@param comments Comment[]
@endtype
@section appearance "Appearance"
@param primary Color
@param title String
@endsection
@param comments Comment[]
@param discussion Discussion
@param comment String
@block item(comment: Comment, accent: Color)
<p>{{comment.author}}</p>
@endblock
`;
function fixture(source, extra = [], options = {}) {
  const offset = source.indexOf('§');
  assert.notEqual(offset, -1, 'fixture needs a cursor');
  const text = source.replace('§', '');
  return { project: buildProject([{ uri: URI, text }, ...extra], options), text, offset };
}
function complete(source, extra, options) {
  const result = fixture(source, extra, options);
  return { ...result, items: getCompletions(result.project, URI, result.offset) };
}
const labels = result => result.items.map(item => item.label);
const layout = text => `${declarations}@layout\n${text}\n@endlayout`;

test('directives have complete paired snippets and exact replacement ranges', () => {
  const result = complete('  @pa§ram');
  assert.deepEqual(labels(result), ['@param']);
  assert.equal(result.text.slice(result.items[0].range.start, result.items[0].range.end), '@param');
  assert.match(result.items[0].insertText, /^@param/);
  assert.ok(complete('§').items.find(item => item.label === '@block').insertText.includes('@endblock'));
  assert.ok(!labels(complete('@§')).includes('@else'));
  const existing = complete('@pa§ram title String');
  assert.equal(existing.items[0].insertText, '@param');
  assert.equal(existing.items[0].snippet, false);
});

test('author types, repeatable records and application aliases complete in declarations', () => {
  for (const text of ['@param author §', '@block greet(value: §', '@block greet(value: String, avatar: Av§atar)']) {
    const result = complete(`${declarations}${text}`, [], { customTypes: ['Headline', 'invalid-name'] });
    for (const name of ['String', 'Color', 'Comment', 'Comment[]', 'Avatar', 'Headline']) assert.ok(labels(result).includes(name), `${name} in ${text}`);
    assert.ok(!labels(result).includes('String[]'));
    assert.ok(!labels(result).includes('invalid-name'));
  }
  const array = complete(`${declarations}@param items Com§ment[]`);
  assert.equal(array.text.slice(array.items[0].range.start, array.items[0].range.end), 'Comment[]');
});

test('options follow type and skip existing keys and quoted values', () => {
  assert.deepEqual(labels(complete('@param title String §')), ['label', 'help', 'aiInstructions', 'required', 'default']);
  assert.ok(labels(complete('@param font Range §')).includes('step'));
  assert.ok(!labels(complete('@param title String §')).includes('step'));
  assert.ok(labels(complete('@param mode Select §')).includes('options'));
  assert.ok(labels(complete(`${declarations}@param list Comment[] §`)).includes('min_items'));
  assert.ok(!labels(complete('@param invalid String[] §')).includes('min_items'));
  assert.ok(!labels(complete('@param title String label="Title" §')).includes('label'));
  assert.ok(!labels(complete('@param title String = "Title" §')).includes('default'));
  assert.deepEqual(labels(complete('@param title String label="@pa§ram"')), []);
  assert.deepEqual(labels(complete('@param title String required=t§')), ['true', 'false']);
  assert.deepEqual(labels(complete('@param on Boolean default=§')), ['true', 'false']);
  assert.deepEqual(labels(complete('@param on Boolean = fa§')), ['true', 'false']);
  assert.deepEqual(labels(complete('@param title String required=true default=t§')), []);
  assert.ok(labels(complete('@template "Story" §')).includes('version'));
  const edit = complete('@param title String la§bel="Title"');
  assert.equal(edit.items.find(item => item.label === 'label').insertText, 'label');
});

test('AI instructions complete for fields and blocks, preserve assignments and skip strings or duplicates', () => {
  for (const declaration of ['@param title String', '@param image Image', `${declarations}@param group Comment`, `${declarations}@param list Comment[]`, '@type Record\n@param body Text', '@block item()', '@block item(value: String, count: Number)']) {
    const result = complete(`${declaration} §`);
    const item = result.items.find(item => item.label === 'aiInstructions');
    assert.equal(item.insertText, 'aiInstructions="${1:Instructions for AI}"');
    assert.ok(!labels(complete(`${declaration} aiInstructions="Already set" §`)).includes('aiInstructions'));
    assert.deepEqual(labels(complete(`${declaration} aiInstructions="Keep (this), fake: Str§ing"`)), []);
    assert.deepEqual(labels(complete(`${declaration} aiInstructions=§`)), []);
    const edit = complete(`${declaration} aiInstr§uctions="Keep this"`).items.find(item => item.label === 'aiInstructions');
    assert.equal(edit.insertText, 'aiInstructions');
    assert.equal(edit.snippet, false);
  }
  assert.deepEqual(labels(complete('@block item() §')), ['aiInstructions']);
  assert.ok(!labels(complete('@template "Example" §')).includes('aiInstructions'));
});

test('AI instructions appear in field and block hovers without adding fake block arguments', () => {
  const source = '@type Article\n@param body Text aiInstructions="Keep \\"quotes\\" and {{body}} literal."\n@endtype\n@param article Article aiInstructions=\'Write clearly.\'\n@block item(value: Article) aiInstructions="Explain (briefly), fake: String, other: Article)"\n{{value.body}}\n@endblock\n';
  const project = buildProject([{ uri: URI, text: source }]);
  assert.equal(project.params.get('article').options.aiInstructions, 'Write clearly.');
  assert.equal(project.types.get('Article').fields[0].options.aiInstructions, 'Keep "quotes" and {{body}} literal.');
  assert.deepEqual(project.blocks.get('item').args.map(arg => arg.name), ['value']);
  assert.equal(project.documents.get(URI).references.length, 3);
  for (const [snippet, expected] of [['{{article.bo§dy}}', 'Keep "quotes"'], ['{{arti§cle.body}}', 'Write clearly.'], ['@render it§em(article)', 'Explain (briefly)']]) {
    const result = fixture(`${source}@layout\n${snippet}\n@endlayout`);
    assert.ok(getHover(result.project, URI, result.offset).contents.includes(expected));
  }
  const completion = complete(`${source}@layout\n@render it§`).items.find(item => item.label === 'item');
  assert.ok(completion.documentation.includes('Explain (briefly)'));
  const option = fixture('@param title String aiInstr§uctions="Write clearly."');
  assert.match(getHover(option.project, URI, option.offset).contents, /AI instructions/);
  const string = fixture('@param title String aiInstructions="aiInstr§uctions=value"');
  assert.equal(getHover(string.project, URI, string.offset), null);
});

test('section settings stay at the root and fields never leak there', () => {
  const result = complete(layout('<p>{{§}}</p>'));
  for (const name of ['title', 'primary', 'comments', 'discussion']) assert.ok(labels(result).includes(name));
  for (const name of ['author', 'src', 'appearance', 'avatar']) assert.ok(!labels(result).includes(name));
});

test('members traverse custom records and preserve replacement after the dot', () => {
  const result = complete(layout('<p>{{discussion.ti§tle}}</p>'));
  assert.deepEqual(labels(result), ['title', 'comments']);
  assert.equal(result.text.slice(result.items[0].range.start, result.items[0].range.end), 'title');
  assert.equal(result.text[result.items[0].range.start - 1], '.');
  assert.deepEqual(labels(complete(layout('{{comments.§}}'))), []);
  assert.deepEqual(labels(complete(layout('{{unknown.§}}'))), []);
});

test('block arguments shadow globals and stay inside their block', () => {
  const local = complete(`${declarations}@block local(comment: Comment)\n{{comment.§}}\n@endblock`);
  assert.ok(labels(local).includes('author'));
  assert.deepEqual(labels(complete(`${declarations}@block local(comment: Comment)\n@endblock\n@layout\n{{comment.§}}\n@endlayout`)), []);
  assert.ok(labels(complete(`${declarations}@block local(comment: Comment)\n{{§}}\n@endblock`)).includes('primary'));
});

test('nested loops infer element types, retain outer aliases, and unwind shadowing', () => {
  const nested = complete(layout('@each row in comments:\n@each reply in row.replies:\n{{row.avatar.§}}\n@endeach\n@endeach'));
  assert.deepEqual(labels(nested), ['src']);
  const inner = complete(layout('@each row in comments:\n@each reply in row.replies:\n{{reply.§}}\n@endeach\n@endeach'));
  assert.deepEqual(labels(inner), ['author', 'avatar', 'replies']);
  const ended = complete(layout('@each row in comments:\n@each reply in row.replies:\n@endeach\n{{§}}\n@endeach'));
  assert.ok(labels(ended).includes('row'));
  assert.ok(!labels(ended).includes('reply'));
  const outside = complete(layout('@each comment in comments:\n@endeach\n{{comment.§}}'));
  assert.deepEqual(labels(outside), []);
});

test('loops and block arguments work while a body is incomplete at EOF', () => {
  assert.ok(labels(complete(`${declarations}@block partial(value: Comment)\n{{value.§`)).includes('author'));
  assert.ok(labels(complete(`${declarations}@layout\n@each row in comments:\n{{row.§`)).includes('author'));
});

test('loop aliases do not leak into later block declarations after malformed input', () => {
  const result = complete(`${declarations}@block first()\n@each row in comments:\n@block second()\n{{§}}\n@endblock`);
  assert.ok(!labels(result).includes('row'));
});

test('each sources select arrays and paths to arrays; if excludes arrays', () => {
  const result = complete(layout('@each row in §'));
  assert.ok(labels(result).includes('comments'));
  assert.ok(labels(result).includes('discussion'));
  assert.ok(!labels(result).includes('primary'));
  assert.deepEqual(labels(complete(layout('@each row in discussion.§'))), ['comments']);
  assert.ok(!labels(complete(layout('@if §'))).includes('comments'));
});

test('block names, signatures and positional argument paths use declaration types', () => {
  const name = complete(layout('@render it§'));
  assert.ok(labels(name).includes('item'));
  const call = complete(layout('@each row in comments:\n@render item(§, primary)\n@endeach'));
  assert.ok(labels(call).includes('row'));
  assert.ok(!labels(call).includes('primary'));
  assert.ok(!labels(call).includes('comments'));
  const second = complete(layout('@each row in comments:\n@render item(row, §)\n@endeach'));
  assert.deepEqual(labels(second), ['primary']);
  const help = getSignatureHelp(second.project, URI, second.offset);
  assert.equal(help.label, 'item(comment: Comment, accent: Color)');
  assert.equal(help.activeParameter, 1);
  assert.equal(help.parameters.length, 2);
});

test('definitions and hovers resolve fields, arguments, loop aliases and author types', () => {
  for (const [snippet, expected] of [['{{discussion.tit§le}}', '@param title String'], ['@each row in comments:\n{{ro§w.author}}\n@endeach', '@each row']]) {
    const result = fixture(layout(snippet));
    const definition = getDefinition(result.project, URI, result.offset);
    assert.ok(definition);
    assert.equal(definition.start, result.text.indexOf(expected) + expected.indexOf(' ') + 1);
    assert.ok(getHover(result.project, URI, result.offset));
  }
  const type = fixture(`${declarations}@param object Com§ment`);
  const definition = getDefinition(type.project, URI, type.offset);
  assert.equal(type.text.slice(definition.start, definition.end), 'Comment');
  assert.equal(definition.start, type.text.indexOf('@type Comment') + 6);
  const member = fixture(layout('@each row in comments:\n{{row.avatar.s§rc}}\n@endeach'));
  assert.match(getHover(member.project, URI, member.offset).contents, /A reader avatar/);
  const unknown = fixture('@param object Typ§o');
  assert.match(getHover(unknown.project, URI, unknown.offset).contents, /Unknown field type/);
  const alias = fixture('@param object Head§line', [], { customTypes: ['Headline'] });
  assert.match(getHover(alias.project, URI, alias.offset).contents, /Application-registered field type/);
});

test('project declarations and definitions span only supplied source fragments', () => {
  const fragmentUri = 'file:///templates/blocks/card.tpl';
  const fragment = '@type Card\n@param heading String\n@endtype\n@block card(value: Card)\n{{value.heading}}\n@endblock';
  const result = complete('@include "blocks/card.tpl"\n@param card Card\n@layout\n{{card.§}}\n@endlayout', [{ uri: fragmentUri, text: fragment }]);
  assert.deepEqual(labels(result), ['heading']);
  const use = fixture('@include "blocks/card.tpl"\n@param card Card\n@layout\n{{card.hea§ding}}\n@endlayout', [{ uri: fragmentUri, text: fragment }]);
  assert.equal(getDefinition(use.project, URI, use.offset).uri, fragmentUri);
  const includeOffset = use.text.indexOf('blocks/card') + 2;
  assert.equal(getDefinition(use.project, URI, includeOffset).uri, fragmentUri);
  assert.ok(!labels(complete('@param card Ca§')).includes('Card'));
});

test('ordinary HTML, CSS at-rules, JS strings, escaped at signs do not trigger DSL suggestions', () => {
  for (const source of ['<div cl§ass="x">', '@media§ (width: 20px)', '@§media (width: 20px)', '@§@param', '@@pa§', '<script>const x="@pa§";</script>', '@param text String = "{{tit§le}}"', '@render item("pri§")', '@if title + pri§']) {
    assert.deepEqual(labels(complete(layout(source))), [], source);
  }
});

test('source locations preserve CRLF and non-ASCII text without execution', () => {
  const source = '@template "Заголовок" version=1\r\n@param title String\r\n@layout\r\n{{tit§le}}\r\n@endlayout';
  const result = fixture(source);
  const definition = getDefinition(result.project, URI, result.offset);
  assert.equal(definition.start, result.text.indexOf('title String'));
  assert.equal(result.text.slice(definition.start, definition.end), 'title');
  const parsed = parseDocument(URI, '@include "blocks/комментарий.tpl"\r\n');
  assert.equal(parsed.includes[0].path, 'blocks/комментарий.tpl');
  assert.equal('@include "blocks/комментарий.tpl"\r\n'.slice(parsed.includes[0].start, parsed.includes[0].end), parsed.includes[0].path);
});

test('real article example provides nested fields, loop declarations, symbols and signatures', () => {
  const text = fs.readFileSync(path.resolve(__dirname, 'fixtures/article-template.html'), 'utf8');
  const project = buildProject([{ uri: URI, text }]);
  const position = text.indexOf('{{comment.avatar}}') + '{{comment.'.length;
  assert.ok(getCompletions(project, URI, position).some(item => item.label === 'avatar'));
  const loopPosition = text.indexOf('@render commentItem(comment)') + '@render commentItem('.length;
  assert.ok(getCompletions(project, URI, loopPosition).some(item => item.label === 'comment'));
  assert.equal(getSignatureHelp(project, URI, loopPosition).label, 'commentItem(comment: Comment)');
  const symbols = getSymbols(project, URI);
  assert.ok(symbols.find(symbol => symbol.name === 'Comment').children.some(field => field.name === 'avatar'));
  assert.ok(symbols.find(symbol => symbol.name === 'appearance').children.some(field => field.name === 'primary'));
});

test('malformed and cyclic type documents remain bounded', () => {
  const result = complete('@type Recursive\n@param next Recursive\n@endtype\n@param record Recursive\n@block missing(value:\n@layout\n@each value in §');
  assert.deepEqual(labels(result), []);
  for (let length = 1; length < 500; length += 17) {
    const text = '@block unfinished(arg: Comment\n{{'.repeat(length);
    const project = buildProject([{ uri: URI, text }]);
    assert.doesNotThrow(() => getCompletions(project, URI, text.length));
  }
});

test('image crop options complete inside records and exclude conflicting or already declared constraints', () => {
  const result = complete('@type Card\n@param cover Image §\n@endtype\n@param cards Card[]');
  assert.equal(result.items.find(item => item.label === 'aspect_ratio').insertText, 'aspect_ratio="${1:16:9}"');
  assert.equal(result.items.find(item => item.label === 'sizes').insertText, 'sizes="${1:1200x630}|${2:1080x1080}"');
  for (const option of ['aspect_ratio="16:9"', 'aspect_ratio=1.5', 'sizes="128x128|256x256"', 'sizes=""']) {
    const available = labels(complete(`@param image Image ${option} §`));
    assert.ok(!available.includes('sizes'), option);
    assert.ok(!available.includes('aspect_ratio'), option);
    assert.ok(available.includes('label'), 'Other field options remain available');
  }
  for (const type of ['String', 'Range', 'Select', 'Image[]', 'Card']) {
    assert.ok(!labels(complete(`@param image ${type} §`)).includes('aspect_ratio'), type);
  }
  assert.deepEqual(labels(complete('@param image Image sizes="128x128|§"')), []);
  const edit = complete('@param image Image aspect_ra§tio="16:9"');
  const item = edit.items.find(item => item.label === 'aspect_ratio');
  assert.equal(item.insertText, 'aspect_ratio');
  assert.equal(edit.text.slice(item.range.start, item.range.end), 'aspect_ratio');
  const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, '../snippets/fast-landings-tpl.json'), 'utf8'));
  assert.equal(snippets['Image with aspect ratio'].prefix, 'tpl-image-ratio');
  assert.match(snippets['Image with output sizes'].body, /sizes="\$\{3:128x128\}\|\$\{4:256x256\}"/);
});

test('request validation declarations stay out of editable globals and companion page scopes', () => {
  const index = '@validation query fallback="/error"\n@param subid String required\n@param pixel String lenght=10 required\n@endvalidation\n@param title String';
  const success = '@validation body fallback="submit-error"\n@param name String min=4 required\n@param phone String mask="+380 ... ... ..." required\n@param user.first-name String\n@endvalidation';
  const project = buildProject([{ uri: URI, text: index }, { uri: 'file:///templates/success.tpl.php', text: success }]);
  const { getRuntimeMacros } = require('@trafficops/template-language');
  assert.deepEqual([...project.params.keys()], ['title']);
  const document = project.documents.get(URI);
  assert.equal(document.diagnostics.length, 0);
  assert.equal(document.validationBlocks[0].source, 'query');
  assert.equal(document.validationBlocks[0].fallback, '/error');
  assert.equal(document.runtimeParams[1].options.length, '10');
  assert.equal(document.runtimeParams[0].options.required, 'true');
  assert.deepEqual(getRuntimeMacros(project, URI).map(item => item.name), ['query.subid', 'query.pixel']);
  assert.equal(getRuntimeMacros(project).length, 5);
  const result = complete(`${index}\n<p>{body.§}</p>`, [{ uri: 'file:///templates/success.tpl.php', text: success }]);
  assert.deepEqual(labels(result), ['*']);
  const symbols = getSymbols(project, URI);
  assert.equal(symbols[0].kind, 'validation');
  assert.deepEqual(symbols[0].children.map(child => child.name), ['subid', 'pixel']);
});

test('request validation fallback is optional and dotted paths match the server grammar', () => {
  const valid = parseDocument(URI, '@validation query\n@param campaign.id String required\n@endvalidation');
  assert.equal(valid.diagnostics.length, 0);
  assert.equal(valid.validationBlocks[0].fallback, undefined);
  assert.deepEqual(valid.runtimeParams.map(param => param.name), ['campaign.id']);

  const invalidPath = parseDocument(URI, '@validation query\n@param campaign.-id String\n@endvalidation');
  assert.match(invalidPath.diagnostics.map(item => item.message).join('\n'), /Declare a request parameter name and type/);
  assert.equal(invalidPath.runtimeParams.length, 0);

  const encodedRedirect = parseDocument(URI, '@validation query fallback="%252f%252fevil.example"\n@param campaign String\n@endvalidation');
  assert.match(encodedRedirect.diagnostics.map(item => item.message).join('\n'), /fallback must be a local path/);
});

test('runtime completion covers sources, nested paths, headers and complete-source wildcards', () => {
  const runtime = '@validation body fallback="/error"\n@param user.first-name String min=4\n@param phone String\n@endvalidation\n';
  assert.deepEqual(labels(complete('<p>{§}</p>')), ['query', 'headers', 'body']);
  assert.deepEqual(labels(complete('<p>{bo§}</p>')), ['body']);
  assert.deepEqual(labels(complete(`${runtime}<p>{body.§}</p>`)), ['*', 'user', 'phone']);
  const nested = complete(`${runtime}<p>{body.user.fir§st-name}</p>`);
  assert.deepEqual(labels(nested), ['first-name']);
  assert.equal(nested.text.slice(nested.items[0].range.start, nested.items[0].range.end), 'first-name');
  assert.ok(labels(complete('<p>{headers.user-§agent}</p>')).includes('user-agent'));
  assert.deepEqual(labels(complete('<p>{{body.§}}</p>')), []);
  assert.deepEqual(labels(complete('<p>{unknown.§}</p>')), []);
  assert.deepEqual(labels(complete(`${runtime}@param thanks String = "Thanks {body.user.§}!"`)), ['first-name']);
  assert.deepEqual(labels(complete('@previewData\n{"text":"{body.§}"}\n@endpreviewData')), []);
});

test('safe-html-v1 exposes only host-supplied safe runtime macros', () => {
  const options = { dialect: DIALECTS.SAFE_HTML_V1 };
  assert.equal(DEFAULT_DIALECT, DIALECTS.FAST_LANDINGS_V1);
  assert.equal(normalizeDialect('unknown'), DIALECTS.FAST_LANDINGS_V1);
  assert.deepEqual(labels(complete('<p>{§}</p>', [], options)), ['query', 'locale', 'actions']);
  assert.deepEqual(labels(complete('<p>{query.§}</p>', [], options)), ['name']);
  assert.deepEqual(labels(complete('<a href="{actions.§}">Next</a>', [], options)), ['name']);
  assert.equal(complete('<html lang="{loc§ale}">', [], options).items[0].insertText, 'locale');
  assert.deepEqual(labels(complete('<p>{headers.§}</p>', [], options)), []);
  assert.deepEqual(labels(complete('<p>{body.§}</p>', [], options)), []);
  assert.deepEqual(labels(complete('<p>{query.*§}</p>', [], options)), []);
  assert.ok(!labels(complete('@§', [], options)).includes('@validation'));

  const hover = fixture('<p>{query.na§me}</p>', [], options);
  assert.match(getHover(hover.project, URI, hover.offset).contents, /query/);
});

test('editor dialect capabilities stay aligned with the shared machine-readable profiles', () => {
  const profile = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../../template-dsl/resources/dialects', name), 'utf8'));
  const safe = profile('core-v1.json');
  const fast = profile('fast-landings-v1.json');

  assert.equal(safe.id, DIALECTS.SAFE_HTML_V1);
  assert.deepEqual(safe.runtime.contextKeys, DIALECT_PROFILES[safe.id].runtimeSources);
  assert.equal(safe.runtime.wildcards, DIALECT_PROFILES[safe.id].wildcards);
  assert.equal(safe.execution.requestValidation, DIALECT_PROFILES[safe.id].validation);
  assert.equal(safe.execution.phpSource, DIALECT_PROFILES[safe.id].php);

  assert.equal(fast.id, DIALECTS.FAST_LANDINGS_V1);
  assert.deepEqual(fast.runtime.tokens.map(token => token.slice(1, token.indexOf('.'))), ['query', 'headers', 'body', 'query', 'headers', 'body']);
  assert.deepEqual([...new Set(fast.runtime.tokens.map(token => token.slice(1, token.indexOf('.'))))], DIALECT_PROFILES[fast.id].runtimeSources);
  assert.equal(fast.runtime.wildcards, DIALECT_PROFILES[fast.id].wildcards);
  assert.equal(fast.execution.requestValidation, DIALECT_PROFILES[fast.id].validation);
  assert.equal(fast.execution.phpSource, DIALECT_PROFILES[fast.id].php);
});

test('safe-html-v1 diagnoses trusted-only syntax and cannot be changed by source', () => {
  const source = `@template "Safe" dialect="fast-landings-v1"
@validation body fallback="/error"
@param name String
@endvalidation
<p>{query.name} {locale} {actions.continue}</p>
<p>{headers.user-agent} {body.name} {query.*} {query.user.name}</p>
<?php echo 'trusted only'; ?>`;
  const document = parseDocument('file:///templates/index.tpl.php', source, { dialect: DIALECTS.SAFE_HTML_V1 });
  const diagnostics = document.diagnostics.map(issue => issue.message).join('\n');
  assert.equal(document.dialect, DIALECTS.SAFE_HTML_V1);
  assert.equal(document.runtimeParams.length, 0);
  assert.equal(document.validationBlocks.length, 0);
  assert.match(diagnostics, /@validation is unavailable/);
  assert.match(diagnostics, /headers, body, nested paths and wildcards/);
  assert.match(diagnostics, /\.tpl\.php sources are unavailable/);
  assert.match(diagnostics, /PHP source is unavailable/);
  const rejectedMacros = document.diagnostics.filter(issue => issue.message.startsWith('safe-html-v1 runtime macros'))
    .map(issue => source.slice(issue.start, issue.end));
  assert.deepEqual(rejectedMacros, ['{headers.user-agent}', '{body.name}', '{query.*}', '{query.user.name}']);

  const metadata = parseDocument(URI, '@previewData\n{"literal":"{body.name}"}\n@endpreviewData', { dialect: DIALECTS.SAFE_HTML_V1 });
  assert.ok(!metadata.diagnostics.some(issue => issue.message.startsWith('safe-html-v1 runtime macros')));
  assert.match(parseDocument(URI, '<? echo "unsafe"; ?>', { dialect: DIALECTS.SAFE_HTML_V1 }).diagnostics[0].message, /PHP-style source/);
  assert.match(parseDocument('file:///templates/index.php', '@layout\n@endlayout', { dialect: DIALECTS.SAFE_HTML_V1 }).diagnostics[0].message, /Executable source paths/);
});

test('validation completion restricts types and options and includes declarations from reachable includes', () => {
  assert.deepEqual(labels(complete('@validation §')), ['query', 'headers', 'body']);
  assert.deepEqual(labels(complete('@validation headers §')), ['fallback']);
  const prefix = '@validation body fallback="/error"\n';
  assert.deepEqual(labels(complete(`${prefix}@param user.first-name §`)), ['String', 'Number', 'Integer', 'Boolean']);
  assert.deepEqual(labels(complete(`${prefix}@param name String §`)), ['required', 'min', 'max', 'length', 'mask']);
  assert.deepEqual(labels(complete(`${prefix}@param count Integer §`)), ['required', 'min', 'max']);
  assert.deepEqual(labels(complete(`${prefix}@param enabled Boolean §`)), ['required']);
  assert.ok(!labels(complete(`${prefix}@param name String required lenght=4 §`)).includes('length'));
  assert.ok(!labels(complete(`${prefix}@param name String required §`)).includes('required'));
  assert.deepEqual(labels(complete(`${prefix}@§`)), ['@endvalidation', '@param']);
  assert.deepEqual(labels(complete(`${prefix}@param name String required=f§`)), ['true', 'false']);
  const included = complete('@include "rules.tpl"\n<p>{body.§}</p>', [{ uri: 'file:///templates/rules.tpl', text: `${prefix}@param name String\n@endvalidation` }]);
  assert.ok(labels(included).includes('name'));
});

test('runtime macros have case-insensitive header definitions and validation hovers', () => {
  const source = '@validation headers fallback="/error"\n@param X-Request-ID String required length=10\n@endvalidation\n<p>{headers.x-request-§id}</p>';
  const result = fixture(source);
  const definition = getDefinition(result.project, URI, result.offset);
  assert.equal(result.text.slice(definition.start, definition.end), 'X-Request-ID');
  const hover = getHover(result.project, URI, result.offset);
  assert.match(hover.contents, /headers.x-request-id: String/);
  assert.match(hover.contents, /required=true/);
  assert.match(hover.contents, /length=10/);
  const integer = fixture('@validation query fallback="/error"\n@param count Int§eger\n@endvalidation');
  assert.match(getHover(integer.project, URI, integer.offset).contents, /Integer request value/);
  assert.match(parseDocument(URI, '@validation cookies fallback="/error"\n@param count Color mask="..."').diagnostics.map(item => item.message).join('\n'), /query, headers or body/);
});

test('PHP strings, comments and heredocs remain opaque to declarations and runtime completions', () => {
  const php = `<?php
$value = "?> {body.name}";
/* ?> @param fake String */
$text = <<<'CONTENT'
@validation body fallback="/fake"
@param fake String
@endvalidation
{body.fake}
CONTENT;
?>`;
  const parsed = parseDocument(URI, `${php}\n@validation query fallback="/error"\n@param real String\n@endvalidation`);
  assert.equal(parsed.runtimeParams.length, 1);
  assert.equal(parsed.runtimeParams[0].name, 'real');
  assert.equal(parsed.phpSpans.length, 1);
  assert.deepEqual(labels(complete('<?php\n$value = "{body.§}";\n?>')), []);
  assert.deepEqual(labels(complete('<?php\n@§')), []);
  const hover = fixture('<?php\n@param fa§ke String\n?>');
  assert.equal(getHover(hover.project, URI, hover.offset), null);
});

test('included fragments inherit one owning page without merging distinct page scopes', () => {
  const { getRuntimeMacros } = require('@trafficops/template-language');
  const index = { uri: 'file:///templates/index.tpl.php', text: '@validation query fallback="/error"\n@param subid String\n@endvalidation\n@include "shared.tpl"' };
  const fragment = { uri: 'file:///templates/shared.tpl', text: '<p>{query.subid}</p>' };
  assert.deepEqual(getRuntimeMacros(buildProject([index, fragment]), fragment.uri).map(item => item.name), ['query.subid']);
  const success = { uri: 'file:///templates/success.tpl.php', text: '@validation body fallback="/error"\n@param name String\n@endvalidation\n@include "shared.tpl"' };
  assert.deepEqual(getRuntimeMacros(buildProject([index, success, fragment]), fragment.uri), []);
  assert.deepEqual(getRuntimeMacros(buildProject([index, success, fragment]), index.uri).map(item => item.name), ['query.subid']);
});

test('escaped macros stay literal and numeric JSON paths complete', () => {
  assert.deepEqual(labels(complete('<p>\\{body.§}</p>')), []);
  const result = complete('@validation body fallback="/error"\n@param 0.name String\n@endvalidation\n<p>{body.0.§}</p>');
  assert.deepEqual(labels(result), ['name']);
  const escapedHover = fixture('<p>\\{body.na§me}</p>');
  assert.equal(getHover(escapedHover.project, URI, escapedHover.offset), null);
});
