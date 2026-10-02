import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenRouterTemplateModel } from '@trafficops/template-editor-shell/openrouter-template-agent';

const modelCases = [
  ['google/gemini-3.8-flash', { effort: 'low' }],
  ['  google/gemini-3.8-flash  ', { effort: 'low' }],
  ['xiaomi/mimo-v2.6-flash', { enabled: false }],
  ['  xiaomi/mimo-v2.6-flash  ', { enabled: false }],
  ['~xiaomi/mimo-flash-latest'],
  ['xiaomi/mimo-v2.6-flash-20260921'],
  ['xiaomi/mimo-v2.6-flash:batch'],
  ['xiaomi/mimo-v2.6-pro'],
  ['qwen/qwen3.8-flash'],
  ['~google/gemini-flash-latest'],
  ['google/gemini-3.8-flash-20260902'],
  ['google/gemini-3.8-flash:batch'],
  ['google/gemini-3.7-flash'],
  ['google/gemini-3.1-pro-preview'],
  ['google/gemini-3.1-flash-lite-image'],
  ['anthropic/claude-sonnet-4.6'],
  ['openrouter/auto'],
];

// Equal text with distinct signatures exercises the central factory's history
// wrapper as well as the real SDK's request serializer.
const reasoningDetails = ['first', 'second'].map((label, index) => ({
  type: 'reasoning.text', id: `fixture-${label}`, index,
  format: 'google-gemini-v1', text: 'Fixture reasoning.', signature: `fixture-signature-${label}`,
}));

for (const stream of [false, true]) {
  for (const [selectedModel, reasoning] of modelCases) {
    test(`${stream ? 'streaming' : 'completion'} reasoning preference is model-bound for ${JSON.stringify(selectedModel)}`, async () => {
      const requests = [];
      const model = createOpenRouterTemplateModel({
        apiKey: 'dummy-free-fixture', model: selectedModel,
        fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          requests.push({ url, body });
          const choice = stream
            ? { index: 0, delta: { role: 'assistant', content: 'Complete.' }, finish_reason: 'stop' }
            : { index: 0, message: { role: 'assistant', content: 'Complete.' }, finish_reason: 'stop' };
          const payload = { id: 'gen-free-effort-fixture', model: body.model, choices: [choice] };
          return new Response(stream
            ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`
            : JSON.stringify(payload), {
            headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' },
          });
        },
      });
      assert.equal(requests.length, 0, 'constructing the model must not fetch capabilities or contact a provider');

      const options = {
        prompt: [
          { role: 'assistant', content: [{
            type: 'reasoning', text: 'Fixture reasoning.Fixture reasoning.',
            providerOptions: { openrouter: { reasoning_details: reasoningDetails } },
          }] },
          { role: 'user', content: [{ type: 'text', text: 'Continue the fixture.' }] },
        ],
        maxOutputTokens: 100,
        tools: [{ type: 'function', name: 'validate_draft', inputSchema: { type: 'object', properties: {} } }],
        toolChoice: { type: 'auto' },
      };
      if (stream) {
        const result = await model.doStream(options);
        for await (const part of result.stream) if (part.type === 'error') throw part.error;
      } else await model.doGenerate(options);

      assert.equal(requests.length, 1, 'one model call must make exactly one provider request');
      const { url, body } = requests[0];
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(body.model, selectedModel.trim());
      if (reasoning) assert.deepEqual(body.reasoning, reasoning);
      else assert.equal(Object.hasOwn(body, 'reasoning'), false, 'other models must keep their existing provider reasoning defaults');
      assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
      assert.deepEqual(body.provider, { require_parameters: true, allow_fallbacks: true, data_collection: 'deny' });
      assert.deepEqual(body.messages.find(message => message.role === 'assistant').reasoning_details, reasoningDetails);
      assert.equal(body.tools[0].function.name, 'validate_draft');
      assert.equal(body.tool_choice, 'auto');
    });
  }
}
