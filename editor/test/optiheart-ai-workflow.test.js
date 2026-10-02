import test from 'node:test';
import assert from 'node:assert/strict';
import { runStudioAiWorkflow } from '@trafficops/template-editor-shell/studio-ai-workflow';
import { setAiRetrySleepForTesting } from '../../packages/template-editor-shell/src/ai-provider-recovery.js';

setAiRetrySleepForTesting(async () => {});
import { validateDraft } from './support/ai-validator.js';
import { OPTIHEART_BRIEF, optiheartInitialProject, optiheartCompletedValues, inspectOptiheartDraft } from './support/optiheart-ai-case.js';
import { createMetricsFetch, createSyntheticOpenRouter } from './ai-live-check.mjs';

const models = ['openai/gpt-5-mini', 'qwen/qwen3.8-flash', 'xiaomi/mimo-v2.6-flash', 'google/gemini-3.8-flash'];

for (const model of models) for (const mode of ['edit', 'create']) test(`${model}: the complete OptiHeart brief updates source and saved Russian values before independent review (${mode})`, async () => {
  const initial = optiheartInitialProject(), original = structuredClone(initial), events = [];
  const tracker = createMetricsFetch({ apiKey: 'synthetic-key-never-paid', fetchImpl: createSyntheticOpenRouter({ initial, mode }) });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode, prompt: OPTIHEART_BRIEF, apiKey: 'synthetic-key-never-paid', model, stream: true, generateImages: false, validateDraft, fetchImpl: tracker.fetch, onProgress: event => events.push(event) });
  await tracker.settled();
  assert.equal(result.valid, true); assert.equal(result.review.approved, true); assert.deepEqual(result.review.issues, []);
  assert.deepEqual(result.values, optiheartCompletedValues, 'existing parameter values must not override changed defaults with the old Russian text');
  const inspected = inspectOptiheartDraft(result);
  for (const [requirement, passed] of Object.entries(inspected.checks)) if (passed !== null) assert.equal(passed, true, requirement);
  assert.equal(inspected.videoPlaceholderCount, 3); assert.deepEqual(inspected.missingLocalAssets, []);
  assert.equal(result.files['script.js'], initial.files['script.js'], 'unrelated JS behavior is preserved');
  assert.deepEqual(initial, original, 'generation does not change the persisted project before Apply');
  assert.equal(events.filter(event => event.type === 'review').length, 1);
  assert.equal(events.at(-1).phase, 'ready');
  assert.ok(tracker.calls.length <= 6, 'validated generation advances directly to review without a redundant prose-only call');
  assert.equal(tracker.calls.filter(call => call.endpoint.endsWith('/images')).length, 0, 'the brief asks for video placeholders rather than paid image generation');
  for (const request of tracker.calls) {
    assert.equal(request.model, model); assert.equal(request.toolChoice, 'auto'); assert.equal(request.temperaturePresent, false);
    assert.ok(request.responseBytes > 0); assert.ok(request.seconds >= 0); assert.equal(request.usage.cost, 0);
    assert.equal(JSON.stringify(request).includes('synthetic-key-never-paid'), false);
  }
});

test('a pre-tool 503 gets one bounded retry and the complete OptiHeart brief still reaches ready', async () => {
  const initial = optiheartInitialProject(), tracker = createMetricsFetch({ apiKey: 'synthetic-key-never-paid', fetchImpl: createSyntheticOpenRouter({ initial, failPlannerOnce: true }) });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'edit', prompt: OPTIHEART_BRIEF, apiKey: 'synthetic-key-never-paid', model: models[0], stream: true, generateImages: false, validateDraft, fetchImpl: tracker.fetch });
  await tracker.settled();
  assert.equal(result.valid, true); assert.equal(result.review.approved, true);
  assert.equal(tracker.calls.filter(call => call.stage === 'submit_plan').length, 2);
  assert.equal(tracker.calls.filter(call => call.status === 503).length, 1);
  assert.equal(tracker.calls.filter(call => call.stage === 'write').length, 3, 'the writer itself is not replayed after the planner retry');
  assert.equal(inspectOptiheartDraft(result).checks.polishLanguage, true);
});

test('independent source and value writes in the same provider response produce the same complete draft with four calls', async () => {
  const initial = optiheartInitialProject(), tracker = createMetricsFetch({ apiKey: 'synthetic-key-never-paid', fetchImpl: createSyntheticOpenRouter({ initial, batchWrites: true }) });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'edit', prompt: OPTIHEART_BRIEF, apiKey: 'synthetic-key-never-paid', model: models[2], stream: true, generateImages: false, validateDraft, fetchImpl: tracker.fetch });
  await tracker.settled();
  assert.equal(result.valid, true); assert.deepEqual(result.values, optiheartCompletedValues);
  const inspected = inspectOptiheartDraft(result);
  for (const [requirement, passed] of Object.entries(inspected.checks)) if (passed !== null) assert.equal(passed, true, requirement);
  assert.equal(tracker.calls.length, 4, 'Plan → batched writes → validation → independent review');
});

