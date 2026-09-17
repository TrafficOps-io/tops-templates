import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { createOpenRouterTemplateModel, generateTemplateWithOpenRouterAgent } from '../src/openrouter-template-agent.js';
import { starterProject } from '../src/starter.js';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function toolCall(toolName, input, toolCallId) {
  return {
    content: [{ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    usage,
    warnings: [],
  };
}

function finalOutput(text) {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  };
}

function successfulResponses({ mutateAfterValidation = false } = {}) {
  const responses = Object.entries(starterProject(true)).map(([path, content], index) => toolCall('set_file', { path, content }, `set-${index}`));
  responses.push(toolCall('validate_draft', {}, 'validate'));
  if (mutateAfterValidation) responses.push(toolCall('set_file', { path: 'notes.md', content: 'Changed after validation.' }, 'late-change'));
  responses.push(finalOutput('A valid landing page draft is ready.'));
  return responses;
}

test('ToolLoopAgent builds only an in-memory draft and validates it with the Studio runtime', async () => {
  const progress = [];
  const model = new MockLanguageModelV4({ doGenerate: successfulResponses() });
  const result = await generateTemplateWithOpenRouterAgent({
    languageModel: model,
    prompt: 'Create a warm editorial landing page.',
    onProgress: event => progress.push(event),
  });

  assert.deepEqual(Object.keys(result.files).sort(), Object.keys(starterProject(true)).sort());
  assert.match(result.files['index.tpl'], /@template/);
  assert.equal(result.summary, 'A valid landing page draft is ready.');
  assert.equal(result.steps, model.doGenerateCalls.length);
  assert.ok(progress.some(event => event.type === 'validation' && event.valid));
  assert.ok(model.doGenerateCalls.every(call => call.tools?.some(entry => entry.name === 'validate_draft')));
});

test('agent rejects a draft changed after its last successful validation', async () => {
  const model = new MockLanguageModelV4({ doGenerate: successfulResponses({ mutateAfterValidation: true }) });
  await assert.rejects(
    () => generateTemplateWithOpenRouterAgent({ languageModel: model, prompt: 'Create a landing page.' }),
    /changed the draft after its last successful validation/,
  );
});

test('OpenRouter agent adapter sends tools and BYOK without imposing structured output', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: 'generation-test',
      model: 'test/model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const model = createOpenRouterTemplateModel({ apiKey: 'sk-or-test-secret', model: 'test/model', fetchImpl });
  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 100,
    temperature: 0.3,
    tools: [{ type: 'function', name: 'validate_draft', inputSchema: { type: 'object', properties: {} } }],
    toolChoice: { type: 'auto' },
  });

  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.match(String(request.options.headers.Authorization || request.options.headers.authorization), /sk-or-test-secret/);
  assert.equal('parallel_tool_calls' in request.body, false);
  assert.equal('response_format' in request.body, false);
  assert.equal(request.body.tools[0].function.name, 'validate_draft');
  assert.deepEqual(request.body.provider, { require_parameters: true, data_collection: 'deny' });
});

test('agent-facing OpenRouter errors never expose the BYOK secret', async () => {
  const apiKey = 'sk-or-agent-test-secret';
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({
    apiKey,
    model: 'test/model',
    prompt: 'Create a landing page.',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `Rejected ${apiKey}` } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  }), error => error.message.includes('[redacted]') && !error.message.includes(apiKey) && !('cause' in error));
});

