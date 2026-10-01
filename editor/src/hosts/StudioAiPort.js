// @ts-check
import { validateOpenRouterApiKey } from '@trafficops/template-editor-shell/openrouter-ai';
import { ConflictError, PolicyError, runOperation } from '@trafficops/template-editor-core';
import { loadOpenRouterSettings, saveOpenRouterSettings, clearOpenRouterSettings } from '../openrouter-settings.js';

/** @returns {import('@trafficops/template-editor-core').AiPort} */
export function createStudioAiPort({ fetchImpl = globalThis.fetch, storage = { load: loadOpenRouterSettings, save: saveOpenRouterSettings, remove: clearOpenRouterSettings }, isEnabled = () => true } = {}) {
  // Addressed runs never share a cancellation slot. Legacy callers retain
  // their exclusive slot because they finish without an identifier.
  const active = new Set();
  const legacy = Symbol('legacy-ai-request');
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
      const saved = await storage.save({ ...value, apiKey: validateOpenRouterApiKey(value.apiKey) });
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
      const key = validateOpenRouterApiKey(value.apiKey);
      let response;
      try {
        response = await guardedFetch('https://openrouter.ai/api/v1/key', { signal, headers: { Authorization: `Bearer ${key}` } });
      } catch (error) {
        if (error instanceof PolicyError || signal?.aborted || error?.name === 'AbortError') throw error;
        throw new Error('Could not reach OpenRouter. Check your network connection and try again.');
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.error?.message;
        const hint = response.status === 401 ? 'OpenRouter rejected the saved API key. Replace it in Settings, save the connection, and try again.'
          : response.status === 403 ? 'OpenRouter denied access for this API key. Check its permissions and account restrictions.'
          : response.status === 429 ? 'OpenRouter is rate limiting requests. Wait and try again.'
          : response.status >= 500 ? 'OpenRouter is temporarily unavailable. Try again later.'
          : 'OpenRouter could not verify the saved API key.';
        const safeDetail = typeof detail === 'string' ? detail.replaceAll(key, '[redacted]').slice(0, 500) : '';
        throw Object.assign(new Error(`OpenRouter (HTTP ${response.status}): ${hint}${safeDetail ? ` ${safeDetail}` : ''}`), { status: response.status });
      }
      return { message: 'Connection works.' };
    }),
  };
  return {
    settings,
    begin({ signal, runId } = {}) {
      if (runId !== undefined && (typeof runId !== 'string' || !runId.trim() || runId.length > 160)) return Promise.reject(new ConflictError('Invalid AI run ID.'));
      const token = runId ?? legacy;
      let acquired = false;
      return runOperation(signal, async () => {
        assertEnabled();
        if (active.has(token) || active.has(legacy) || token === legacy && active.size) throw new ConflictError('An AI request is already running.');
        active.add(token); acquired = true;
        const connection = await storage.load();
        assertEnabled();
        if (!connection.apiKey) throw new PolicyError('Add your OpenRouter connection in Settings first.');
        return { ...configured(connection), apiKey: validateOpenRouterApiKey(connection.apiKey), fetchImpl: guardedFetch };
      }).catch(error => { if (acquired) active.delete(token); throw error; });
    },
    async finish({ runId } = {}) { active.delete(runId ?? legacy); },
  };
}
