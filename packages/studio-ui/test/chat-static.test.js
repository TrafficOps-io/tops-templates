import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { parse } from '@babel/parser';

const chatRoot = new URL('../src/chat/', import.meta.url);
const read = name => { const url = new URL(name, chatRoot); return existsSync(url) ? readFileSync(url, 'utf8') : ''; };
const ast = source => parse(source, { sourceType: 'module', plugins: ['jsx', 'importAttributes'] });
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(item => walk(item, visit)); else if (value && typeof value === 'object') walk(value, visit);
  }
}
function sourceFiles(url, prefix = '') {
  if (!existsSync(url)) return [];
  return readdirSync(url).flatMap(name => {
    const child = new URL(name, url);
    if (statSync(child).isDirectory()) return sourceFiles(new URL(`${name}/`, url), `${prefix}${name}/`);
    return /\.(?:js|jsx)$/.test(name) ? [{ name: prefix + name, source: readFileSync(child, 'utf8') }] : [];
  });
}
const imports = (source, from) => {
  const names = [];
  walk(ast(source), node => {
    if (node.type === 'ImportDeclaration' && (!from || node.source.value === from)) for (const specifier of node.specifiers) names.push(specifier.imported?.name ?? specifier.local.name);
  });
  return names;
};
const memberName = name => name.type === 'JSXMemberExpression' ? `${memberName(name.object)}.${name.property.name}` : name.name;

test('chat index exports StudioChat, StudioComposer and useChatRuntime', () => {
  const exported = [];
  walk(ast(read('index.js')), node => { if (node.type === 'ExportNamedDeclaration') for (const specifier of node.specifiers) exported.push(specifier.exported.name); });
  for (const name of ['StudioChat', 'StudioComposer', 'useChatRuntime']) assert.ok(exported.includes(name), name);
});

test('StudioChat uses current assistant-ui primitives and no deprecated 0.15 APIs', () => {
  const source = read('StudioChat.jsx');
  const used = imports(source, '@assistant-ui/react');
  for (const name of ['AssistantRuntimeProvider', 'ThreadPrimitive', 'AuiIf']) assert.ok(used.includes(name), name);
  for (const { name, source: file } of sourceFiles(chatRoot)) {
    assert.ok(!file.includes('ThreadPrimitive.Empty'), `${name}: ThreadPrimitive.Empty`);
    assert.ok(!file.includes('components={{'), `${name}: components={{`);
  }
});

test('Messages renders parts through MessagePrimitive.Parts with a ({ part }) children function', () => {
  let found = false;
  walk(ast(read('Messages.jsx') || 'null'), node => {
    if (node.type !== 'JSXElement' || memberName(node.openingElement.name) !== 'MessagePrimitive.Parts') return;
    for (const child of node.children) {
      const fn = child.type === 'JSXExpressionContainer' ? child.expression : null;
      if (fn && /FunctionExpression$/.test(fn.type) && fn.params[0]?.type === 'ObjectPattern' && fn.params[0].properties.some(property => property.key?.name === 'part')) found = true;
    }
  });
  assert.ok(found);
  const source = read('Messages.jsx');
  for (const token of ['data-run-id', 'data-run-status', 'data-role']) assert.ok(source.includes(token), token);
});

test('useChatRuntime builds on useExternalStoreRuntime', () => {
  assert.ok(imports(read('useChatRuntime.js'), '@assistant-ui/react').includes('useExternalStoreRuntime'));
});

test('Composer is an assistant-ui composer with a keyboard-operable mention listbox', () => {
  const source = read('Composer.jsx');
  for (const token of ['ComposerPrimitive', 'role="listbox"', "'ArrowDown'", "'ArrowUp'", "'Escape'", 'aria-activedescendant', 'data-testid="studio-chat-composer"', 'type="submit"']) assert.ok(source.includes(token), token);
});

test('StudioChat and RunActions carry their test hooks', () => {
  const chat = read('StudioChat.jsx');
  for (const id of ['studio-chat', 'studio-chat-threads', 'studio-chat-feed']) assert.ok(chat.includes(`data-testid="${id}"`), id);
  const actions = read('RunActions.jsx');
  for (const id of ['studio-chat-apply', 'studio-chat-keep-draft', 'studio-chat-continue']) assert.ok(actions.includes(`data-testid="${id}"`), id);
});

test('the package exposes exactly the documented data-testid hooks', () => {
  const expected = ['studio-chat', 'studio-chat-apply', 'studio-chat-card', 'studio-chat-composer', 'studio-chat-continue', 'studio-chat-feed', 'studio-chat-keep-draft', 'studio-chat-threads'];
  const found = new Set();
  for (const { source } of sourceFiles(new URL('../src/', import.meta.url))) {
    walk(ast(source), node => {
      if (node.type === 'JSXAttribute' && node.name.name === 'data-testid') {
        if (node.value?.type === 'StringLiteral') found.add(node.value.value); else found.add('<dynamic>');
      }
    });
  }
  assert.deepEqual([...found].sort(), expected);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const id of expected) assert.ok(readme.includes(`\`${id}\``), `README lists ${id}`);
});

test('scope chips and result cards carry their classes and attributes', () => {
  assert.ok(read('ScopeChips.jsx').includes('studio-chat-scope'), 'studio-chat-scope');
  assert.ok(read('cards/index.js').includes('data-card'), 'data-card');
});

test('there are eight result card components', () => {
  for (const name of ['DiffCard', 'ValuesCard', 'ImageCard', 'AudioCard', 'VideoCard', 'FileCard', 'OperationCard', 'QuestionCard']) assert.ok(existsSync(new URL(`cards/${name}.jsx`, chatRoot)), name);
});

test('no chat module uses useToast (errors are inline notices)', () => {
  for (const { name, source } of sourceFiles(chatRoot)) {
    assert.ok(!imports(source).includes('useToast'), `${name} imports useToast`);
    assert.ok(!/\buseToast\b/.test(source), `${name} mentions useToast`);
  }
});

// Same rule as editor/test/theme-tokens.test.js (spec 8.1): literals only for shadows, masks and modal scrims.
const ALLOW = [
  { property: /^box-shadow$/ },
  { property: /^--ui-shadow-/ },
  { property: /mask-image$/ },
  { selector: /modal-backdrop|hosted-modal|::backdrop/, property: /^background/ },
];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const RULE = /([^{}]+)\{([^{}]*)\}/g, DECLARATION = /([-\w]+)\s*:\s*([^;]+)/g;
test('styles.css carries no literal colours outside the allow-list', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const offenders = [];
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(RULE)) {
    for (const [, property, value] of body.matchAll(DECLARATION)) {
      if (!LITERAL.test(value)) continue;
      const allowed = ALLOW.some(rule => (!rule.selector || rule.selector.test(selector)) && rule.property.test(property));
      if (!allowed) offenders.push(`${selector.trim().slice(0, 60)} | ${property}: ${value.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
