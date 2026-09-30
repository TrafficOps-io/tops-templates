import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { createOpenRouterTemplateModel } from '@trafficops/template-editor-shell/openrouter-template-agent';

const signed = (index, text = `Private reasoning ${index}`, signature = `private-signature-${index}`) => ({
  type: 'reasoning.text', id: `reasoning-${index}`, index, format: 'anthropic-claude-v1', text, signature,
});
const encrypted = index => ({ type: 'reasoning.encrypted', id: `encrypted-${index}`, index, format: 'openai-responses-v1', data: `opaque-${index}` });
const calls = turn => Array.from({ length: 4 }, (_, index) => ({
  index, id: `call-${turn}-${index}`, type: 'function', function: { name: 'inspect', arguments: JSON.stringify({ path: `file-${index}.txt` }) },
}));
const event = (delta, finish_reason = null) => ({ id: 'gen-free-fixture', model: 'test/model', choices: [{ index: 0, delta, finish_reason }] });
const sse = events => new Response(events.map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', {
  headers: { 'Content-Type': 'text/event-stream' },
});
const finalEvents = [event({ role: 'assistant', content: 'Complete.' }, 'stop')];
const tools = { inspect: tool({ inputSchema: z.object({ path: z.string() }), execute: async ({ path }) => ({ inspected: path }) }) };

async function streamedTurns(turns, { includeRawChunks = false, progress = [] } = {}) {
  const requests = [], raw = [];
  const model = createOpenRouterTemplateModel({ apiKey: 'sk-or-free-fixture', model: 'test/model', onProgress: value => progress.push(value), fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return sse(turns[requests.length - 1] || finalEvents);
  } });
  const response = await new ToolLoopAgent({ model, tools, stopWhen: stepCountIs(turns.length + 1) }).stream({ prompt: 'Inspect four files.', includeRawChunks });
  for await (const part of response.fullStream) {
    if (part.type === 'error') throw part.error;
    if (part.type === 'raw') raw.push(part.rawValue);
  }
  return { requests, raw, steps: await response.steps, progress };
}

function turn(detailGroups, index = 0) {
  return [event({ role: 'assistant' }), ...detailGroups.map(reasoning_details => event({ reasoning_details })), event({ tool_calls: calls(index) }), event({}, 'tool_calls')];
}
const assistants = request => request.messages.filter(message => message.role === 'assistant');
function assertFourTools(request, index = 0) {
  const assistant = assistants(request).at(-1);
  assert.deepEqual(assistant.tool_calls.map(call => call.id), calls(index).map(call => call.id));
  assert.deepEqual(request.messages.filter(message => message.role === 'tool').slice(-4).map(message => message.tool_call_id), calls(index).map(call => call.id));
}

for (const together of [false, true]) test(`actual SDK preserves two signed blocks and four parallel tool calls (${together ? 'same SSE array' : 'separate SSE events'})`, async () => {
  const details = [signed(0), signed(1)];
  const result = await streamedTurns([turn(together ? [details] : details.map(detail => [detail]))]);
  assert.deepEqual(assistants(result.requests[1])[0].reasoning_details, details);
  assertFourTools(result.requests[1]);
  assert.equal(result.steps.length, 2);
});

test('same id/index text deltas receive their late full signature without merging the next signed block', async () => {
  const first = signed(0, 'First fragment. Second fragment.');
  const result = await streamedTurns([turn([
    [{ ...first, text: 'First fragment. ', signature: null }],
    [{ ...first, text: 'Second fragment.', signature: null }],
    [{ type: 'reasoning.text', id: first.id, index: first.index, format: first.format, signature: first.signature }],
    [signed(1)],
  ])]);
  assert.deepEqual(assistants(result.requests[1])[0].reasoning_details, [first, signed(1)]);
});

test('unlabelled unsigned text deltas join until their full signature, then retain distinct signed blocks', async () => {
  const details = [{ type: 'reasoning.text', text: 'First second', signature: 'first-signature' }, { type: 'reasoning.text', text: 'Third', signature: 'third-signature' }];
  const result = await streamedTurns([turn([
    [{ type: 'reasoning.text', text: 'First ' }],
    [{ type: 'reasoning.text', text: 'second' }],
    [{ type: 'reasoning.text', signature: 'first-signature' }],
    [details[1]],
  ])]);
  assert.deepEqual(assistants(result.requests[1])[0].reasoning_details, details);
});

