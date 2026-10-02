import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../src/primitives/${name}`, import.meta.url), 'utf8');
const index = read('index.js');

test('index exports every primitive from the spec', () => {
  for (const name of ['Button', 'Tabs', 'Segmented', 'Menu', 'Modal', 'ConfirmDialog', 'EmptyState', 'StatusBadge', 'InlineNotice', 'ToastProvider', 'useToast', 'Skeleton', 'MentionChip', 'AttachmentChip']) assert.match(index, new RegExp(`\\b${name}\\b`), name);
});
test('Tabs is a WAI-ARIA tablist with roving arrow keys', () => {
  const source = read('Tabs.jsx');
  for (const token of ['role="tablist"', 'role="tab"', 'aria-selected', 'aria-controls', "'ArrowLeft'", "'ArrowRight'", "'Home'", "'End'"]) assert.ok(source.includes(token), token);
});
test('Button exposes variants, sizes and a width-preserving loading state', () => {
  const source = read('Button.jsx');
  for (const token of ['primary', 'secondary', 'ghost', 'danger', "size = 'md'", 'loading', 'aria-busy']) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /studio-button-content"[^>]*aria-hidden/, 'label stays the accessible name while loading');
  assert.ok(source.indexOf('{...attributes}') < source.indexOf('disabled={'), 'consumer attributes cannot override disabled/aria-busy');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /studio-button-content\s*\{[^}]*visibility:\s*hidden/, 'visibility:hidden would drop the accessible name');
});
test('Tabs keeps a tab stop when value is missing or disabled', () => {
  const source = read('Tabs.jsx');
  assert.ok(source.includes('enabled[0]?.id') && source.includes('!enabled.length'), 'fallback tab stop and empty list guard');
});
test('notices and toasts use alert for errors and status otherwise', () => {
  for (const name of ['InlineNotice.jsx', 'Toast.jsx']) { const source = read(name); assert.ok(source.includes("'alert'") && source.includes("'status'"), name); }
  assert.ok(read('Toast.jsx').includes('5000'), 'success toasts dismiss after 5 s');
  assert.match(read('Toast.jsx'), /useEffect\(\(\) => \(\) => \{[^}]*clearTimeout/, 'provider clears timers on unmount');
});
test('chips have an accessible remove action and mention chips are buttons', () => {
  const source = read('Chips.jsx');
  assert.ok(source.includes('aria-label') && source.includes('onRemove') && source.includes('<button'), 'chips');
});

test('small text is never colored with the accent (spec 3.2 / 8.2, light theme contrast < 4.5:1)', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /(^|[\s;])color:\s*var\(--ui-accent/.test(body))
    .map(([, selector]) => selector.trim());
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(css, /\.studio-card-action[^{]*\{[^}]*(^|[\s;])color:\s*var\(--ui-accent/);
});
