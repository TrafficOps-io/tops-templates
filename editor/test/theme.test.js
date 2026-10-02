import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme, readTheme, THEMES, THEME_KEY } from '../src/theme.js';

function fakeEnvironment(saved) {
  const attributes = new Map(); const storage = new Map(saved ? [[THEME_KEY, saved]] : []);
  return { attributes, storage,
    document: { documentElement: { setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k) } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } };
}

test('system is the default and removes data-theme so prefersdark decides', () => {
  const env = fakeEnvironment();
  assert.equal(readTheme(env), 'system');
  applyTheme('system', env);
  assert.equal(env.attributes.has('data-theme'), false);
  assert.equal(env.storage.has(THEME_KEY), false);
});

test('explicit choice sets data-theme to the studio theme name and persists', () => {
  const env = fakeEnvironment();
  applyTheme('dark', env);
  assert.equal(env.attributes.get('data-theme'), 'studio-dark');
  assert.equal(env.storage.get(THEME_KEY), 'dark');
  applyTheme('light', env);
  assert.equal(env.attributes.get('data-theme'), 'studio-light');
});

test('unknown stored values fall back to system', () => {
  assert.equal(readTheme(fakeEnvironment('trafficops')), 'system');
  assert.deepEqual(THEMES, ['system', 'light', 'dark']);
});

test('theme-color follows the chosen theme and returns to per-scheme values for system', () => {
  const env = fakeEnvironment(), metas = [{ media: '(prefers-color-scheme: light)', content: '' }, { media: '(prefers-color-scheme: dark)', content: '' }];
  env.document.querySelectorAll = () => metas;
  applyTheme('dark', env);
  assert.deepEqual(metas.map(meta => meta.content), ['#262220', '#262220']);
  applyTheme('system', env);
  assert.deepEqual(metas.map(meta => meta.content), ['#fffdfb', '#262220']);
});
