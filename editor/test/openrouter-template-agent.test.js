import { validateDraft } from './support/ai-validator.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { createOpenRouterTemplateModel, generateTemplateWithOpenRouterAgent } from '@trafficops/template-editor-shell/openrouter-template-agent';
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
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft,
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

test('host validates the final snapshot even when the agent forgets to validate a late edit', async () => {
  const model = new MockLanguageModelV4({ doGenerate: successfulResponses({ mutateAfterValidation: true }) });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a landing page.' });
  assert.equal(result.valid, true);
  assert.equal(result.files['notes.md'], 'Changed after validation.');
});

for (const stream of [false, true]) test(`OpenRouter ${stream ? 'streaming' : 'completion'} adapter requires tools and privacy without optional parallel-call filtering`, async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    if (stream) return new Response(`data: ${JSON.stringify({
      id: 'generation-test', model: 'test/model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }],
    })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    return new Response(JSON.stringify({
      id: 'generation-test',
      model: 'test/model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const model = createOpenRouterTemplateModel({ apiKey: 'sk-or-test-secret', model: 'test/model', fetchImpl });
  const options = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 100,
    temperature: 0.3,
    tools: [{ type: 'function', name: 'validate_draft', inputSchema: { type: 'object', properties: {} } }],
    toolChoice: { type: 'auto' },
  };
  if (stream) {
    const result = await model.doStream(options);
    for await (const chunk of result.stream) if (chunk.type === 'error') throw chunk.error;
  } else await model.doGenerate(options);

  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.match(String(request.options.headers.Authorization || request.options.headers.authorization), /sk-or-test-secret/);
  assert.equal('parallel_tool_calls' in request.body, false, 'an optional hint must not exclude models that support tools');
  assert.equal('response_format' in request.body, false);
  assert.equal(request.body.tools[0].function.name, 'validate_draft');
  assert.equal(request.body.tool_choice, 'auto');
  assert.deepEqual(request.body.provider, { require_parameters: true, data_collection: 'deny' });
});

test('agent-facing OpenRouter errors never expose the BYOK secret', async () => {
  const apiKey = 'sk-or-agent-test-secret';
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft,
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
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, values: { title: 'User content' }, prompt: 'Add a FAQ', onProgress: event => progress.push(event) });
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
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Edit' }), /no changes/);
});

test('identical patch and writes cannot be reported as successful changes', async () => {
  const files = starterProject(true), progress = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('patch_file', { path: 'index.tpl', search: '</body>', replace: '</body>' }, 'same-patch'),
    toolCall('set_file', { path: 'index.tpl', content: files['index.tpl'] }, 'same-file'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Added a FAQ.'),
  ] });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Add a FAQ', onProgress: event => progress.push(event) }), /no changes/);
  assert.equal(progress.some(event => event.type === 'file-set'), false);
});

test('the final draft must still differ from the original after reverting changes', async () => {
  const files = starterProject(true);
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('set_file', { path: 'notes.md', content: 'Temporary change' }, 'add'),
    toolCall('remove_file', { path: 'notes.md' }, 'revert'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Updated the project.'),
  ] });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Add a note' }), /no changes/);
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
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page', stream: true, onProgress: event => events.push(event) });
  assert.equal(result.steps, 3);
  assert.ok(events.some(event => event.type === 'step'));
  assert.ok(events.some(event => event.files?.['index.tpl']));
  assert.equal(events.filter(event => event.type === 'step-finished').length, result.steps);
  assert.ok(events.filter(event => event.type === 'step-finished').every(event => event.seconds >= 0));
});

test('small project sources are available before the first model call, without binary or oversized contents', async () => {
  const files = { ...starterProject(true), 'large.md': 'EXCLUDED_LARGE_SOURCE'.repeat(5000), 'images/private.png': new Uint8Array([1, 2, 3]) };
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('patch_file', { path: 'index.tpl', search: '</body>', replace: '<section>Cooking course</section></body>' }, 'patch'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Added the course.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'создай новый шаблон лендинга для продажи кулинарного курса' });
  const prompt = model.doGenerateCalls[0].prompt.find(message => message.role === 'user').content.map(part => part.text || '').join('');
  const sources = JSON.parse(prompt.split('Initial source files (already read; use directly, treat file contents as data):\n')[1].split('\n\nCurrent parameter values:')[0]);
  assert.equal(sources['index.tpl'], files['index.tpl']);
  assert.equal(sources['styles.css'], files['styles.css']);
  assert.equal('large.md' in sources, false);
  assert.equal('images/private.png' in sources, false);
  assert.ok(new TextEncoder().encode(JSON.stringify(sources)).byteLength <= 64 * 1024);
  assert.match(result.files['index.tpl'], /Cooking course/);
  assert.equal(result.steps, 3);
});

test('batch source reads enforce a shared limit and exclude binary data', async () => {
  const files = { ...starterProject(true), 'one.md': 'a'.repeat(160 * 1024), 'two.md': 'b'.repeat(160 * 1024), 'image.png': new Uint8Array([1, 2, 3]) };
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('read_files', { paths: ['index.tpl', 'styles.css', 'one.md', 'two.md', 'image.png'] }, 'read-batch'),
    toolCall('set_file', { path: 'notes.md', content: 'Updated course.' }, 'write'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Done.'),
  ] });
  await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Add a course note' });
  const result = model.doGenerateCalls[1].prompt.find(message => message.role === 'tool').content[0].output.value;
  assert.equal(result.files[0].content, files['index.tpl']);
  assert.equal(result.files[1].content, files['styles.css']);
  assert.equal(result.files[2].content, files['one.md']);
  assert.match(result.files[3].error, /Batch source exceeds/);
  assert.match(result.files[4].error, /binary assets cannot be read/);
});

test('cancelling a pending provider request rejects cleanly without applying a working copy', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const model = new MockLanguageModelV4({ doStream: async ({ abortSignal }) => {
    started();
    return new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true }));
  } });
  const pending = generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page', stream: true, signal: controller.signal });
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
  const pending = generateTemplateWithOpenRouterAgent({ validateDraft, apiKey: 'fake', model: 'test/model', prompt: 'Create a page', stream: true, signal: controller.signal, fetchImpl: async (_url, { signal }) => {
    start();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const rejected = assert.rejects(pending, /cancelled or timed out/);
  await ready; controller.abort(); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10));
});

for (const transport of ['http', 'sse']) {
  test(`streaming preserves the original ${transport} provider error and redacts the key`, async () => {
    const apiKey = 'sk-or-stream-test-secret';
    const payload = { error: { message: `Provider unavailable for ${apiKey}`, code: 503 } };
    await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft,
      apiKey, model: 'test/model', prompt: 'Create a page', stream: true,
      fetchImpl: async () => transport === 'http'
        ? new Response(JSON.stringify(payload), { status: 503, headers: { 'Content-Type': 'application/json' } })
        : new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }),
    }), error => error.message.includes('Provider unavailable') && error.message.includes('[redacted]') && !error.message.includes(apiKey));
  });
}

// These tests hold the provider mid-response, rather than checking only a finished draft.
test('partial file input is visible before execution and never changes the committed draft', { timeout: 3000 }, async () => {
  const files = { ...starterProject(true), 'notes.md': 'Original' }, events = [];
  let resume, previewSeen;
  const paused = new Promise(resolve => { resume = resolve; });
  const preview = new Promise(resolve => { previewSeen = resolve; });
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'stream-start', warnings: [] });
    if (calls++ === 0) {
      controller.enqueue({ type: 'tool-input-start', id: 'write', toolName: 'set_file' });
      controller.enqueue({ type: 'tool-input-delta', id: 'write', delta: '{"path":"notes.md","content":"Live \\u041f\\u0440' });
      paused.then(() => {
        controller.enqueue({ type: 'tool-input-end', id: 'write' });
        controller.enqueue(toolCall('set_file', { path: 'notes.md', content: 'Live Привет' }, 'write').content[0]);
        controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage });
        controller.close();
      });
      return;
    } else if (calls === 2) {
      controller.enqueue(toolCall('validate_draft', {}, 'validate').content[0]);
      controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage });
    } else {
      controller.enqueue({ type: 'text-start', id: 'text' }); controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Ready.' }); controller.enqueue({ type: 'text-end', id: 'text' });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
    }
    controller.close();
  } }) }) });
  const pending = generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Update notes', stream: true, onProgress(event) { events.push(event); if (event.type === 'file-stream') previewSeen(event); } });
  try {
    const event = await Promise.race([preview, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('No partial preview received')), 1500); timer.unref(); })]);
    assert.equal(event.files['notes.md'], 'Live Пр');
    assert.equal(event.partial, true);
    assert.equal(events.some(event => event.type === 'file-set'), false);
    assert.equal(files['notes.md'], 'Original');
  } finally { resume(); }
  const result = await pending;
  assert.equal(result.files['notes.md'], 'Live Привет');
  assert.equal(events.at(-2).type, 'draft-sync');
});

test('edit_file and delete_file apply focused changes and preserve assets', async () => {
  const files = { ...starterProject(true), 'notes.md': 'old note', 'photo.png': new Uint8Array([1, 2]) };
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('edit_file', { path: 'notes.md', search: 'old', replace: 'new' }, 'edit'),
    toolCall('delete_file', { path: 'photo.png' }, 'binary'),
    toolCall('delete_file', { path: 'styles.css' }, 'delete'),
    toolCall('validate_draft', {}, 'validate'), finalOutput('Edited note and deleted CSS.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Edit note and delete CSS' });
  assert.equal(result.files['notes.md'], 'new note');
  assert.equal('styles.css' in result.files, false);
  assert.deepEqual(result.files['photo.png'], files['photo.png']);
  assert.equal(files['notes.md'], 'old note');
});

for (const arrival of ['tool', 'final', 'validation']) {
  test(`clarification during ${arrival} is delivered once and must be validated again`, async () => {
    const queue = [], events = []; let injected = false, checks = 0;
    const responses = [toolCall('set_file', { path: 'notes.md', content: 'First version' }, 'first')];
    if (arrival !== 'tool') responses.push(toolCall('validate_draft', {}, 'validate-first'), finalOutput('First version ready.'));
    responses.push(toolCall('edit_file', { path: 'notes.md', search: 'First', replace: 'Corrected' }, 'correct'), toolCall('validate_draft', {}, 'validate-corrected'), finalOutput('Corrected version ready.'));
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      const response = responses.shift();
      if (!injected && (arrival === 'tool' || (arrival === 'final' && response.content[0].type === 'text'))) { queue.push('Use the corrected version.'); injected = true; }
      return response;
    } });
    const result = await generateTemplateWithOpenRouterAgent({ validateDraft: async args => {
      const result = await validateDraft(args);
      if (arrival === 'validation' && ++checks === 2) { queue.push('Use the corrected version.'); injected = true; }
      return result;
    }, languageModel: model, mode: 'edit', files: starterProject(true), prompt: 'Add notes', takeInstructions: () => queue.splice(0), onProgress: event => events.push(event) });
    assert.equal(result.files['notes.md'], 'Corrected version');
    assert.equal(events.filter(event => event.type === 'instructions-received').length, 1);
    const lastPrompt = model.doGenerateCalls.at(-1).prompt;
    assert.equal(lastPrompt.filter(message => message.role === 'user' && JSON.stringify(message.content).includes('Use the corrected version.')).length, 1);
  });
}

test('a clarification at the step limit cannot be silently reported as completed', async () => {
  const queue = []; let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    step++;
    if (step === 16) queue.push('Make the note blue.');
    return step === 1 ? toolCall('set_file', { path: 'notes.md', content: 'Note' }, 'write') : toolCall('validate_draft', {}, `validate-${step}`);
  } });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files: starterProject(true), prompt: 'Add notes', takeInstructions: () => queue.splice(0) }), /step limit/);
  assert.equal(step, 16);
});

const brokenTemplate = '@section main "Main"\n@param title String = "Draft" label="Title" label="Duplicate"\n@endsection\n@layout\n<h1>{{ title }}</h1>\n@endlayout';

test('independent file tools complete in one model step without losing either update', async () => {
  const first = toolCall('set_file', { path: 'index.tpl', content: '@layout\n<h1>Batch</h1>\n@endlayout' }, 'tpl');
  first.content.push(...toolCall('set_file', { path: 'styles.css', content: 'body { color: blue; }' }, 'css').content);
  const model = new MockLanguageModelV4({ doGenerate: [first, finalOutput('Done.')] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page' });
  assert.equal(result.steps, 2);
  assert.match(result.files['index.tpl'], /Batch/);
  assert.match(result.files['styles.css'], /blue/);
  assert.equal(model.doGenerateCalls[1].prompt.find(message => message.role === 'tool').content.length, 2);
});

test('host errors after a premature final answer are fed back for focused repair', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('set_files', { files: [{ path: 'index.tpl', content: brokenTemplate }, { path: 'notes.md', content: 'Keep completed work' }] }, 'write'),
    finalOutput('Done.'),
    toolCall('edit_file', { path: 'index.tpl', search: ' label="Duplicate"', replace: '' }, 'repair'),
    finalOutput('Fixed.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page' });
  assert.equal(result.valid, true);
  assert.equal(result.files['notes.md'], 'Keep completed work');
  assert.ok(model.doGenerateCalls[2].prompt.some(message => message.role === 'user' && JSON.stringify(message.content).includes('Duplicate option')));
});

test('step exhaustion returns an explicitly invalid recoverable draft, preserving assets and values', async () => {
  const original = { ...starterProject(true), 'photo.png': new Uint8Array([1, 2]) }, values = { title: 'Existing title' };
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => ++calls === 1
    ? toolCall('set_file', { path: 'index.tpl', content: brokenTemplate }, 'write') : finalOutput('Done.') });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files: original, values, prompt: 'Edit the page' });
  assert.equal(calls, 16);
  assert.equal(result.valid, false);
  assert.match(result.error, /Duplicate option/);
  assert.equal(result.files['index.tpl'], brokenTemplate);
  assert.deepEqual(result.files['photo.png'], original['photo.png']);
  assert.deepEqual(result.values, values);
  assert.notEqual(original['index.tpl'], brokenTemplate);
});

test('the final three steps are available to repair errors even if the model keeps calling tools', async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    calls++;
    if (calls === 1) return toolCall('set_file', { path: 'index.tpl', content: brokenTemplate }, 'broken');
    if (calls < 14) return toolCall('set_file', { path: 'notes.md', content: `Note ${calls}` }, `note-${calls}`);
    if (calls === 14) return toolCall('edit_file', { path: 'index.tpl', search: ' label="Duplicate"', replace: '' }, 'repair');
    return finalOutput('Fixed.');
  } });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page' });
  assert.equal(result.valid, true);
  assert.equal(result.steps, 15);
  assert.ok(model.doGenerateCalls[13].prompt.some(message => message.role === 'user' && JSON.stringify(message.content).includes('3 model steps remaining')));
});

test('validation overlapping writes cannot report a stale snapshot as valid', async () => {
  const first = toolCall('validate_draft', {}, 'validate');
  first.content.push(...toolCall('set_file', { path: 'index.tpl', content: brokenTemplate }, 'write').content);
  const model = new MockLanguageModelV4({ doGenerate: [first,
    toolCall('edit_file', { path: 'index.tpl', search: ' label="Duplicate"', replace: '' }, 'repair'), finalOutput('Fixed.')] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files: starterProject(true), prompt: 'Edit' });
  assert.equal(result.valid, true);
  const validation = model.doGenerateCalls[1].prompt.find(message => message.role === 'tool').content.find(part => part.toolCallId === 'validate').output.value;
  assert.equal(validation.valid, false);
  assert.match(validation.error, /changed during validation/);
});

function timeoutStream(input) {
  return { stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'stream-start', warnings: [] });
    if (input !== undefined) {
      controller.enqueue({ type: 'tool-input-start', id: 'interrupted-batch', toolName: 'set_files' });
      controller.enqueue({ type: 'tool-input-delta', id: 'interrupted-batch', delta: input });
    }
    controller.enqueue({ type: 'error', error: { code: 504, message: 'Upstream idle timeout exceeded' } });
    controller.enqueue({ type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage });
    controller.close();
  } }) };
}
function responseStream(response) {
  return { stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'stream-start', warnings: [] });
    for (const part of response.content) {
      if (part.type === 'tool-call') controller.enqueue(part);
      else {
        controller.enqueue({ type: 'text-start', id: 'summary' });
        controller.enqueue({ type: 'text-delta', id: 'summary', delta: part.text });
        controller.enqueue({ type: 'text-end', id: 'summary' });
      }
    }
    controller.enqueue({ type: 'finish', finishReason: response.finishReason, usage });
    controller.close();
  } }) };
}

test('an upstream idle timeout recovers complete batch entries and continues once with independent writes', async () => {
  const completed = { path: 'index.tpl', content: '@layout\n<h1>Retained page</h1>\n@endlayout' };
  const partial = '{"files":[' + JSON.stringify(completed) + ',{"path":"styles.css","content":"body { col';
  const queue = [], events = []; let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    calls++;
    if (calls === 1) { queue.push('Use blue text.'); return timeoutStream(partial); }
    if (calls === 2) return responseStream(toolCall('set_file', { path: 'styles.css', content: 'body { color: blue; }' }, 'css'));
    return responseStream(finalOutput('Recovered.'));
  } });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page', stream: true, takeInstructions: () => queue.splice(0), onProgress: event => events.push(event) });
  assert.equal(result.valid, true);
  assert.equal(result.steps, 3, 'the failed provider call still counts toward the run budget');
  assert.equal(result.files['index.tpl'], completed.content);
  assert.equal(result.files['styles.css'], 'body { color: blue; }');
  const recovered = events.find(event => event.type === 'file-set');
  assert.deepEqual(Object.keys(recovered.files), ['index.tpl']);
  assert.equal(events.filter(event => event.type === 'timeout-recovery').length, 1);
  assert.ok(model.doStreamCalls[1].tools.every(tool => tool.name !== 'set_files'));
  assert.ok(model.doStreamCalls[1].prompt.some(message => message.role === 'user' && JSON.stringify(message.content).includes('Use blue text.')));
});

test('a timeout before any completed file retries once, then exits cleanly without a retry loop', async () => {
  let calls = 0;
  const events = [];
  const model = new MockLanguageModelV4({ doStream: async () => { calls++; return timeoutStream('{"files":[{"path":"index.tpl","content":"truncated'); } });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, prompt: 'Create a page', stream: true, onProgress: event => events.push(event) }), /provider stopped sending data/);
  assert.equal(calls, 2);
  assert.equal(events.filter(event => event.type === 'timeout-recovery').length, 1);
  assert.equal(events.some(event => event.type === 'file-set'), false, 'truncated strings must never be written');
});

test('recovering complete batch input still enforces path, binary and size restrictions', async () => {
  for (const entry of [{path: '../escape.tpl', content: 'unsafe'}, {path: 'photo.png', content: 'overwrite'}, {path: 'big.css', content: 'x'.repeat(256 * 1024 + 1)}]) {
    const files = {...starterProject(true), 'photo.png': new Uint8Array([1, 2])}, events = [];
    const partial = '{"files":[' + JSON.stringify(entry) + ',{"path":"more.css","content":"partial';
    const model = new MockLanguageModelV4({ doStream: async () => timeoutStream(partial) });
    await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Edit', stream: true, onProgress: event => events.push(event) }), /provider stopped sending data/);
    assert.equal(events.some(event => event.type === 'file-set'), false);
    assert.deepEqual(events.filter(event => event.type === 'draft-sync').at(-1).files, files);
  }
});

test('a timeout on the final allowed call cannot add a seventeenth paid request', async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (++calls === 16) throw new Error('Upstream idle timeout exceeded');
    return toolCall('set_file', { path: 'notes.md', content: `Note ${calls}` }, `write-${calls}`);
  } });
  await assert.rejects(() => generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files: starterProject(true), prompt: 'Add notes' }), /provider stopped sending data/);
  assert.equal(calls, 16);
});

test('the real OpenRouter adapter recovers a first partial chunk that never reaches tool-input callbacks', async () => {
  const file = {path: 'notes.md', content: 'Complete before timeout'}, events = [], requests = [];
  const partial = '{"files":[' + JSON.stringify(file) + ',{"path":"lost.css","content":"unfinished';
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, apiKey: 'test-key', model: 'test/model', mode: 'edit', files: starterProject(true), prompt: 'Add notes', stream: true,
    onProgress: event => events.push(event), fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const chunks = requests.length === 1 ? [
        {choices: [{index: 0, delta: {role: 'assistant', tool_calls: [{index: 0, id: 'first', type: 'function', function: {name: 'set_files', arguments: partial}}]}}]},
        {error: {code: 504, message: 'Upstream idle timeout exceeded'}, choices: [{index: 0, delta: {}, finish_reason: 'error'}]},
      ] : [{choices: [{index: 0, delta: {role: 'assistant', content: 'Notes ready.'}, finish_reason: 'stop'}]}];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream'}});
    } });
  assert.equal(requests.length, 2);
  assert.equal(result.files['notes.md'], file.content);
  assert.equal('lost.css' in result.files, false);
  assert.equal(events.some(event => event.type === 'file-set' && event.paths.includes('notes.md')), true);
});

test('editing rejects wholesale replacement of a large input file and recovers through a focused edit', async () => {
  const files = { ...starterProject(true), 'notes.md': `Keep these notes.\n${'Unrelated user content.\n'.repeat(150)}` }, events = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('set_files', { files: [{ path: 'notes.md', content: 'Destroyed notes' }, { path: 'lost.md', content: 'Should not be created' }] }, 'rewrite'),
    toolCall('edit_file', { path: 'notes.md', search: 'Keep these notes.', replace: 'Keep these updated notes.' }, 'focused'), finalOutput('Updated the introduction.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files, prompt: 'Update the introduction', onProgress: event => events.push(event) });
  const rejection = model.doGenerateCalls[1].prompt.find(message => message.role === 'tool').content[0].output.value;
  assert.equal(rejection.ok, false);
  assert.match(rejection.error, /edit_file/);
  assert.equal(result.files['notes.md'], files['notes.md'].replace('Keep these notes.', 'Keep these updated notes.'));
  assert.equal('lost.md' in result.files, false, 'a rejected batch must be atomic');
  assert.equal(events.filter(event => event.type === 'file-set').length, 1);
});

test('large batch output is rejected with a compact-write instruction and can continue in small files', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('set_files', { files: [{ path: 'one.md', content: 'a'.repeat(7000) }, { path: 'two.md', content: 'b'.repeat(7000) }] }, 'too-large'),
    toolCall('set_file', { path: 'notes.md', content: 'Compact change' }, 'small'), finalOutput('Done.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files: starterProject(true), prompt: 'Add notes' });
  const rejection = model.doGenerateCalls[1].prompt.find(message => message.role === 'tool').content[0].output.value;
  assert.equal(rejection.ok, false);
  assert.match(rejection.error, /12,000 characters/);
  assert.equal('one.md' in result.files || 'two.md' in result.files, false);
  assert.equal(result.files['notes.md'], 'Compact change');
});

test('focused edits cannot disguise a large whole-file replacement', async () => {
  const content = 'Unrelated source\n'.repeat(200);
  const model = new MockLanguageModelV4({ doGenerate: [
    toolCall('edit_file', { path: 'notes.md', search: content, replace: 'Whole file lost' }, 'whole'),
    toolCall('set_file', { path: 'small.css', content: 'body { color: blue; }' }, 'small'), finalOutput('Done.'),
  ] });
  const result = await generateTemplateWithOpenRouterAgent({ validateDraft, languageModel: model, mode: 'edit', files: { ...starterProject(true), 'notes.md': content, 'small.css': 'body { color: red; }' }, prompt: 'Use blue text' });
  const rejection = model.doGenerateCalls[1].prompt.find(message => message.role === 'tool').content[0].output.value;
  assert.match(rejection.error, /focused section/);
  assert.equal(result.files['notes.md'], content);
  assert.equal(result.files['small.css'], 'body { color: blue; }', 'small existing files can still be replaced coherently');
});
