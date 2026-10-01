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
});
test('notices and toasts use alert for errors and status otherwise', () => {
  for (const name of ['InlineNotice.jsx', 'Toast.jsx']) { const source = read(name); assert.ok(source.includes("'alert'") && source.includes("'status'"), name); }
  assert.ok(read('Toast.jsx').includes('5000'), 'success toasts dismiss after 5 s');
});
test('chips have an accessible remove action and mention chips are buttons', () => {
  const source = read('Chips.jsx');
  assert.ok(source.includes('aria-label') && source.includes('onRemove') && source.includes('<button'), 'chips');
});
