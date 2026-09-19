import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from '@babel/parser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import messages from '../src/studio-translations.json' with { type: 'json' };
import { translateStudio, useStudioText } from '../src/studio-i18n.js';
import { StudioHostContext } from '../src/host-context.js';

test('every literal source string in the shared UI has both built-in translations', () => {
  const missing = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 't' && node.arguments[0]?.type === 'StringLiteral') {
      const text = node.arguments[0].value;
      if (!messages[text]?.[0] || !messages[text]?.[1]) missing.push(text);
    }
    for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); }
  }
  for (const name of readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.(?:js|jsx)$/.test(name))) {
    visit(parse(readFileSync(new URL('../src/' + name, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx', 'importAttributes'] }));
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('source text is the fallback and host overrides use the same keys and placeholders', () => {
  assert.equal(translateStudio('New source text', 'uk'), 'New source text');
  assert.equal(translateStudio('Version {number}', 'ru', { number: 7 }), 'Версия 7');
  function Probe() { return createElement('span', null, useStudioText()('Version {number}', { number: 8 })); }
  assert.equal(renderToStaticMarkup(createElement(StudioHostContext.Provider, { value: { language: 'uk', messages: { 'Version {number}': 'Host version {number}' } } }, createElement(Probe))), '<span>Host version 8</span>');
});
