import { normalizeAiProviderError } from './ai-provider-errors.js';

const encoder = new TextEncoder();
const tokenCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const safeLabel = (value, apiKey, max = 120) => (apiKey ? value.replaceAll(apiKey, '[redacted]') : value).replace(/\bsk-or-[A-Za-z0-9_-]{8,}\b/g, '[redacted]').slice(0, max);

function eventEnd(bytes, final) {
  const lineEnd = index => bytes[index] === 10 ? index + 1 : bytes[index] === 13
    ? bytes[index + 1] === 10 ? index + 2 : index + 1 === bytes.length && !final ? undefined : index + 1
    : undefined;
  for (let index = 0; index < bytes.length;) {
    const first = lineEnd(index);
    if (!first) { index++; continue; }
    const second = lineEnd(first);
    if (second) return second;
    index = first;
  }
}

function requestInfo(options, apiKey) {
  const body = options?.body;
  const requestBytes = typeof body === 'string' ? encoder.encode(body).byteLength : body?.byteLength;
  let model;
  if (typeof body === 'string') {
    try {
      const value = JSON.parse(body).model;
      if (typeof value === 'string') model = safeLabel(value, apiKey, 200);
    } catch {}
  }
  return { model, requestBytes: Number.isFinite(requestBytes) ? requestBytes : undefined };
}

function stringEnd(text, start) {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '"') return index + 1;
  }
  return text.length;
}

function valueEnd(text, start) {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] !== '{' && text[start] !== '[') {
    let end = start;
    while (end < text.length && !/[\s,}\]]/.test(text[end])) end++;
    return end;
  }
  let depth = 1;
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '"') { index = stringEnd(text, index) - 1; continue; }
    if (text[index] === '{' || text[index] === '[') depth++;
    else if ((text[index] === '}' || text[index] === ']') && !--depth) return index + 1;
  }
  return text.length;
}

// Locate a JSON value without reserializing its neighbors. Signed reasoning
// details and every unrelated byte must remain exactly as the provider sent it.
function propertySpan(text, start, name) {
  if (text[start] !== '{') return;
  let index = start + 1, found;
  while (index < text.length) {
    while (/[\s,]/.test(text[index] || '') && index < text.length) index++;
    if (text[index] !== '"') return found;
    const keyEnd = stringEnd(text, index), key = JSON.parse(text.slice(index, keyEnd));
    index = keyEnd;
    while (/\s/.test(text[index] || '') && index < text.length) index++;
    if (text[index++] !== ':') return found;
    while (/\s/.test(text[index] || '') && index < text.length) index++;
    const end = valueEnd(text, index);
    if (key === name) found = { start: index, end };
    index = end;
  }
  return found;
}

function inspectUsage(payload, state) {
  if (!payload?.usage || typeof payload.usage !== 'object') return;
  const usage = {
    inputTokens: tokenCount(payload.usage.prompt_tokens ?? payload.usage.input_tokens),
    outputTokens: tokenCount(payload.usage.completion_tokens ?? payload.usage.output_tokens),
    totalTokens: tokenCount(payload.usage.total_tokens),
    reasoningTokens: tokenCount(payload.usage.completion_tokens_details?.reasoning_tokens ?? payload.usage.output_tokens_details?.reasoning_tokens),
  };
  const defined = Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
  if (Object.keys(defined).length) state.usage = defined;
}

function inspectEvent(event, state, apiKey) {
  const data = [], lines = [];
  let offset = 0, dataOffset = 0;
  for (const match of event.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue;
    const bom = offset === 0 && match[1].startsWith('\uFEFF') ? 1 : 0, line = match[1].slice(bom);
    if (line.startsWith('data:')) {
      const prefix = line[5] === ' ' ? 6 : 5, value = line.slice(prefix);
      lines.push({ start: offset + bom + prefix, dataOffset, value });
      data.push(value); dataOffset += value.length + 1;
    }
    offset += match[0].length;
  }
  const text = data.join('\n');
  if (!text || text === '[DONE]') return event;
  let payload;
  try { payload = JSON.parse(text); } catch { return event; }
  if (!payload || typeof payload !== 'object') return event;
  if (!state.generationId && typeof payload.id === 'string' && /^(?:gen-|cmpl-)/.test(payload.id)) state.generationId = safeLabel(payload.id, apiKey);
  inspectUsage(payload, state);
  if (!payload.error || typeof payload.error !== 'object') return event;
  const failure = normalizeAiProviderError(payload, { apiKey, status: state.status, generationId: state.generationId });
  state.failure = failure;
  const errorSpan = propertySpan(text, text.search(/\S/), 'error');
  const messageSpan = errorSpan && propertySpan(text, errorSpan.start, 'message');
  if (!messageSpan) return event;
  const line = lines.find(item => messageSpan.start >= item.dataOffset && messageSpan.end <= item.dataOffset + item.value.length);
  if (!line) return event;
  const start = line.start + messageSpan.start - line.dataOffset, end = line.start + messageSpan.end - line.dataOffset;
  return event.slice(0, start) + JSON.stringify(failure.message) + event.slice(end);
}

