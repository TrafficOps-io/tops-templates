import test from 'node:test';
import assert from 'node:assert/strict';
import { captureInstall, getInstallPrompt, installStudio, subscribeInstall } from '../src/install.js';

test('install events captured before a subscriber mounts remain available and are consumed once', async () => {
  const environment = new EventTarget(), dispose = captureInstall(environment);
  let prompts = 0, changes = 0;
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: () => { prompts++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  environment.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(getInstallPrompt(), event);
  const unsubscribe = subscribeInstall(() => changes++);
  const installing = installStudio();
  assert.equal(prompts, 1, 'prompt runs synchronously in the click');
  assert.equal(getInstallPrompt(), null);
  assert.equal(await installStudio(), null, 'a double click never prompts twice');
  assert.deepEqual(await installing, { outcome: 'accepted' });
  assert.equal(changes, 1);
  unsubscribe(); dispose();
});
test('dismissal, failure, and appinstalled clear stale prompts while allowing a later event', async () => {
  const environment = new EventTarget(), dispose = captureInstall(environment);
  const dispatch = prompt => { const event = Object.assign(new Event('beforeinstallprompt'), { prompt }); environment.dispatchEvent(event); };
  dispatch(async () => ({ outcome: 'dismissed' }));
  assert.deepEqual(await installStudio(), { outcome: 'dismissed' });
  dispatch(() => { throw new Error('Installation unavailable'); });
  await assert.rejects(installStudio(), /Installation unavailable/);
  assert.equal(getInstallPrompt(), null);
  dispatch(async () => ({ outcome: 'accepted' }));
  assert.ok(getInstallPrompt());
  environment.dispatchEvent(new Event('appinstalled'));
  assert.equal(getInstallPrompt(), null);
  dispose();
  dispatch(async () => ({}));
  assert.equal(getInstallPrompt(), null, 'listeners are removed on disposal');
});
