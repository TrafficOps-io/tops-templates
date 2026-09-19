import test from 'node:test';
import assert from 'node:assert/strict';
import { getPwaState, registerPwa, subscribePwa } from '../src/pwa.js';

function browser() {
  const target = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const intervals = new Map();
  let reloads = 0;
  Object.assign(target, {
    document, navigator: { onLine: true, serviceWorker: {} }, CustomEvent,
    location: { reload: () => { reloads++; } },
    setInterval: (callback, duration) => { const id = Symbol(); intervals.set(id, { callback, duration }); return id; },
    clearInterval: id => intervals.delete(id),
  });
  return { target, document, intervals, reloads: () => reloads };
}

async function setup(t, options = {}) {
  const env = browser();
  let callbacks, clock = 0, updates = 0, activations = 0;
  const registration = { active: {}, update: async () => { updates++; } };
  const lifecycle = registerPwa({
    windowImpl: env.target, now: () => clock,
    loadRegister: async () => value => { callbacks = value; return async reload => { assert.equal(reload, true); activations++; }; },
    ...options,
  });
  t.after(() => lifecycle.dispose());
  await lifecycle.ready;
  return { ...env, lifecycle, callbacks, registration, advance: ms => { clock += ms; }, updates: () => updates, activations: () => activations };
}

test('readiness is replayed to late subscribers and activation stays explicitly requested', async t => {
  const env = await setup(t);
  env.callbacks.onRegisteredSW('/sw.js', env.registration);
  env.callbacks.onNeedRefresh();
  let latest;
  const unsubscribe = subscribePwa(value => { latest = value; });
  t.after(unsubscribe);
  assert.equal(latest.offlineReady, true);
  assert.equal(typeof latest.update, 'function');
  assert.equal(env.activations(), 0);
  const first = latest.update(), second = latest.update();
  assert.equal(first, second);
  await first;
  assert.equal(env.activations(), 1);
  assert.equal(env.reloads(), 0);
  env.callbacks.onNeedReload();
  assert.equal(env.reloads(), 1);
});

test('another window activating an update does not reload this window', async t => {
  const env = await setup(t);
  env.callbacks.onNeedRefresh();
  env.callbacks.onNeedReload();
  assert.equal(env.reloads(), 0);
  await getPwaState().update();
  assert.equal(env.activations(), 0);
  assert.equal(env.reloads(), 1);
});

test('failed update activation preserves the action for retry and never grants a later automatic reload', async t => {
  const env = browser();
  let callbacks, fail = true;
  const lifecycle = registerPwa({ windowImpl: env.target, loadRegister: async () => options => {
    callbacks = options;
    return async () => { if (fail) throw new Error('Could not activate worker'); };
  } });
  t.after(() => lifecycle.dispose());
  await lifecycle.ready;
  callbacks.onNeedRefresh();
  await assert.rejects(getPwaState().update(), /Could not activate worker/);
  assert.deepEqual(getPwaState().error, { operation: 'update', message: 'Could not activate worker' });
  callbacks.onNeedReload();
  assert.equal(env.reloads(), 0);
  fail = false;
  await getPwaState().update();
  assert.equal(env.reloads(), 1);
});

test('long-lived installs check hourly and on return, throttling hidden and offline checks', async t => {
  const env = await setup(t);
  env.callbacks.onRegisteredSW('/sw.js', env.registration);
  const interval = [...env.intervals.values()][0];
  assert.equal(interval.duration, 60 * 60 * 1000);
  assert.equal(await env.lifecycle.checkForUpdate(), false);
  env.advance(60 * 1000);
  env.target.navigator.onLine = false;
  assert.equal(await env.lifecycle.checkForUpdate(), false);
  env.target.navigator.onLine = true;
  env.document.visibilityState = 'hidden';
  assert.equal(await env.lifecycle.checkForUpdate(), false);
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await env.lifecycle.checkForUpdate();
  assert.equal(env.updates(), 1);
  env.advance(60 * 1000);
  env.target.dispatchEvent(new Event('online'));
  await env.lifecycle.checkForUpdate();
  assert.equal(env.updates(), 2);
  env.advance(60 * 60 * 1000);
  await interval.callback();
  assert.equal(env.updates(), 3);
  env.advance(60 * 1000);
  env.target.dispatchEvent(new Event('focus'));
  await env.lifecycle.checkForUpdate();
  assert.equal(env.updates(), 4);
});

test('update check failures are observable, handled, and recover after connectivity returns', async t => {
  const env = await setup(t);
  env.registration.update = async () => { throw new Error('Network unavailable'); };
  env.callbacks.onRegisteredSW('/sw.js', env.registration);
  env.advance(60 * 1000);
  assert.equal(await env.lifecycle.checkForUpdate(), false);
  assert.deepEqual(getPwaState().error, { operation: 'check', message: 'Network unavailable' });
  env.registration.update = async () => {};
  env.advance(60 * 1000);
  assert.equal(await env.lifecycle.checkForUpdate(), true);
  assert.equal(getPwaState().error, null);
});

test('registration module and worker failures reach the same error channel', async t => {
  const env = await setup(t);
  let reported;
  env.target.addEventListener('trafficops-pwa-error', event => { reported = event.detail.error; });
  env.callbacks.onRegisterError(new Error('Worker registration denied'));
  assert.deepEqual(reported, { operation: 'register', message: 'Worker registration denied' });
  env.lifecycle.dispose();
  const failed = registerPwa({ windowImpl: env.target, loadRegister: async () => { throw new Error('Module unavailable'); } });
  t.after(() => failed.dispose());
  await failed.ready;
  assert.deepEqual(getPwaState().error, { operation: 'register', message: 'Module unavailable' });
});

test('disposal stops checks, late callbacks, and pending registration without unregistering the worker', async t => {
  const env = await setup(t);
  env.callbacks.onRegisteredSW('/sw.js', env.registration);
  env.lifecycle.dispose();
  assert.equal(env.intervals.size, 0);
  env.advance(60 * 1000);
  env.target.dispatchEvent(new Event('online'));
  assert.equal(await env.lifecycle.checkForUpdate(), false);
  assert.equal(env.updates(), 0);
  const snapshot = getPwaState();
  env.callbacks.onNeedRefresh();
  env.callbacks.onNeedReload();
  assert.equal(getPwaState(), snapshot);
  assert.equal(env.reloads(), 0);
  let resolveRegister, called = false;
  const pending = registerPwa({ windowImpl: env.target, loadRegister: () => new Promise(resolve => { resolveRegister = resolve; }) });
  await Promise.resolve();
  pending.dispose();
  resolveRegister(() => { called = true; });
  await pending.ready;
  assert.equal(called, false);
});

test('unsupported browsers skip registration and duplicate calls reuse one lifecycle', async t => {
  const env = browser();
  delete env.target.navigator.serviceWorker;
  const lifecycle = registerPwa({ windowImpl: env.target, loadRegister: () => { throw new Error('Must not load'); } });
  t.after(() => lifecycle.dispose());
  assert.equal(registerPwa(), lifecycle);
  await lifecycle.ready;
  assert.equal(env.intervals.size, 0);
});
