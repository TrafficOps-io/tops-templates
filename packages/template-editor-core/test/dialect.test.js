import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, validateDialectDescriptor } from '../src/index.js';
const descriptor = { schema: 1, id: 'third-party-v1', allowedEntrypoints: ['index.php', 'next.html'], limits: LIMITS };
test('descriptor validation uses the caller registry and does not know any language profile', () => {
  assert.ok(validateDialectDescriptor(descriptor, ['third-party-v1']));
  assert.equal(validateDialectDescriptor(descriptor, ['safe-html-v1']), false);
  for (const value of [null, {}, { ...descriptor, schema: 2 }, { ...descriptor, allowedEntrypoints: ['../index.php'] }, { ...descriptor, limits: {...LIMITS, text: Infinity} }, { ...descriptor, limits: {...LIMITS, count: -1} }]) assert.equal(validateDialectDescriptor(value, ['third-party-v1']), false);
  assert.ok(validateDialectDescriptor({ ...descriptor, allowedEntrypoints: [] }, ['third-party-v1']));
});
