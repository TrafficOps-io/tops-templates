import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const styleDirectories = ['../src/', '../../packages/template-editor-shell/src/', '../embedded/src/', '../../packages/studio-ui/'];
const files = styleDirectories.flatMap(directory => readdirSync(new URL(directory, import.meta.url)).filter(name => name.endsWith('.css')).map(name => ({ name: directory + name, css: readFileSync(new URL(directory + name, import.meta.url), 'utf8') })));

// Literals are allowed only where the colour is not an interface surface (spec 8.1):
// shadows and modal scrims darken both themes; preview iframe is another page's backdrop;
// checkerboards draw transparency; brand-wordmark is the logo on the brand colour.
const ALLOW = [
  { property: /^box-shadow$/ },
  { property: /^--ui-shadow-/ },
  { property: /mask-image$/ },
  { selector: /modal-backdrop|hosted-modal|::backdrop/, property: /^background/ },
  { selector: /iframe/, property: /^background/, value: /^white$/ },
  { selector: /crop-stage canvas|asset-image-stage/, property: /^background/, value: /repeating-conic-gradient/ },
  { selector: /brand-wordmark/, property: /^color$/ },
];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:oklch|oklab|lab|lch|color)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const RULE = /([^{}]+)\{([^{}]*)\}/g, DECLARATION = /([-\w]+)\s*:\s*([^;]+)/g;

test('editor styles carry no literal colours outside the allow-list', () => {
  const offenders = [];
  for (const { name, css } of files) {
    for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(RULE)) {
      for (const [, property, value] of body.matchAll(DECLARATION)) {
        if (!LITERAL.test(value)) continue;
        const allowed = ALLOW.some(rule => (!rule.selector || rule.selector.test(selector)) && rule.property.test(property) && (!rule.value || rule.value.test(value.trim())));
        if (!allowed) offenders.push(`${name} | ${selector.trim().slice(0, 60)} | ${property}: ${value.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// Type follows the --ui-text-* scale. Exceptions: display headings (clamp or 1.5rem and larger), 0 for visually hidden
// labels, 16px where iOS would otherwise zoom into a field, and inherit.
const FONT_SIZE = /^(?:var\(--ui-text-(?:xs|sm|md|lg|xl)\)|clamp\(.+\)|0|16px|inherit|(?:[2-9]|1\.[5-9])\d*(?:\.\d+)?rem)$/;
test('editor styles size text with the token scale', () => {
  const offenders = [];
  for (const { name, css } of files) {
    for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(RULE)) {
      for (const [, property, value] of body.matchAll(DECLARATION)) if (property === 'font-size' && !FONT_SIZE.test(value.trim())) offenders.push(`${name} | ${selector.trim().slice(0, 60)} | ${value.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// Buttons share one height scale (shell.css: 36px, .btn-sm 32px, 44px on touch). Local overrides recreate the
// mismatched toolbars the scale replaced; a smaller control uses .btn-sm instead.
test('only the shared button scale sets .btn heights', () => {
  const scale = new Set(['.studio-root .btn', '.studio-root .btn-sm', '.studio-root .btn-sm.btn-square']);
  const offenders = [];
  for (const { name, css } of files) {
    for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(RULE)) {
      const list = selector.split(',').map(item => item.replace(/^[\s\S]*\{/, '').trim()).filter(item => /\.btn\b/.test(item) && !scale.has(item));
      if (list.length && [...body.matchAll(DECLARATION)].some(([, property]) => /^(?:min-)?height$/.test(property))) offenders.push(`${name} | ${list.join(', ').slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
