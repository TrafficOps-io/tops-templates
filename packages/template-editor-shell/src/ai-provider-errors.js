const MAX_MESSAGE = 700, MAX_RAW = 16000, MAX_DEPTH = 6;
const transientStatuses = new Set([429, 502, 503, 504]);
const terminalStatuses = new Set([400, 401, 402, 403, 404, 422]);
const cancelledPattern = /\b(?:abort(?:ed)?|cancel(?:led|ed|lation))\b/i;
const moderationPattern = /(?:moderation|content[_ -]?(?:policy|filter)|safety[_ -]?(?:filter|block)|blocked by safety|prohibited content)/i;
const terminalPattern = /(?:invalid (?:api )?key|unauthenticated|authentication (?:failed|required)|permission denied|\bforbidden\b|payment required|insufficient credits|no endpoints found)/i;
const networkPattern = /(?:failed to fetch|fetch failed|networkerror|network(?: request)? (?:error|failed)|connection (?:reset|closed|lost)|provider disconnected|upstream idle timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND)/i;

function statusOf(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : undefined;
  if (number >= 400 && number <= 599) return number;
  if (typeof value === 'string') {
    if (/^(?:rate_limit(?:ed|_exceeded)?|too_many_requests)$/.test(value)) return 429;
    if (/^(?:server_error|bad_gateway|provider_error)$/.test(value)) return 502;
    if (/^(?:service_unavailable|overloaded_error)$/.test(value)) return 503;
    if (/^(?:timeout|gateway_timeout)$/.test(value)) return 504;
  }
}

function safeText(value, apiKey, max = MAX_MESSAGE) {
  let text = String(value || '');
  if (apiKey) text = text.replaceAll(String(apiKey), '[redacted]');
  return text.replace(/\bsk-or-[A-Za-z0-9_-]{8,}\b/g, '[redacted]').replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Provider SDKs expose HTTP and SSE failures differently. Only retain diagnostic
// fields; never copy request bodies, headers or complete provider payloads.
export class AiProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AiProviderError';
    Object.assign(this, details);
  }
}

export function normalizeAiProviderError(error, options = {}) {
  const messages = [], statuses = [], codes = [], seen = new Set();
  let provider = options.provider, generationId = options.generationId, cancelled = false;
  function inspect(value, depth = 0) {
    if (!value || depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      // Large serialized payloads may contain echoed request data. Do not
      // expose their prefix as a diagnostic when bounded parsing is impossible.
      if (value.length > MAX_RAW && /^\s*[\[{]/.test(value)) return;
      if (value.length <= MAX_RAW) {
        try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') { inspect(parsed, depth + 1); return; } } catch {}
      }
      messages.push(value.slice(0, MAX_RAW));
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const item of value.slice(0, 4)) inspect(item, depth + 1); return; }
    if (value.name === 'AbortError' || value.cancelled === true) cancelled = true;
    for (const field of ['statusCode', 'status', 'code']) {
      const status = statusOf(value[field]);
      if (status) statuses.push(status);
      if (field === 'code' && ['string', 'number'].includes(typeof value[field])) codes.push(value[field]);
    }
    if (typeof value.message === 'string' && value.message.trim()) messages.push(value.message.slice(0, MAX_RAW));
    else if (typeof value.detail === 'string') messages.push(value.detail.slice(0, MAX_RAW));
    else if (typeof value.msg === 'string') messages.push(value.msg.slice(0, MAX_RAW));
    provider ||= value.provider_name || value.provider;
    generationId ||= value.generation_id || value.generationId || value.responseHeaders?.['x-generation-id'] || (typeof value.id === 'string' && value.id.startsWith('gen-') ? value.id : undefined);
    for (const field of ['error', 'data', 'metadata', 'raw', 'cause', 'details']) inspect(value[field], depth + 1);
  }
  inspect(error);
  const httpStatus = statusOf(options.status);
  if (httpStatus) statuses.unshift(httpStatus);
  const unique = [...new Set(messages.map(message => safeText(message, options.apiKey)).filter(Boolean))];
  // The nested provider explanation usually contains the actionable cause.
  const detail = unique.at(-1) || (httpStatus ? `OpenRouter request failed (${httpStatus}).` : 'The AI provider request failed.');
  const outer = unique[0];
  const text = outer && outer !== detail && !outer.includes(detail) ? `${detail} (${outer})` : detail;
  // Providers also describe gateway timeouts as "aborted". A provider/HTTP
  // error status takes precedence over wording; explicit local abort markers
  // were already recognized while inspecting the error.
  cancelled ||= !statuses.length && cancelledPattern.test(text);
  const classification = `${text} ${codes.join(' ')}`;
  const moderated = moderationPattern.test(classification);
  const terminalReason = terminalPattern.test(classification);
  const forbiddenStatus = statuses.find(status => status !== 429 && status >= 400 && status < 500);
  const statusCode = forbiddenStatus || httpStatus || statuses.at(-1);
  const retryable = !cancelled && !moderated && !terminalReason && !forbiddenStatus && (statuses.some(status => transientStatuses.has(status)) || networkPattern.test(text));
  const terminalImage = cancelled || moderated || terminalReason || statuses.some(status => terminalStatuses.has(status));
  const safeProvider = safeText(provider, options.apiKey, 100) || undefined;
  const safeGenerationId = safeText(generationId, options.apiKey, 120) || undefined;
  const label = safeProvider && !text.startsWith(`[${safeProvider}] `) ? `[${safeProvider}] ` : '';
  return new AiProviderError(safeText(label + text, options.apiKey), {
    statusCode, code: safeText(codes.at(-1) ?? statusCode, options.apiKey, 80) || undefined,
    provider: safeProvider, generationId: safeGenerationId, retryable, terminalImage, cancelled,
  });
}

export function isRetryableAiProviderError(error) {
  return error instanceof AiProviderError ? error.retryable : normalizeAiProviderError(error).retryable;
}

export function isTerminalImageError(error) {
  return error instanceof AiProviderError ? error.terminalImage : normalizeAiProviderError(error).terminalImage;
}
