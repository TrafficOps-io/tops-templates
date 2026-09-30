import { normalizeAiProviderError } from './ai-provider-errors.js';

function retryDelay(error, fallback) {
  const headers = error?.responseHeaders;
  const hint = headers?.get?.('retry-after') ?? headers?.['retry-after'];
  const seconds = Number(hint);
  const milliseconds = hint && !Number.isFinite(seconds) ? Date.parse(hint) - Date.now() : seconds * 1000;
  return Math.max(fallback, Number.isFinite(milliseconds) ? milliseconds : fallback);
}

function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason || new Error('Generation cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// One shared allowance covers the entire planner/writer/reviewer run. Retrying
// after tool input starts is unsafe: files or paid images may already exist.
export async function runWithAiProviderRecovery(callback, { signal, deadline = Infinity, retryState = { attempted: false }, onProgress, canRetry = () => true, apiKey, delayMs = 2000 } = {}) {
  for (;;) {
    signal?.throwIfAborted();
    try { return await callback(); }
    catch (error) {
      const safe = normalizeAiProviderError(error, { apiKey });
      const delay = retryDelay(error, delayMs);
      const details = { statusCode: safe.statusCode, code: safe.code, provider: safe.provider, generationId: safe.generationId };
      if (signal?.aborted || !safe.retryable || retryState.attempted || !canRetry(safe) || delay > 30000 || Date.now() + delay + 1000 >= deadline) {
        if (delay > 30000 && safe.retryable) safe.message += ` Retry after ${Math.ceil(delay / 1000)} seconds.`;
        onProgress?.({ type: 'provider-error', ...details, error: safe.message, retryable: safe.retryable, retryAfterMs: delay });
        throw safe;
      }
      retryState.attempted = true;
      onProgress?.({ type: 'provider-recovery', ...details, delayMs: delay });
      await pause(delay, signal);
    }
  }
}
