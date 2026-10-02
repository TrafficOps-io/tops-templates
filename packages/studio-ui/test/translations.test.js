import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parse } from '@babel/parser';
import messages from '../src/i18n/studio-translations.json' with { type: 'json' };
import { translateStudio } from '../src/i18n/translation.js';

const roots = ['../src/primitives/', '../src/workspace/', '../src/i18n/', '../src/chat/', '../src/chat/cards/', '../../../editor/src/'].filter(root => existsSync(new URL(root, import.meta.url)));
test('every literal passed to t() in studio-ui and Studio has both built-in translations', () => {
  const missing = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 't' && node.arguments[0]?.type === 'StringLiteral') {
      const text = node.arguments[0].value; if (!messages[text]?.[0] || !messages[text]?.[1]) missing.push(text);
    }
    for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); }
  }
  for (const root of roots) for (const name of readdirSync(new URL(root, import.meta.url)).filter(name => /\.(?:js|jsx)$/.test(name))) {
    visit(parse(readFileSync(new URL(root + name, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx', 'importAttributes'] }));
  }
  assert.deepEqual([...new Set(missing)], []);
});
test('source text is the fallback and placeholders interpolate', () => {
  assert.equal(translateStudio('Unknown text', 'uk'), 'Unknown text');
  assert.equal(translateStudio('Version {number}', 'ru', { number: 7 }), 'Версия 7');
});