test('editing reads and patches the existing project, retains binary assets and current field values', async () => {
  const files = { ...starterProject(true), 'images/photo.png': new Uint8Array([1, 2, 3]), 'notes.md': 'Keep me.' };
  const progress = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('read_file', { path: 'index.tpl' }, 'read'),
    toolCall('patch_file', { path: 'index.tpl', search: '</body>', replace: '<section id="faq"><h2>Frequently asked questions</h2></section>\n    </body>' }, 'patch'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Added a FAQ.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ languageModel: model, mode: 'edit', files, values: { title: 'User content' }, prompt: 'Add a FAQ', onProgress: event => progress.push(event) });
  assert.match(result.files['index.tpl'], /Frequently asked questions/);
  assert.deepEqual(result.files['images/photo.png'], files['images/photo.png']);
  assert.equal(result.files['notes.md'], 'Keep me.');
  assert.equal(result.values.title, 'User content');
  assert.equal(files['index.tpl'].includes('Frequently asked questions'), false);
  assert.ok(progress.some(event => event.files?.['index.tpl']?.includes('Frequently asked questions')));
});

test('batch changes reject unsafe paths atomically', async () => {
  const files = starterProject(true);
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('set_files', { files: [{ path: 'notes.md', content: 'should not be added' }, { path: '../escape.txt', content: 'unsafe' }] }, 'invalid-batch'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Done.'),
  ] });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ languageModel: model, mode: 'edit', files, prompt: 'Edit' }), /no changes/);
});

test('identical patch and writes cannot be reported as successful changes', async () => {
  const files = starterProject(true), progress = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('patch_file', { path: 'index.tpl', search: '</body>', replace: '</body>' }, 'same-patch'),
    toolCall('set_file', { path: 'index.tpl', content: files['index.tpl'] }, 'same-file'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Added a FAQ.'),
  ] });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ languageModel: model, mode: 'edit', files, prompt: 'Add a FAQ', onProgress: event => progress.push(event) }), /no changes/);
  assert.equal(progress.some(event => event.type === 'file-set'), false);
});

test('the final draft must still differ from the original after reverting changes', async () => {
  const files = starterProject(true);
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('set_file', { path: 'notes.md', content: 'Temporary change' }, 'add'),
    toolCall('remove_file', { path: 'notes.md' }, 'revert'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Updated the project.'),
  ] });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ languageModel: model, mode: 'edit', files, prompt: 'Add a note' }), /no changes/);
});

test('streaming reports model activity and live files before completion', async () => {
  const { simulateReadableStream } = await import('ai');
  const responses = [toolCall('set_files', { files: Object.entries(starterProject(true)).map(([path, content]) => ({ path, content })) }, 'batch'), toolCall('validate_draft', {}, 'validate'), finalOutput('Ready.')];
  let index = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    const response = responses[index++];
    const content = response.content.flatMap(part => part.type === 'tool-call' ? [part] : [{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: part.text }, { type: 'text-end', id: 'text' }]);
    return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...content, { type: 'finish', finishReason: response.finishReason, usage }] }) };
  } });
  const events = [];
  const result = await generateTemplateWithOpenRouterAgent({ languageModel: model, prompt: 'Create a page', stream: true, onProgress: event => events.push(event) });
  assert.equal(result.steps, 3);
  assert.ok(events.some(event => event.type === 'step'));
  assert.ok(events.some(event => event.files?.['index.tpl']));
});

test('cancelling a pending provider request rejects cleanly without applying a working copy', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const model = new MockLanguageModelV4({ doStream: async ({ abortSignal }) => {
    started();
    return new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true }));
  } });
  const pending = generateTemplateWithOpenRouterAgent({ languageModel: model, prompt: 'Create a page', stream: true, signal: controller.signal });
  const rejected = assert.rejects(pending, /cancelled or timed out/);
  await ready;
  controller.abort();
  await rejected;
  await new Promise(resolve => setTimeout(resolve, 10));
});

test('OpenRouter transport cancellation is handled while waiting for response headers', async () => {
  const controller = new AbortController();
  let start;
  const ready = new Promise(resolve => { start = resolve; });
  const pending = generateTemplateWithOpenRouterAgent({ apiKey: 'fake', model: 'test/model', prompt: 'Create a page', stream: true, signal: controller.signal, fetchImpl: async (_url, { signal }) => {
    start();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const rejected = assert.rejects(pending, /cancelled or timed out/);
  await ready; controller.abort(); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10));
});
