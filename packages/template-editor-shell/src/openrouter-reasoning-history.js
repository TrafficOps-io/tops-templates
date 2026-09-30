const reasoningDetails = options => options?.openrouter?.reasoning_details;
const copy = value => structuredClone(value);
const sdkFormats = new Set(['unknown', 'openai-responses-v1', 'azure-openai-responses-v1', 'xai-responses-v1', 'anthropic-claude-v1', 'google-gemini-v1']);
const nullableString = value => value == null || typeof value === 'string';

// Match the installed provider's accepted shapes without stripping opaque
// extra fields from valid blocks. Malformed entries remain excluded by the SDK.
function validShape(detail) {
  if (!detail || typeof detail !== 'object' || !nullableString(detail.id)
    || detail.index !== undefined && !Number.isFinite(detail.index)
    || detail.format != null && !sdkFormats.has(detail.format)) return false;
  if (detail.type === 'reasoning.text') return nullableString(detail.text) && nullableString(detail.signature);
  if (detail.type === 'reasoning.encrypted') return typeof detail.data === 'string';
  if (detail.type === 'reasoning.summary') return typeof detail.summary === 'string';
  return false;
}

// Keep the provider's existing safety filter for unsigned Claude/Gemini text.
// The compatibility layer only restores valid details removed by deduplication.
function validDetails(details) {
  return details.filter(detail => validShape(detail) && (detail.type !== 'reasoning.text'
    || !['anthropic-claude-v1', 'google-gemini-v1'].includes(detail.format ?? 'anthropic-claude-v1')
    || !!detail.signature));
}

function assistantDetails(message) {
  const own = reasoningDetails(message.providerOptions);
  if (Array.isArray(own)) return own;
  const content = Array.isArray(message.content) ? message.content : [];
  // OpenRouter attaches the complete turn sequence to the first tool call.
  for (const part of content) {
    const details = reasoningDetails(part.providerOptions);
    if (part.type === 'tool-call' && Array.isArray(details) && details.length) return details;
  }
  // The wrapper attaches the complete sequence to visible reasoning parts
  // in both streaming and non-streaming results.
  for (const part of content) {
    const details = reasoningDetails(part.providerOptions);
    if (part.type === 'reasoning' && Array.isArray(details) && details.length) return details;
  }
  // Encrypted-only text answers have no visible reasoning part or tool call.
  for (const part of content) {
    const details = reasoningDetails(part.providerOptions);
    if (part.type === 'text' && Array.isArray(details) && details.length) return details;
  }
}

function historyFetch(fetchImpl, prompt) {
  const history = prompt.filter(message => message.role === 'assistant').map(message => {
    const details = assistantDetails(message);
    return Array.isArray(details) ? copy(validDetails(details)) : undefined;
  });
  return (input, options) => {
    if (!history.some(Array.isArray) || typeof options?.body !== 'string') return fetchImpl(input, options);
    let body;
    try { body = JSON.parse(options.body); } catch { return fetchImpl(input, options); }
    if (!Array.isArray(body.messages)) return fetchImpl(input, options);
    let assistant = 0, changed = false;
    for (const message of body.messages) {
      if (message.role !== 'assistant') continue;
      const details = history[assistant++];
      if (details !== undefined) { message.reasoning_details = details; changed = true; }
    }
    return fetchImpl(input, changed ? { ...options, body: JSON.stringify(body) } : options);
  };
}

function sameBlock(previous, detail) {
  const hasId = value => typeof value.id === 'string' && !!value.id;
  const hasIndex = value => Number.isFinite(value.index);
  if (hasId(previous) && hasId(detail) && previous.id !== detail.id) return false;
  if (hasIndex(previous) && hasIndex(detail) && previous.index !== detail.index) return false;
  if (hasId(previous) && hasId(detail) || hasIndex(previous) && hasIndex(detail)) return true;
  // Ordinary unlabelled text deltas continue until their signature arrives.
  // A signed block is complete; never guess that its signature is a fragment.
  return !hasId(detail) && !hasIndex(detail);
}

function appendDetails(details, delta) {
  for (const source of delta) {
    if (!validShape(source)) continue;
    const detail = copy(source), previous = details.at(-1);
    if (detail.type === 'reasoning.text' && previous?.type === 'reasoning.text'
      && !previous.signature && sameBlock(previous, detail)) {
      const text = (previous.text ?? '') + (detail.text ?? '');
      // Streaming text is a delta, while a late signature is an opaque value.
      // Preserve identity fields when a continuation omits them or uses null.
      for (const [key, value] of Object.entries(detail)) if (value != null) previous[key] = value;
      if (previous.text != null || detail.text != null) previous.text = text;
    } else details.push(detail);
  }
}

function withReasoningMetadata(part, details) {
  return {
    ...part,
    providerMetadata: {
      ...part.providerMetadata,
      openrouter: { ...part.providerMetadata?.openrouter, reasoning_details: details },
    },
  };
}

/**
 * Contain OpenRouter 3.0's adjacent-text merge and cross-message deduplication.
 * Each call owns its SDK model, fetch closure and raw reasoning accumulator.
 * SSE bytes, tool calls, cancellation and all unrelated metadata stay intact.
 */
export function createReasoningSafeOpenRouterModel(createModelWithFetch, fetchImpl = globalThis.fetch) {
  const base = createModelWithFetch(fetchImpl);
  return Object.assign(Object.create(base), {
    async doGenerate(options) {
      const model = createModelWithFetch(historyFetch(fetchImpl, options.prompt));
      const result = await model.doGenerate(options);
      const details = reasoningDetails(result.providerMetadata);
      if (!details?.length) return result;
      return { ...result, content: result.content.map(part => ['text', 'reasoning'].includes(part.type) ? withReasoningMetadata(part, details) : part) };
    },
    async doStream(options) {
      const model = createModelWithFetch(historyFetch(fetchImpl, options.prompt));
      const result = await model.doStream({ ...options, includeRawChunks: true });
      const details = [];
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            if (part.type === 'raw') {
              const delta = part.rawValue?.choices?.[0]?.delta?.reasoning_details;
              if (Array.isArray(delta)) appendDetails(details, delta);
              if (options.includeRawChunks) controller.enqueue(part);
              return;
            }
            // Keep the same array alive through finish: a tool call can finish
            // before the provider sends its final reasoning signature/blocks.
            if (['reasoning-end', 'tool-call', 'finish'].includes(part.type) || part.type === 'text-end' && details.length) {
              controller.enqueue(withReasoningMetadata(part, details));
            } else controller.enqueue(part);
          },
        })),
      };
    },
  });
}
