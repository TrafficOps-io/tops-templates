import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tokens from '../tokens.json' with { type: 'json' };

const themes = readFileSync(new URL('../themes.css', import.meta.url), 'utf8');
const semantic = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const block = name => themes.match(new RegExp(`@plugin "daisyui/theme" \\{[^}]*name: "${name}";[^}]*\\}`))?.[0];
const map = { page: '--color-base-200', surface: '--color-base-100', 'surface-raised': '--studio-surface-raised', overlay: '--studio-overlay', border: '--color-base-300', 'border-strong': '--studio-border-strong', text: '--color-base-content', muted: '--color-secondary', 'text-on-accent': '--color-primary-content', accent: '--color-primary', 'accent-hover': '--studio-accent-hover', focus: '--studio-focus', success: '--color-success', warning: '--color-warning', danger: '--color-error', info: '--color-info' };

for (const [name, theme] of Object.entries(tokens.themes)) {
  test(`${name}: every JSON colour appears under the same variable in themes.css`, () => {
    const css = block(name); assert.ok(css, `theme block ${name} exists`);
    const mismatches = [];
    for (const [token, variable] of Object.entries(map)) {
      const value = css.match(new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
      if (value !== theme[token].toLowerCase()) mismatches.push(`${token} (${variable}): css ${value} ≠ json ${theme[token]}`);
    }
    assert.deepEqual(mismatches, []);
  });
}

test('tokens.css declares every scale from tokens.json and no literal colours except shadows', () => {
  tokens.space.forEach((value, index) => assert.match(semantic, new RegExp(`--ui-space-${index + 1}: ${value}px`)));
  for (const [size, [px, lh]] of Object.entries(tokens.text)) { assert.match(semantic, new RegExp(`--ui-text-${size}: ${px}px`)); assert.match(semantic, new RegExp(`--ui-text-${size}--line-height: ${lh}px`)); }
  const compact = text => text.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(tokens.motion)) assert.ok(compact(semantic).includes(typeof value === 'number' ? `--ui-motion-${key}:${value}ms` : compact(value)), key);
  for (const [key, value] of Object.entries(tokens.radius)) assert.ok(compact(semantic).includes(`--ui-radius-${key}:`) && compact(semantic).includes(compact(value)), `radius ${key}`);
  for (const [key, value] of Object.entries(tokens.z)) assert.match(semantic, new RegExp(`--ui-z-${key}: ${value}`));
  const literals = [...semantic.matchAll(/#[0-9a-fA-F]{3,8}\b|rgb\(/g)].length, shadows = [...semantic.matchAll(/--ui-shadow-[a-z]+: [^;]*rgb\(/g)].length;
  assert.equal(literals, shadows, 'only --ui-shadow-* may carry literal colours');
});
