// Provider retry policy (spec 2.2). A provider that rejected a request before
// generating anything (no text, reasoning or tool-input chunk) did not bill it
// and cannot have produced side effects, so it is safe to repeat. Once output
// started the outcome is unknown: the user repeats explicitly.
export const RETRYABLE_STATUSES = Object.freeze([408, 429, 500, 502, 503, 504, 529]);
export const MAX_PROVIDER_RETRIES = 3;
export const RETRY_AFTER_CAP_MS = 20000;
export const RETRY_BACKOFF_MS = Object.freeze([1000, 3000, 7000]);
/**
 * Absolute safety cap for one run: retries do not spend step/call budgets, so
 * a provider that keeps failing before output is bounded by this shared pool.
 */
export function runRetryBudget(calls) { return { remaining: MAX_PROVIDER_RETRIES * calls }; }
const JITTER = 0.2;

/**
 * Pure decision for one failed provider request.
 * attempt — retries already made for this request (0 after the first failure).
 * retryAfterMs — parsed Retry-After hint, if any.
 * random — injectable [0, 1) source for the ±20 % jitter.
 * @returns {{ retry: boolean, delayMs: number }}
 */
export function retryDecision({ status, sawOutput = false, attempt = 0, retryAfterMs, random = Math.random } = {}) {
  if (sawOutput || !RETRYABLE_STATUSES.includes(status) || !(attempt >= 0) || attempt >= MAX_PROVIDER_RETRIES) return { retry: false, delayMs: 0 };
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return { retry: true, delayMs: Math.round(Math.min(retryAfterMs, RETRY_AFTER_CAP_MS)) };
  const base = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
  const factor = 1 - JITTER + 2 * JITTER * Math.min(Math.max(Number(random()) || 0, 0), 1);
  return { retry: true, delayMs: Math.round(base * factor) };
}

/** Retry-After as milliseconds: delta seconds or an HTTP date. Undefined when absent or unparseable. */
export function retryAfterMs(headers, now = Date.now()) {
  const hint = headers?.get?.('retry-after') ?? headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (hint === undefined || hint === null || hint === '') return undefined;
  const seconds = Number(hint);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(hint);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
