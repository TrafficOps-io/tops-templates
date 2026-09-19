// @ts-check
import { ConflictError, PolicyError, runOperation } from '@trafficops/template-editor-core';
import { loadOpenRouterSettings, saveOpenRouterSettings, clearOpenRouterSettings } from '../openrouter-settings.js';

/** @returns {import('@trafficops/template-editor-core').AiPort} */
export function createStudioAiPort({ fetchImpl = globalThis.fetch, storage = { load: loadOpenRouterSettings, save: saveOpenRouterSettings, remove: clearOpenRouterSettings }, isEnabled = () => true } = {}) {
  let active = null;
  function assertEnabled() {
    if (!isEnabled()) throw new PolicyError('AI is available only in the installed Studio app.');
  }
  // A connection may outlive the installed-app view that created it.
  /** @type {typeof globalThis.fetch} */
  const guardedFetch = async (...args) => { assertEnabled(); return fetchImpl(...args); };
  const configured = value => ({ ...value, configured: Boolean(value.apiKey) });
  /** @type {import('@trafficops/template-editor-core').UserAiSettings} */
  const settings = {
    owner: 'user',
    load: ({ signal } = {}) => runOperation(signal, async () => {
      assertEnabled();
      const value = await storage.load();
      assertEnabled();
      return configured(value);
    }),
    save: (value, { signal } = {}) => runOperation(signal, async () => {
      assertEnabled();
      const saved = await storage.save(value);
      assertEnabled();
      return configured(saved);
    }, 'validation'),
    remove: ({ signal } = {}) => runOperation(signal, async () => {
      assertEnabled();
      await storage.remove();
      assertEnabled();
    }),
    test: ({ signal } = {}) => runOperation(signal, async () => {
      assertEnabled();
      const value = await storage.load();
      assertEnabled();
      if (!value.apiKey) throw new PolicyError('Add your OpenRouter connection in Settings first.');
      const response = await guardedFetch('https://openrouter.ai/api/v1/key', { signal, headers: { Authorization: `Bearer ${value.apiKey}` } });
      if (!response.ok) throw Object.assign(new Error('The AI connection check failed.'), { status: response.status });
      return { message: 'Connection works.' };
    }),
  };
  return {
    settings,
    begin({ signal } = {}) {
      const token = {};
      return runOperation(signal, async () => {
        assertEnabled();
        if (active) throw new ConflictError('An AI request is already running.');
        active = token;
        const connection = await storage.load();
        assertEnabled();
        if (!connection.apiKey) throw new PolicyError('Add your OpenRouter connection in Settings first.');
        return { ...configured(connection), fetchImpl: guardedFetch };
      }).catch(error => { if (active === token) active = null; throw error; });
    },
    async finish() { active = null; },
  };
}
