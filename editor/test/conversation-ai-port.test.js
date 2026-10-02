import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioAiPort } from '../src/hosts/StudioAiPort.js';

const port = () => createStudioAiPort({ storage: { load: async () => ({ apiKey: 'sk-or-test', model: 'test/model', imageModel: '' }), save: async value => value, remove: async () => {} } });

test('addressed connections can coexist and finish releases only that run', async () => {
  const ai = port();
  await ai.begin({ runId: 'a' }); await ai.begin({ runId: 'b' });
  await assert.rejects(ai.begin({ runId: 'a' }), /already running/);
  await ai.finish({ runId: 'b' });
  await assert.rejects(ai.begin({ runId: 'a' }), /already running/, 'rejected duplicate must not release its existing owner');
  await ai.begin({ runId: 'b' }); await ai.finish();
  await assert.rejects(ai.begin({ runId: 'b' }), /already running/, 'legacy finish must not release an addressed run');
  await ai.finish({ runId: 'a' }); await ai.finish({ runId: 'b' });
  await ai.begin(); await ai.finish();
});

test('legacy callers retain exclusive ownership and failures release only their own reservation', async () => {
  const ai = port(); await ai.begin();
  await assert.rejects(ai.begin({ runId: 'a' }), /already running/); await assert.rejects(ai.begin(), /already running/);
  await ai.finish({ runId: 'a' }); await assert.rejects(ai.begin(), /already running/);
  await ai.finish(); await ai.begin({ runId: 'a' }); await assert.rejects(ai.begin(), /already running/); await ai.finish({ runId: 'a' });
});
