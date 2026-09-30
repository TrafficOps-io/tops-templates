import { normalizeAiProviderError } from './ai-provider-errors.js';

const recordedTypes = new Set(['phase', 'step', 'step-finished', 'tool-start', 'validation', 'image-start', 'image-error', 'provider-error', 'provider-recovery', 'timeout-recovery', 'request-start', 'request-finished', 'run-finished', 'run-error']);
const stringFields = ['phase', 'tool', 'model', 'provider', 'generationId', 'code', 'outcome'];
const numericFields = ['step', 'request', 'requestBytes', 'seconds', 'status', 'statusCode', 'delayMs', 'retryAfterMs'];

// Explicit fields keep prompts, source, values, attachments and headers out of
// exported logs, even when future progress events add new payload properties.
export function createAiDiagnostics({ model, imageModel, mode, apiKey } = {}) {
  const started = Date.now(), events = [];
  let phase;
  const clean = value => String(value || '').replaceAll(apiKey || '\0', '[redacted]').replace(/\bsk-or-[A-Za-z0-9_-]{8,}\b/g, '[redacted]').slice(0, 160);
  const header = { version: 1, startedAt: new Date(started).toISOString(), model: clean(model), imageModel: clean(imageModel), mode: clean(mode) };
  return {
    record(event) {
      if (!recordedTypes.has(event.type)) return false;
      if (event.type === 'phase') phase = clean(event.phase);
      const entry = { atSeconds: Math.round((Date.now() - started) / 10) / 100, type: event.type, ...(phase ? { phase } : {}) };
      for (const name of stringFields) if (event[name] !== undefined) entry[name] = clean(event[name]);
      for (const name of numericFields) if (Number.isFinite(event[name])) entry[name] = event[name];
      for (const name of ['valid', 'retryable', 'terminal']) if (typeof event[name] === 'boolean') entry[name] = event[name];
      if (event.usage) entry.usage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens'].filter(name => Number.isFinite(event.usage[name])).map(name => [name, event.usage[name]]));
      // Provider messages can echo private input. Keep the detailed explanation
      // in the UI; exports retain only routing identifiers and a fixed category.
      if (event.error) {
        const safe = normalizeAiProviderError({ message: event.error, statusCode: event.statusCode, code: event.code }, { apiKey });
        entry.errorCategory = safe.cancelled ? 'cancelled' : safe.retryable ? 'temporary-provider-failure' : safe.terminalImage ? 'provider-rejection' : 'request-failure';
      }
      events.push(entry); if (events.length > 500) events.shift();
      return true;
    },
    finish(error) {
      if (error) { const safe = normalizeAiProviderError(error, { apiKey }); this.record({ type: 'run-error', error: safe.message, statusCode: safe.statusCode, code: safe.code, provider: safe.provider, generationId: safe.generationId, retryable: safe.retryable }); }
      else this.record({ type: 'run-finished' });
      return this.snapshot();
    },
    snapshot() { return { ...header, durationSeconds: Math.round((Date.now() - started) / 10) / 100, events: structuredClone(events) }; },
  };
}
