import test from 'node:test';
import assert from 'node:assert/strict';
import tokens from '../tokens.json' with { type: 'json' };

function luminance(hex) {
  const channel = value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const n = hex.replace('#', '');
  return 0.2126 * channel(parseInt(n.slice(0, 2), 16)) + 0.7152 * channel(parseInt(n.slice(2, 4), 16)) + 0.0722 * channel(parseInt(n.slice(4, 6), 16));
}
export function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

const surfaces = ['page', 'surface', 'surface-raised'];
for (const [name, theme] of Object.entries(tokens.themes)) {
  test(`${name}: text and muted reach 4.5:1 on every surface`, () => {
    const failures = [];
    for (const surface of surfaces) for (const text of ['text', 'muted']) {
      const ratio = contrast(theme[text], theme[surface]);
      if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });
  test(`${name}: text-on-accent reaches 4.5:1 on accent`, () => {
    assert.ok(contrast(theme['text-on-accent'], theme.accent) >= 4.5, `accent: ${contrast(theme['text-on-accent'], theme.accent).toFixed(2)}`);
  });
  test(`${name}: accent, accent-hover, focus, border-strong and state colours reach 3:1 on page and surface`, () => {
    const failures = [];
    for (const surface of ['page', 'surface']) for (const graphic of ['accent', 'accent-hover', 'focus', 'border-strong', 'success', 'warning', 'danger', 'info']) {
      const ratio = contrast(theme[graphic], theme[surface]);
      if (ratio < 3) failures.push(`${graphic} on ${surface}: ${ratio.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });
}