test('four encrypted blocks keep their original order and opaque values', async () => {
  const details = Array.from({ length: 4 }, (_, index) => ({ ...encrypted(index), opaque_extension: { original: `雪-${index}` } }));
  const result = await streamedTurns([turn(details.map(detail => [detail]))]);
  assert.deepEqual(assistants(result.requests[1])[0].reasoning_details, details);
  assertFourTools(result.requests[1]);
});

test('late encrypted reasoning updates metadata already attached to completed tool calls', async () => {
  const details = [encrypted(0), encrypted(1)];
  const result = await streamedTurns([[event({ role: 'assistant', tool_calls: calls(0) }), event({ reasoning_details: details }), event({}, 'tool_calls')]]);
  assert.deepEqual(assistants(result.requests[1])[0].reasoning_details, details);
  for (const call of result.steps[0].toolCalls) assert.deepEqual(call.providerMetadata.openrouter.reasoning_details, details);
  assertFourTools(result.requests[1]);
});

test('late signed blocks update a reasoning part closed before those blocks arrived', async () => {
  const details = [signed(0), signed(1)], requests = [];
  const model = createOpenRouterTemplateModel({ apiKey: 'dummy', model: 'test/model', fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? sse([
      event({ reasoning: 'Legacy thinking text.' }), event({ content: 'An answer.' }),
      event({ reasoning_details: details }), event({}, 'stop'),
    ]) : sse(finalEvents);
  } });
  const agent = new ToolLoopAgent({ model, tools, stopWhen: stepCountIs(2) });
  const first = await agent.stream({ prompt: 'First question.' });
  await consume(first.fullStream);
  const history = (await first.response).messages;
  const next = await agent.stream({ messages: [{ role: 'user', content: 'First question.' }, ...history, { role: 'user', content: 'Continue.' }] });
  await consume(next.fullStream);
  assert.deepEqual(assistants(requests[1])[0].reasoning_details, details);
});