export function createAiDiagnosticFetch(fetchImpl = globalThis.fetch, { onProgress, apiKey } = {}) {
  let sequence = 0;
  const emit = event => { try { onProgress?.(event); } catch {} };
  return async function diagnosticFetch(input, options) {
    const requestId = ++sequence, started = Date.now(), info = requestInfo(options, apiKey);
    const state = {}, seconds = () => Math.max(0, (Date.now() - started) / 1000);
    let finished = false;
    const finish = outcome => {
      if (finished) return;
      finished = true;
      const failure = state.failure;
      emit({ type: 'request-finished', request: requestId, requestId, ...info, status: state.status, generationId: state.generationId,
        seconds: seconds(), outcome: failure?.cancelled ? 'cancelled' : failure ? 'error' : outcome, ...(state.usage ? { usage: state.usage } : {}),
        ...(failure ? { error: failure.message, statusCode: failure.statusCode, code: failure.code, provider: failure.provider, retryable: failure.retryable } : {}),
      });
    };
    emit({ type: 'request-start', request: requestId, requestId, ...info, seconds: 0 });
    let response;
    try { response = await fetchImpl(input, options); }
    catch (error) { state.failure = normalizeAiProviderError(error, { apiKey }); finish('error'); throw error; }
    state.status = response.status;
    const generationId = response.headers.get('X-Generation-Id');
    state.generationId = generationId ? safeLabel(generationId, apiKey) : undefined;
    if (!response.ok) state.failure = normalizeAiProviderError({ message: `OpenRouter request failed (${response.status}).` }, { apiKey, status: state.status, generationId: state.generationId });
    if (!response.body) { finish(response.ok ? 'complete' : 'error'); return response; }
    const sse = /(?:^|;)\s*text\/event-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { ignoreBOM: true }), queue = [];
    // Observe JSON during ordinary consumption, never clone/drain a response.
    // Successful image responses contain large base64 assets and are excluded.
    const textChat = /\/chat\/completions(?:[?#]|$)/.test(typeof input === 'string' ? input : input?.url || '');
    const captureLimit = !sse && (!response.ok || textChat) ? response.ok ? 128 * 1024 : 16 * 1024 : 0;
    let capturedBytes = 0, captureOverflow = false;
    const captured = [];
    let pending = new Uint8Array(0), ended = false;
    const inspectBytes = bytes => {
      const text = decoder.decode(bytes), transformed = inspectEvent(text, state, apiKey);
      return transformed === text ? bytes : encoder.encode(transformed);
    };
    function inspectJson() {
      if (!capturedBytes || captureOverflow) return;
      const bytes = new Uint8Array(capturedBytes);
      let offset = 0;
      for (const chunk of captured) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      captured.length = 0;
      try {
        const payload = JSON.parse(decoder.decode(bytes));
        inspectUsage(payload, state);
        if (payload?.error) state.failure = normalizeAiProviderError(payload, { apiKey, status: state.status, generationId: state.generationId });
      } catch {}
    }
    function collect(final = false) {
      let end;
      while ((end = eventEnd(pending, final))) {
        queue.push(inspectBytes(pending.subarray(0, end)));
        pending = pending.subarray(end);
      }
      if (final && pending.length) { queue.push(inspectBytes(pending)); pending = new Uint8Array(0); }
    }
    const body = new ReadableStream({
      async pull(controller) {
        try {
          while (!queue.length && !ended) {
            const result = await reader.read();
            if (result.done) {
              ended = true;
              if (sse) collect(true);
              else inspectJson();
              reader.releaseLock();
            } else if (sse) {
              if (!pending.length) pending = result.value;
              else { const combined = new Uint8Array(pending.length + result.value.length); combined.set(pending); combined.set(result.value, pending.length); pending = combined; }
              collect();
            }
            else {
              if (captureLimit && !captureOverflow) {
                if (capturedBytes + result.value.byteLength > captureLimit) { captureOverflow = true; captured.length = 0; }
                else { captured.push(result.value); capturedBytes += result.value.byteLength; }
              }
              queue.push(result.value);
            }
          }
          if (queue.length) controller.enqueue(queue.shift());
          else { finish(response.ok ? 'complete' : 'error'); controller.close(); }
        } catch (error) {
          state.failure = normalizeAiProviderError(error, { apiKey, status: state.status, generationId: state.generationId });
          finish('error'); controller.error(error);
          try { reader.releaseLock(); } catch {}
        }
      },
      async cancel(reason) {
        ended = true;
        finish('cancelled');
        try { await reader.cancel(reason); } finally { try { reader.releaseLock(); } catch {} }
      },
    }, { highWaterMark: 0 });
    const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    // Response constructors do not carry fetch identity fields across.
    for (const name of ['url', 'redirected', 'type']) Object.defineProperty(wrapped, name, { value: response[name] });
    return wrapped;
  };
}

/**
 * Lightweight per-run timing: provider requests and wall time. countRequest()
 * is called once per outgoing provider HTTP request (chat or image);
 * record(event) sums the request-finished durations of diagnostic fetches.
 */
export function createRunTimings(now = Date.now) {
  const started = now();
  let providerCalls = 0, providerMs = 0;
  return {
    countRequest() { providerCalls++; },
    record(event) { if (event?.type === 'request-finished' && Number.isFinite(event.seconds)) providerMs += Math.round(event.seconds * 1000); },
    snapshot() { return { providerCalls, providerMs, durationMs: Math.max(0, now() - started) }; },
  };
}
