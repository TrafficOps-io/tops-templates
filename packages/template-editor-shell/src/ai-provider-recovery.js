import { normalizeAiProviderError } from './ai-provider-errors.js';
import { MAX_PROVIDER_RETRIES, RETRY_AFTER_CAP_MS, retryAfterMs, retryDecision } from './ai-retry-policy.js';

function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason || new Error('Generation cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

let sleepOverride = null;
/** Tests replace the wait (not the decision): workflows deep inside a run keep their real retry policy. */
export function setAiRetrySleepForTesting(sleep) { sleepOverride = typeof sleep === 'function' ? sleep : null; }

// Each provider request gets up to three retries, but only while nothing was
// received (canRetry() is false once text, reasoning or tool input arrived, or
// a tool already changed the draft). retryState is accepted for compatibility;
// the policy is per request, not per run.
export async function runWithAiProviderRecovery(callback, { signal, deadline = Infinity, onProgress, canRetry = () => true, apiKey, sleep, random } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await callback(); }
    catch (error) {
      const safe = normalizeAiProviderError(error, { apiKey });
      const hint = retryAfterMs(error?.responseHeaders);
      const details = { statusCode: safe.statusCode, code: safe.code, provider: safe.provider, generationId: safe.generationId };
      const decision = signal?.aborted || safe.cancelled ? { retry: false, delayMs: 0 }
        : retryDecision({ status: safe.statusCode, sawOutput: !canRetry(safe), attempt, retryAfterMs: hint, random });
      if (!decision.retry || Date.now() + decision.delayMs + 1000 >= deadline) {
        if (hint > RETRY_AFTER_CAP_MS && safe.retryable) safe.message += ` Retry after ${Math.ceil(hint / 1000)} seconds.`;
        onProgress?.({ type: 'provider-error', ...details, error: safe.message, retryable: safe.retryable, ...(hint !== undefined ? { retryAfterMs: hint } : {}) });
        throw safe;
      }
      onProgress?.({ type: 'provider-recovery', ...details, attempt: attempt + 1, maxAttempts: MAX_PROVIDER_RETRIES, delayMs: decision.delayMs });
      await (sleep || sleepOverride || pause)(decision.delayMs, signal);
      signal?.throwIfAborted();
    }
  }
}
