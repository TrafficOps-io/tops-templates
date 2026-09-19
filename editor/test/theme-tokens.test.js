import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = ['../src/studio.css', '../../packages/template-editor-shell/src/shell.css', '../embedded/src/embed.css'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

// Literal panel colours turn into dark patches when the host uses its light theme.
// Shadows and modal scrims deliberately darken both themes; they use rgba().
const BACKGROUND = /(?:^|[;{])\s*(background|background-color|background-image)\s*:\s*([^;}]+)/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/;

test('background declarations across editor styles carry no literal colours', () => {
  const offenders = [];
  for (const [, property, value] of css.matchAll(BACKGROUND)) {
    if (HEX.test(value)) offenders.push(`${property}: ${value.trim()}`);
  }
  assert.deepEqual(offenders, []);
});
