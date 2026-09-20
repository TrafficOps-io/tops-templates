import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOpenRouterApiKey, requestOpenRouter } from '@trafficops/template-editor-shell/openrouter-ai';
import { createOpenRouterTemplateModel } from '@trafficops/template-editor-shell/openrouter-template-agent';
import { generateImageWithOpenRouter } from '@trafficops/template-editor-shell/openrouter-images';
import { createStudioAiPort } from '../src/hosts/StudioAiPort.js';
import { saveOpenRouterSettings } from '../src/openrouter-settings.js';

const invalidKeys = ['sk-or-ключ', 'sk-or-…', 'sk-or-\u200bsecret', 'sk-or-é', 'sk-or-\nsecret', 'sk-or- secret', 'sk-or-\u007fsecret'];
const invalidKeyError = /API key contains invalid characters/;
const noFetch = async () => assert.fail('Invalid credentials must never reach the network');

for (const apiKey of invalidKeys) {
  test(`reject malformed credentials before Headers construction: ${JSON.stringify(apiKey)}`, async () => {
    assert.throws(() => validateOpenRouterApiKey(apiKey), invalidKeyError);
    assert.throws(() => createOpenRouterTemplateModel({ apiKey, fetchImpl: noFetch }), invalidKeyError);
    await assert.rejects(requestOpenRouter({ apiKey, fetchImpl: noFetch }), invalidKeyError);
    await assert.rejects(generateImageWithOpenRouter({ apiKey, imageModel: 'test/model', prompt: 'Image', fetchImpl: noFetch }), invalidKeyError);
    await assert.rejects(saveOpenRouterSettings({ apiKey }), invalidKeyError);
  });
}

test('Studio rejects malformed saved credentials and releases the active request for a retry', async () => {
  let value = { apiKey: invalidKeys[0], model: 'test/model' };
  const ai = createStudioAiPort({
    storage: { load: async () => value, save: async () => assert.fail('Do not persist invalid credentials'), remove: async () => {} },
    fetchImpl: noFetch,
  });
  await assert.rejects(ai.settings.save(value), invalidKeyError);
  await assert.rejects(ai.settings.test(), invalidKeyError);
  await assert.rejects(ai.begin(), invalidKeyError);
  value = { ...value, apiKey: '  sk-or-test-secret  ' };
  const connection = await ai.begin();
  assert.equal(connection.apiKey, 'sk-or-test-secret');
  assert.doesNotThrow(() => new Headers({ Authorization: `Bearer ${connection.apiKey}` }));
  await ai.finish();
});

test('validation does not expose invalid secrets and preserves valid keys', () => {
  assert.equal(validateOpenRouterApiKey('\n sk-or-test-secret \t'), 'sk-or-test-secret');
  assert.throws(() => validateOpenRouterApiKey('  '), /Add an OpenRouter API key/);
  for (const apiKey of invalidKeys) {
    assert.throws(() => validateOpenRouterApiKey(apiKey), error => !error.message.includes(apiKey));
  }
});
