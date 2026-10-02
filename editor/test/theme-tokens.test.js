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