test('a stream failure after tool input starts retains earlier Polish values and never replays writes or marks ready', async () => {
  const initial = optiheartInitialProject(), original = structuredClone(initial), events = [];
  let retainedValues = initial.values;
  const tracker = createMetricsFetch({ apiKey: 'synthetic-key-never-paid', fetchImpl: createSyntheticOpenRouter({ initial, interruptWriter: true }) });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'edit', prompt: OPTIHEART_BRIEF, apiKey: 'synthetic-key-never-paid', model: models[0], stream: true, generateImages: false, validateDraft, fetchImpl: tracker.fetch,
    onProgress(event) { events.push(event); if (event.values && !event.partial) retainedValues = event.values; } }), /Synthetic provider|503|interrupted/i);
  await tracker.settled();
  assert.deepEqual(retainedValues, optiheartCompletedValues);
  assert.deepEqual(initial, original);
  assert.equal(tracker.calls.length, 3, 'planner, completed value update, failed source edit; no paid replay');
  assert.equal(tracker.calls.filter(call => call.stage === 'submit_review').length, 0);
  assert.equal(events.some(event => event.phase === 'ready'), false);
  assert.equal(events.filter(event => event.type === 'values-set').length, 1);
});

test('four completed images survive a later nested Google 503; only the unfinished text call retries (three bounded retries)', async () => {
  const initial = optiheartInitialProject(), original = structuredClone(initial), events = [];
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
  const paths = ['images/video-surgeon-or.png', 'images/video-vessels-comparison.png', 'images/video-coronary-bypass.png', 'images/optiheart-bottle.png'];
  const syntheticStages = createSyntheticOpenRouter({ initial });
  let writerCalls = 0, imageCalls = 0, retained = initial.files;
  const tracker = createMetricsFetch({ apiKey: 'synthetic-key-never-paid', fetchImpl: async (url, init) => {
    if (String(url).endsWith('/images')) { imageCalls++; return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); }
    const body = JSON.parse(init.body), names = body.tools.map(tool => tool.function.name);
    if (names.includes('submit_plan')) return syntheticStages(url, init);
    if (names.includes('submit_review')) throw new Error('A failed writer must not run a reviewer.');
    if (!writerCalls++) {
      const payload = { id: 'gen-synthetic-four-images', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: paths.map((path, index) => ({ index, id: `image-${index}`, type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ path, prompt: `Synthetic requested illustration ${index + 1}`, referenceIds: [] }) } })) }, finish_reason: 'tool_calls' }] };
      return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const payload = { error: { message: 'Provider returned error', code: 502, metadata: { provider_name: 'Google', raw: JSON.stringify({ error: { code: 503, message: 'The model is currently experiencing high demand. Please try again later.', status: 'UNAVAILABLE' } }) } } };
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'edit', prompt: OPTIHEART_BRIEF, apiKey: 'synthetic-key-never-paid', model: models[3], imageModel: 'google/gemini-3.1-flash-lite-image', stream: true, generateImages: true, validateDraft, fetchImpl: tracker.fetch,
    onProgress(event) { events.push(event); if (event.files && !event.partial) retained = event.files; } }), /Google|high demand|503/i);
  await tracker.settled();
  assert.equal(imageCalls, 4, 'the successful image requests are never repeated');
  assert.equal(writerCalls, 5, 'one successful image tool response, then one failed text response and its three bounded retries');
  for (const path of paths) assert.ok(retained[path] instanceof Uint8Array && retained[path].byteLength > 0, `retained ${path}`);
  assert.deepEqual(initial, original, 'retained images remain a review draft and do not mutate the original project');
  assert.equal(events.some(event => event.phase === 'ready'), false);
  assert.equal(events.filter(event => event.type === 'provider-recovery').length, 3);
  assert.equal(tracker.calls.filter(call => call.endpoint.endsWith('/images')).length, 4);
  assert.equal(tracker.calls.filter(call => call.stage === 'submit_review').length, 0);
});

test('verification catches a superficially valid page that leaves saved Russian text or references nonexistent local assets', () => {
  const initial = optiheartInitialProject();
  assert.equal(inspectOptiheartDraft(initial).checks.polishLanguage, false);
  const files = { ...initial.files, 'index.tpl': initial.files['index.tpl'].replace('</body>', '<img src="images/imaginary-doctor.png"></body>') };
  const inspected = inspectOptiheartDraft({ files, values: initial.values });
  assert.equal(inspected.checks.noMissingLocalAssets, false);
  assert.deepEqual(inspected.missingLocalAssets, [{ page: 'index.html', asset: 'images/imaginary-doctor.png' }]);
});

test('wire metrics retain only usage and diagnostics, redact the secret, and enforce the next-call budget', async () => {
  let sent = 0;
  const key = 'sk-or-synthetic-super-secret';
  const tracker = createMetricsFetch({ apiKey: key, maxCalls: 1, fetchImpl: async () => {
    sent++;
    return Response.json({ id: 'gen-synthetic-metrics', usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.01 }, error: { code: 403, message: `Synthetic denial ${key}` }, choices: [{ message: { content: 'Private provider output must not be retained.' } }] }, { status: 403 });
  } });
  const request = { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: models[0], messages: [{ role: 'user', content: 'Private prompt must not be retained.' }] }) };
  await (await tracker.fetch('https://openrouter.ai/api/v1/chat/completions', request)).json(); await tracker.settled();
  const report = JSON.stringify(tracker.calls);
  assert.equal(report.includes(key), false); assert.equal(report.includes('Private'), false); assert.equal(report.includes('Authorization'), false);
  assert.equal(tracker.calls[0].generationId, 'gen-synthetic-metrics'); assert.equal(tracker.calls[0].usage.cost, 0.01); assert.equal(tracker.calls[0].error.statusCode, 403);
  await assert.rejects(tracker.fetch('https://openrouter.ai/api/v1/chat/completions', request), /budget reached/);
  assert.equal(sent, 1);
});