for (const stream of [true, false]) for (const mixed of [false, true]) test(`${stream ? 'streaming' : 'non-streaming'} ${mixed ? 'mixed signed/encrypted' : 'encrypted-only'} text answers retain reasoning in the next conversation turn`, async () => {
  const details = mixed ? [encrypted(0), signed(1), encrypted(2), signed(3)] : [encrypted(0), encrypted(1)], requests = [];
  const model = createOpenRouterTemplateModel({ apiKey: 'dummy', model: 'test/model', fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const first = requests.length === 1;
    if (stream) return sse(first ? [event({ reasoning_details: details }), event({ content: 'An answer.' }, 'stop')] : finalEvents);
    return new Response(JSON.stringify({ id: 'gen-free-fixture', model: 'test/model', choices: [{ index: 0,
      message: { role: 'assistant', content: first ? 'An answer.' : 'Complete.', ...(first ? { reasoning_details: details } : {}) }, finish_reason: 'stop',
    }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const agent = new ToolLoopAgent({ model, tools, stopWhen: stepCountIs(2) });
  const first = stream ? await agent.stream({ prompt: 'First question.' }) : await agent.generate({ prompt: 'First question.' });
  if (stream) await consume(first.fullStream);
  const history = (await first.response).messages;
  const messages = [{ role: 'user', content: 'First question.' }, ...history, { role: 'user', content: 'Continue.' }];
  if (stream) await consume((await agent.stream({ messages })).fullStream);
  else await agent.generate({ messages });
  assert.deepEqual(assistants(requests[1])[0].reasoning_details, details);
});

test('equal text with distinct signatures survives within and across assistant messages', async () => {
  const first = [signed(0, 'Same text', 'first-signature'), signed(1, 'Same text', 'second-signature')];
  const second = [signed(2, 'Same text', 'third-signature'), signed(3, 'Same text', 'fourth-signature')];
  const result = await streamedTurns([turn([first], 0), turn([second], 1)]);
  assert.deepEqual(assistants(result.requests[2]).map(message => message.reasoning_details), [first, second]);
  assertFourTools(result.requests[2], 1);
});

test('non-streaming SDK keeps equal-text signed blocks in the next tool continuation', async () => {
  const details = [signed(0, 'Same text', 'first-signature'), signed(1, 'Same text', 'second-signature')], requests = [];
  const model = createOpenRouterTemplateModel({ apiKey: 'dummy', model: 'test/model', fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const first = requests.length === 1;
    return new Response(JSON.stringify({ id: 'gen-free-fixture', model: 'test/model', choices: [{ index: 0,
      message: first ? { role: 'assistant', content: null, reasoning_details: details, tool_calls: calls(0) } : { role: 'assistant', content: 'Complete.' },
      finish_reason: first ? 'tool_calls' : 'stop',
    }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await new ToolLoopAgent({ model, tools, stopWhen: stepCountIs(2) }).generate({ prompt: 'Inspect four files.' });
  assert.deepEqual(assistants(requests[1])[0].reasoning_details, details);
  assertFourTools(requests[1]);
});

test('existing SDK filters still omit unsigned signature-required formats and malformed details', async () => {
  const valid = signed(3), plain = { type: 'reasoning.text', index: 4, format: 'unknown', text: 'Ordinary unsigned text' };
  const details = [
    { type: 'reasoning.text', index: 0, format: 'anthropic-claude-v1', text: 'Unsigned Claude' },
    { type: 'reasoning.text', index: 1, format: 'google-gemini-v1', text: 'Unsigned Gemini' },
    { type: 'reasoning.text', index: 2, text: 'Unsigned default format' },
    valid, plain,
    { type: 'reasoning.text', index: 5, text: 'Malformed signature', signature: 123 },
    { type: 'reasoning.encrypted', index: 6, data: 123 },
    { type: 'unrecognized', data: 'unrecognized shape' },
  ];
  const result = await streamedTurns([turn([details])]);
  assert.deepEqual(assistants(result.requests[1])[0].reasoning_details, [valid, plain]);
});

test('raw SSE values remain untouched and diagnostics never include private reasoning or signatures', async () => {
  const details = [signed(0), signed(1)], events = turn(details.map(detail => [detail])), original = structuredClone(events);
  const result = await streamedTurns([events], { includeRawChunks: true });
  assert.deepEqual(result.raw, [...original, ...finalEvents]);
  assert.deepEqual(events, original);
  assert.ok(result.progress.some(value => value.type === 'request-finished'));
  assert.doesNotMatch(JSON.stringify(result.progress), /Private reasoning|private-signature|sk-or-free-fixture/);
});

const callOptions = (label, details = []) => ({
  prompt: [
    ...(details.length ? [{ role: 'assistant', content: [{ type: 'reasoning', text: details.map(detail => detail.text).join(''), providerOptions: { openrouter: { reasoning_details: details } } }] }] : []),
    { role: 'user', content: [{ type: 'text', text: label }] },
  ],
  tools: [],
});
async function consume(stream) {
  const parts = [];
  for await (const part of stream) { if (part.type === 'error') throw part.error; parts.push(part); }
  return parts;
}

test('concurrent calls isolate outgoing history and streamed metadata', async () => {
  const histories = { A: [signed(0, 'Same history', 'A-old-0'), signed(1, 'Same history', 'A-old-1')], B: [signed(0, 'Same history', 'B-old-0'), signed(1, 'Same history', 'B-old-1')] };
  const fresh = { A: [signed(2, 'Same fresh text', 'A-new-0'), signed(3, 'Same fresh text', 'A-new-1')], B: [signed(2, 'Same fresh text', 'B-new-0'), signed(3, 'Same fresh text', 'B-new-1')] };
  const requests = new Map();
  let release;
  const both = new Promise(resolve => { release = resolve; });
  const model = createOpenRouterTemplateModel({ apiKey: 'dummy', model: 'test/model', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body), label = body.messages.at(-1).content;
    requests.set(label, body);
    if (requests.size === 2) release();
    await both;
    return sse([event({ reasoning_details: fresh[label] }), event({ content: 'Complete.' }, 'stop')]);
  } });
  const results = await Promise.all(['A', 'B'].map(async label => {
    const response = await model.doStream(callOptions(label, histories[label]));
    return [label, await consume(response.stream)];
  }));
  for (const [label, parts] of results) {
    assert.deepEqual(assistants(requests.get(label))[0].reasoning_details, histories[label]);
    assert.deepEqual(parts.find(part => part.type === 'finish').providerMetadata.openrouter.reasoning_details, fresh[label]);
    assert.equal(parts.some(part => part.type === 'raw'), false, 'internal raw observation stays internal by default');
  }
});

test('cancelling the wrapped SDK stream cancels its underlying response', { timeout: 3000 }, async () => {
  let cancelled;
  const cancellation = new Promise(resolve => { cancelled = resolve; });
  const model = createOpenRouterTemplateModel({ apiKey: 'dummy', model: 'test/model', fetchImpl: async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel(reason) { cancelled(reason); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }) });
  const response = await model.doStream(callOptions('Cancel me'));
  const reader = response.stream.getReader();
  assert.equal((await reader.read()).value.type, 'stream-start');
  await reader.cancel('fixture cancellation');
  assert.equal(await cancellation, 'fixture cancellation');
});
