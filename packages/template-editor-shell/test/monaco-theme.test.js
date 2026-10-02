import test from 'node:test';
import assert from 'node:assert/strict';
import tokens from '../../studio-tokens/tokens.json' with { type: 'json' };
import { mix, studioMonacoTheme } from '../src/monaco-theme.js';

const luminance = hex => {
  const channel = value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [0, 2, 4].map(index => channel(parseInt(hex.replace('#', '').slice(index, index + 2), 16))).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const palette = theme => ({ page: theme.page, surface: theme.surface, raised: theme['surface-raised'], border: theme.border, borderStrong: theme['border-strong'], text: theme.text, muted: theme.muted, accent: theme.accent, success: theme.success, warning: theme.warning, info: theme.info, danger: theme.danger });

test('mix blends like color-mix in srgb', () => {
  assert.equal(mix('#ffffff', '#000000', .5), '#808080');
  assert.equal(mix('#e75d45', '#241f1d', 1), '#e75d45');
});

for (const [name, theme] of Object.entries(tokens.themes)) {
  const scheme = name.endsWith('dark') ? 'dark' : 'light', data = studioMonacoTheme(palette(theme), scheme);
  test(`${name}: the editor sits on the panel surface and inherits the matching base`, () => {
    assert.equal(data.base, scheme === 'dark' ? 'vs-dark' : 'vs');
    assert.equal(data.colors['editor.background'], theme.surface);
    assert.equal(data.colors['editor.foreground'], theme.text);
    for (const value of Object.values(data.colors)) assert.match(value, /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/);
  });
  test(`${name}: every syntax colour reaches 3:1 on the editor background`, () => {
    const failures = data.rules.filter(rule => contrast(`#${rule.foreground}`, theme.surface) < 3).map(rule => `${rule.token}: ${contrast(`#${rule.foreground}`, theme.surface).toFixed(2)}`);
    assert.deepEqual(failures, []);
  });
  test(`${name}: bracket pairs use the syntax family, not Monaco defaults`, () => {
    for (const index of [1, 2, 3]) assert.ok(contrast(data.colors[`editorBracketHighlight.foreground${index}`], theme.surface) >= 3);
    assert.notEqual(data.colors['editorBracketHighlight.foreground1'], '#ffd700');
  });
  test(`${name}: TPL directives use the accent family`, () => {
    const directive = data.rules.find(rule => rule.token === 'keyword.directive');
    assert.equal(directive.fontStyle, 'bold');
    assert.ok(contrast(`#${directive.foreground}`, theme.accent) < 1.6, 'directive colour stays close to the accent');
  });
}
