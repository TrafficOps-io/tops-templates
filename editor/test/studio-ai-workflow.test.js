import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { parseProject, getDefaults } from '@trafficops/template-runtime';
import { generateContentDraft, runStudioAiWorkflow } from '@trafficops/template-editor-shell/studio-ai-workflow';
import { setAiRetrySleepForTesting } from '../../packages/template-editor-shell/src/ai-provider-recovery.js';

setAiRetrySleepForTesting(async () => {});
import { attachmentAssets, attachmentMessage, readImageAttachments, validateAttachments } from '@trafficops/template-editor-shell/ai-attachments';
import { validateDraft } from './support/ai-validator.js';
import { starterProject } from './support/starter.js';
import { copyProject, createProjectInRoot } from '../src/storage/project-root.js';
import { readProjectMeta, resolvePendingAi } from '../src/storage/project-meta.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';
import { aiProjectContext } from '../../packages/template-editor-shell/src/ai-context.js';
import { createAiDiagnostics } from '../../packages/template-editor-shell/src/ai-diagnostics.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const call = (name, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: name, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] });
const done = () => ({ content: [{ type: 'text', text: 'Draft ready.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
const plan = () => call('submit_plan', { summary: 'Write and check the requested content.', tasks: ['Write the requested copy', 'Review it against the brief'], imageRequests: [] });
const review = (issues = []) => call('submit_review', { approved: !issues.length, summary: issues.length ? 'Needs a longer article.' : 'The draft matches the brief.', issues });
const setup = () => { const files = starterProject(); const { definition } = parseProject(files); return { files, definition, values: getDefaults(definition) }; };
const attachment = (useOnPage = false) => ({ id: 'photo-1', name: 'portrait.png', mime: 'image/png', dataUrl: `data:image/png;base64,${png}`, useOnPage });

test('Fill Content writes fields in separate calls, independently reviews, repairs and reviews again', async () => {
  const initial = setup(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Polski tytuł' } }), call('set_values', { values: { description: 'A complete first article.' } }), done(), review(['Expand the article to match the requested length.']), call('set_values', { values: { description: 'A revised complete article with all requested details.' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Write Polish content.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.review.approved, true);
  assert.equal(result.values.headline, 'Polski tytuł');
  assert.equal(result.values.description, 'A revised complete article with all requested details.');
  assert.deepEqual(result.files, initial.files); assert.notEqual(initial.values.headline, result.values.headline);
  assert.deepEqual(events.filter(event => event.type === 'phase').map(event => event.phase), ['plan', 'generate', 'review', 'revise', 'review', 'ready']);
  const reviews = model.doGenerateCalls.filter(input => input.tools?.some(tool => tool.name === 'submit_review'));
  assert.equal(reviews.length, 2);
  assert.ok(JSON.stringify(reviews[1].prompt).includes(result.values.description), 'review sees the actual revised content');
});

for (const mode of ['edit', 'create']) test(`${mode} source generation has planning, independent reviewer, revision and a second review`, async () => {
  const files = starterProject(true), events = [];
  const write = mode === 'create' ? call('set_file', { path: 'index.tpl', content: files['index.tpl'] }) : call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<footer>First draft</footer></body>' });
  const model = new MockLanguageModelV4({ doGenerate: [plan(), write, done(), review(['Add the requested FAQ.']), call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<section id="faq">Requested FAQ</section></body>' }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode, files, values: { title: 'Original' }, prompt: 'Add a FAQ.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.match(result.files['index.tpl'], /Requested FAQ/);
  assert.equal(files['index.tpl'].includes('Requested FAQ'), false);
  assert.equal(events.filter(event => event.type === 'review').length, 2);
});

test('content image generation uses selected references, keeps binary assets in draft and preserves source', async () => {
  const initial = setup(), refs = [attachment(true)], images = [];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('generate_image', { path: 'images/article.png', prompt: 'An editorial illustration', referenceIds: ['photo-1'] }), call('set_values', { values: { image: 'images/article.png', headline: 'New headline' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill content and generate an article image.', attachments: refs, generateImages: true, apiKey: 'mock-secret', imageModel: 'test/image', languageModel: model, validateDraft,
    fetchImpl: async (_url, init) => { images.push(JSON.parse(init.body)); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(images.length, 1); assert.equal(images[0].input_references[0].image_url.url, refs[0].dataUrl);
  assert.ok(result.files['images/article.png'] instanceof Uint8Array);
  assert.ok(result.files['images/reference-photo-1.png'] instanceof Uint8Array);
  assert.equal(result.values.image, 'images/article.png'); assert.equal(result.files['index.tpl'], initial.files['index.tpl']);
  assert.equal(initial.files['images/article.png'], undefined);
  assert.ok(model.doGenerateCalls[0].prompt.some(message => message.content?.some?.(part => part.type === 'file' && part.mediaType === 'image/png')), 'vision reference reaches planner');
});

test('Create preserves attached page photos and source agent can generate requested illustrations', async () => {
  const files = starterProject(true), refs = [attachment(true)];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('generate_image', { path: 'images/hero.png', prompt: 'Hero art', referenceIds: [] }), call('set_file', { path: 'index.tpl', content: files['index.tpl'] }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'create', prompt: 'Create a page with hero art.', attachments: refs, generateImages: true, apiKey: 'mock', imageModel: 'test/image', languageModel: model, validateDraft, fetchImpl: async () => Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }) });
  assert.ok(result.files['images/hero.png'] instanceof Uint8Array); assert.ok(result.files['images/reference-photo-1.png'] instanceof Uint8Array);
});

test('failed review never marks a draft ready, and content repair cannot change source files', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'First' } }), done(), review(['Missing requested facts']), call('set_values', { values: { headline: 'Second' } }), done(), review(['Still missing']), call('set_values', { values: { headline: 'Third' } }), done(), review(['Still missing'])] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill the page', languageModel: model, validateDraft });
  assert.equal(result.valid, false); assert.match(result.error, /reviewer/); assert.equal(result.review.approved, false); assert.deepEqual(result.files, initial.files);
});

test('content rejects invalid fields, accepts a corrected tool call, and has no JSON-only empty response path', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { showNote: 'wrong type', extra: 'bad' } }), call('set_values', { values: { headline: 'Valid content', showNote: true } }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill content', languageModel: model, validateDraft });
  assert.equal(result.values.showNote, true); assert.equal(result.values.extra, undefined);
  assert.ok(model.doGenerateCalls.filter(call => call.tools?.some(tool => tool.name === 'set_values')).length > 0);
});

test('Fill Content preserves an existing remote image while updating other fields', async () => {
  const initial = setup(); initial.values.image = 'https://example.com/existing-photo.jpg?version=1';
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Updated headline' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline and preserve the image.', languageModel: model, validateDraft });
  assert.equal(result.valid, true); assert.equal(result.values.image, initial.values.image); assert.equal(result.values.headline, 'Updated headline');
});

test('cancelling before reviewer completes rejects without altering project content', async () => {
  const initial = setup(), controller = new AbortController();
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    if (input.tools?.some(tool => tool.name === 'submit_plan')) return plan();
    if (input.tools?.some(tool => tool.name === 'submit_review')) { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); }
    return model.doGenerateCalls.length === 2 ? call('set_values', { values: { headline: 'Draft only' } }) : done();
  } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill', languageModel: model, validateDraft, signal: controller.signal }));
  assert.notEqual(initial.values.headline, 'Draft only');
});

test('a streamed planner provider failure rejects once, redacts the key and preserves the original', async () => {
  const initial = setup(), original = structuredClone(initial);
  let requests = 0;
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill', stream: true, apiKey: 'mock-secret', model: 'test/model', validateDraft,
    fetchImpl: async () => { requests++; throw new Error('Provider unavailable: mock-secret'); } }), /Provider unavailable: \[redacted\]/);
  assert.equal(requests, 1, 'a provider failure must not repeat paid requests');
  assert.deepEqual(initial, original);
});

// Endpoint capabilities from /api/v1/models/{model}/endpoints: GPT-5 Mini
// omits temperature; Qwen3.8 Flash supports auto/none, not required/function.
for (const model of ['openai/gpt-5-mini', 'qwen/qwen3.8-flash']) for (const mode of ['content', 'edit', 'create']) test(`${model} streams ${mode} planning, writing and review through its supported request parameters`, async () => {
  const initial = setup(), requests = [];
  let writerSteps = 0;
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode, prompt: 'Update the landing.', attachments: [attachment()], apiKey: 'mock-key', model, stream: true, validateDraft,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      if (model === 'openai/gpt-5-mini' && Object.hasOwn(body, 'temperature')) return Response.json({ error: { message: 'No endpoints found that can handle the requested parameters.', code: 404 } }, { status: 404 });
      if (model === 'qwen/qwen3.8-flash' && !['auto', 'none'].includes(body.tool_choice)) return Response.json({ error: { message: "No endpoints found that support the provided 'tool_choice' value.", code: 404 } }, { status: 404 });
      const names = body.tools.map(tool => tool.function.name);
      let response;
      if (names.includes('submit_plan')) response = plan();
      else if (names.includes('submit_review')) response = review();
      else if (writerSteps++) response = done();
      else if (mode === 'content') response = call('set_values', { values: { headline: 'Updated headline' } });
      else if (mode === 'edit') response = call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<footer>Updated footer</footer></body>' });
      else response = call('set_file', { path: 'index.tpl', content: starterProject(true)['index.tpl'] });
      const content = response.content[0];
      const delta = content.type === 'tool-call' ? { role: 'assistant', tool_calls: [{ index: 0, id: content.toolCallId, type: 'function', function: { name: content.toolName, arguments: content.input } }] } : { content: content.text };
      const chunk = { id: 'compatibility-test', model, choices: [{ index: 0, delta, finish_reason: response.finishReason.raw }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    } });
  assert.equal(result.valid, true); assert.equal(result.review.approved, true);
  assert.equal(requests.length, 4, 'no fallback requests are needed');
  for (const request of requests) {
    assert.equal(request.model, model); assert.equal(request.tool_choice, 'auto');
    assert.equal(Object.hasOwn(request, 'temperature'), false);
    assert.deepEqual(request.provider, { require_parameters: true, allow_fallbacks: true, data_collection: 'deny' });
    assert.ok(request.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url')), 'references still reach each stage');
  }
  assert.equal(mode === 'content' ? result.values.headline === 'Updated headline' : result.files['index.tpl'].includes(mode === 'edit' ? 'Updated footer' : '@template'), true);
});

test('automatic tool selection cannot complete planning or review with a prose-only response', async () => {
  const initial = setup();
  const noPlan = new MockLanguageModelV4({ doGenerate: [done()] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill', languageModel: noPlan, validateDraft }), /did not submit a plan/);
  assert.equal(noPlan.doGenerateCalls.length, 1);
  const noReview = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Draft only' } }), done(), done()] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill', languageModel: noReview, validateDraft }), /did not submit a review/);
  assert.notEqual(initial.values.headline, 'Draft only');
});

test('Fill Content recovers once from a prose-only response and requires actual validated field changes', async () => {
  const initial = setup(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), done(), call('set_values', { values: { headline: 'Completed after clarification' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Completed after clarification');
  assert.equal(events.filter(event => event.type === 'content-recovery').length, 1);
  assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /calling set_values now/);
  assert.deepEqual(result.files, initial.files);
});

test('a repeated response with no content changes stops after one recovery without blaming tool capabilities', async () => {
  const initial = setup(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [done(), done()] });
  await assert.rejects(generateContentDraft({ ...initial, prompt: 'Fill', languageModel: model, validateDraft, onProgress: event => events.push(event) }), error => /without completing any content changes/.test(error.message) && !/tool calling support/.test(error.message));
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal(events.filter(event => event.type === 'content-recovery').length, 1);
});

test('an image committed while set_values validates is never dropped by a stale cached validation', async () => {
  const initial = setup(), bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0)), events = [];
  let entered, committed, gated = false;
  const validationEntered = new Promise(resolve => { entered = resolve; }), imageCommitted = new Promise(resolve => { committed = resolve; });
  const both = { content: [
    { type: 'tool-call', toolCallId: 'values-1', toolName: 'set_values', input: JSON.stringify({ values: { headline: 'New headline' } }) },
    { type: 'tool-call', toolCallId: 'image-1', toolName: 'generate_image', input: JSON.stringify({ path: 'images/new.png', prompt: 'A new hero photo' }) },
  ], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] };
  const model = new MockLanguageModelV4({ doGenerate: [both, call('set_values', { values: { headline: 'New headline' } }), call('validate_draft', {}), done()] });
  const result = await generateContentDraft({ ...initial, prompt: 'Fill content and add a hero photo.', languageModel: model,
    validateDraft: async input => {
      if (!gated) { gated = true; entered(); await imageCommitted; }
      return validateDraft(input);
    },
    generateImage: async () => { await validationEntered; return bytes; },
    onProgress: event => { events.push(event); if (event.type === 'file-set') committed(); } });
  assert.equal(result.valid, true);
  assert.ok(result.files['images/new.png'] instanceof Uint8Array, 'the paid image survives the final validation');
  assert.equal(result.values.headline, 'New headline');
  const first = model.doGenerateCalls[1].prompt.flatMap(message => Array.isArray(message.content) ? message.content : []).find(part => part.type === 'tool-result' && part.toolCallId === 'values-1');
  assert.match(JSON.stringify(first.output), /changed during the field update/);
});

test('exhausting the output token budget before any content changes reports the limit without a blind retry', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [{ ...done(), content: [], finishReason: { unified: 'length', raw: 'length' } }] });
  await assert.rejects(generateContentDraft({ ...initial, prompt: 'Fill', languageModel: model, validateDraft }), /output token limit/);
  assert.equal(model.doGenerateCalls.length, 1);
});

test('attachment validation bounds input, excludes reference-only images from assets and preserves creation handoff', async () => {
  const refs = await readImageAttachments([new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'photo.png', { type: 'image/png' })]);
  assert.equal(refs.length, 1); assert.deepEqual(attachmentAssets(refs), {});
  assert.ok(Array.isArray(attachmentMessage('Brief', refs)));
  assert.throws(() => validateAttachments(Array.from({ length: 5 }, () => attachment())), /up to 4/);
  assert.throws(() => validateAttachments([{ ...attachment(), mime: 'image/svg+xml' }]), /PNG/);
  const root = new MemoryDirectoryHandle('refs'), copy = new MemoryDirectoryHandle('copy');
  await createProjectInRoot(root, { kind: 'landing', name: 'AI refs', files: starterProject(true), brief: { id: 'brief-1', prompt: 'Use photos', mode: 'create', generateImages: true, attachments: refs } });
  const handoff = await resolvePendingAi(root, await readProjectMeta(root));
  assert.deepEqual(handoff.attachments.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl })), refs.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl })));
  await copyProject(root, copy);
  assert.equal((await readProjectMeta(copy)).pendingAi, undefined, 'a copy never inherits the creation brief');
});

test('content planning, writing and review send actual fields and values without source or large unrelated documents', async () => {
  const initial = setup();
  initial.files['private-notes.md'] = 'UNRELATED_DOCUMENT_CONTENT '.repeat(14000);
  initial.files['images/unused.svg'] = '<svg xmlns="http://www.w3.org/2000/svg"><!-- UNUSED_SVG_SOURCE --></svg>';
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Polski tytuł' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Translate the headline.', languageModel: model, validateDraft });
  assert.equal(result.valid, true);
  for (const request of model.doGenerateCalls) {
    const prompt = JSON.stringify(request.prompt);
    assert.equal(prompt.includes('UNRELATED_DOCUMENT_CONTENT'), false);
    assert.equal(prompt.includes('UNUSED_SVG_SOURCE'), false);
    assert.equal(prompt.includes('@template'), false, 'content stages do not send source text');
    assert.ok(prompt.includes('headline'), 'actual editable fields remain available');
  }
  assert.equal(result.files['private-notes.md'], initial.files['private-notes.md']);
});

test('source planner excludes large unrelated source, while review sees actual changed page source', async () => {
  const files = starterProject(true);
  files['private-notes.md'] = 'UNRELATED_SOURCE_DOCUMENT '.repeat(14000);
  files['images/unused.svg'] = '<svg xmlns="http://www.w3.org/2000/svg"><!-- UNUSED_SVG_SOURCE --></svg>';
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<section id="videos">Video placeholders</section></body>' }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'edit', files, values: { title: 'Saved title' }, prompt: 'Add video placeholders.', languageModel: model, validateDraft });
  assert.equal(result.valid, true);
  assert.equal(JSON.stringify(model.doGenerateCalls[0].prompt).includes('@template'), false, 'planner receives manifest and values, not full source');
  const reviewer = model.doGenerateCalls.find(request => request.tools?.some(tool => tool.name === 'submit_review'));
  const prompt = JSON.stringify(reviewer.prompt);
  assert.ok(prompt.includes('Video placeholders'));
  assert.equal(prompt.includes('UNRELATED_SOURCE_DOCUMENT'), false);
  assert.equal(prompt.includes('UNUSED_SVG_SOURCE'), false);
});

test('parallel content updates preserve both completed edits and validate without a summary round trip', async () => {
  const initial = setup();
  const writes = [call('set_values', { values: { headline: 'Polski tytuł' } }), call('set_values', { values: { description: 'Polski opis' } }), call('validate_draft', {})];
  const batch = { ...writes[0], content: writes.flatMap(response => response.content) };
  const model = new MockLanguageModelV4({ doGenerate: [plan(), batch, review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Translate the headline and description.', languageModel: model,
    validateDraft: async options => { await new Promise(resolve => setTimeout(resolve, 10)); return validateDraft(options); } });
  assert.equal(result.valid, true);
  assert.equal(result.values.headline, 'Polski tytuł');
  assert.equal(result.values.description, 'Polski opis');
  assert.equal(model.doGenerateCalls.length, 3, 'one batch finishes writing and runs the independent reviewer');
});

test('planner detects a content request that needs new sections and does not downscope or start writing', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [call('submit_plan', { summary: 'Add three video blocks that are absent from the existing fields.', tasks: ['Add video sections'], requiresSourceChanges: true })] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Add three video placeholders.', languageModel: model, validateDraft }), /needs Edit project/);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.deepEqual(initial.files, setup().files);
});

test('reviewer source requirements preserve a partial content draft without futile source repair attempts', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Polski tytuł' } }), done(), call('submit_review', { approved: false, summary: 'The page needs new video sections.', issues: ['Add three new video blocks.'], requiresSourceChanges: true })] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Translate and add video blocks.', languageModel: model, validateDraft });
  assert.equal(result.valid, false);
  assert.match(result.error, /need Edit project/);
  assert.equal(result.values.headline, 'Polski tytuł');
  assert.equal(model.doGenerateCalls.length, 4, 'impossible source changes do not trigger two content revision loops');
  assert.deepEqual(result.files, initial.files);
});

test('schema-valid JSON from an automatic tool provider can submit planning and independent review', async () => {
  const initial = setup();
  const json = value => ({ ...done(), content: [{ type: 'text', text: JSON.stringify(value) }] });
  const model = new MockLanguageModelV4({ doGenerate: [json({ summary: 'Translate headline.', tasks: ['Write Polish headline'] }), call('set_values', { values: { headline: 'Polski tytuł' } }), done(), json({ approved: true, summary: 'Actual Polish headline verified.', issues: [] })] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Translate headline.', languageModel: model, validateDraft });
  assert.equal(result.valid, true);
  assert.equal(result.review.approved, true);
});

for (const stage of ['submit_plan', 'submit_review']) for (const invalid of ['missing-field', 'overlong-summary', 'malformed-json']) test(`${stage} corrects ${invalid} once with schema feedback and preserved response history`, async () => {
  const initial = setup(), events = [], apiKey = 'sk-or-schema-test-private';
  const valid = stage === 'submit_plan' ? plan() : review();
  const input = JSON.parse(valid.content[0].input);
  if (invalid === 'missing-field') delete input[stage === 'submit_plan' ? 'tasks' : 'issues'];
  if (invalid === 'overlong-summary') input.summary = `${apiKey} private offer content `.repeat(100);
  const broken = call(stage, input);
  if (invalid === 'malformed-json') broken.content[0].input = '{"summary":"unfinished';
  const reasoning = { openrouter: { reasoning_details: [{ type: 'reasoning.text', text: 'Internal schema analysis.', signature: 'signed-stage-response', format: 'google-gemini-v1' }] } };
  broken.content[0].providerMetadata = reasoning;
  const writer = [call('set_values', { values: { headline: 'Completed headline' } }), done()];
  const responses = stage === 'submit_plan' ? [broken, valid, ...writer, review()] : [plan(), ...writer, broken, valid];
  const model = new MockLanguageModelV4({ doGenerate: responses });
  const diagnostics = createAiDiagnostics({ model: 'mock/model', mode: 'content', apiKey });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', apiKey, languageModel: model, validateDraft,
    onProgress: event => { events.push(event); diagnostics.record(event); } });
  assert.equal(result.valid, true); assert.equal(result.review.approved, true);
  assert.equal(result.values.headline, 'Completed headline');
  const submissions = model.doGenerateCalls.filter(request => request.tools?.some(tool => tool.name === stage));
  assert.equal(submissions.length, 2, 'only one additional read-only correction call is allowed');
  const history = submissions[1].prompt;
  const previous = history.filter(message => message.role === 'assistant').flatMap(message => message.content).find(part => part.type === 'tool-call' && part.toolName === stage);
  assert.equal(previous.toolCallId, broken.content[0].toolCallId);
  assert.deepEqual(previous.providerOptions, reasoning, 'signed reasoning from the rejected turn remains intact');
  assert.ok(history.filter(message => message.role === 'tool').flatMap(message => message.content).some(part => part.toolName === stage && part.output.type === 'error-text'), 'SDK validation feedback reaches the correction call');
  const failures = events.filter(event => event.code === 'AI_STAGE_SCHEMA_INVALID');
  assert.equal(failures.length, 1); assert.equal(failures[0].tool, stage);
  assert.match(failures[0].outcome, invalid === 'missing-field' ? /(?:tasks|issues):invalid_type/ : invalid === 'overlong-summary' ? /summary:too_big/ : /result:invalid_json/);
  const exported = JSON.stringify(diagnostics.snapshot());
  assert.match(exported, /AI_STAGE_SCHEMA_INVALID/);
  assert.equal(exported.includes(apiKey), false); assert.equal(exported.includes('private offer content'), false);
  assert.deepEqual(result.files, initial.files);
});

test('a second invalid review stops with schema diagnostics and retains the completed draft', async () => {
  const initial = setup(), events = [];
  const invalid = () => call('submit_review', { approved: true, summary: 'Missing the mandatory issues array.' });
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Retained content' } }), done(), invalid(), invalid(), review()] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', languageModel: model, validateDraft, onProgress: event => events.push(event) }), error => {
    assert.equal(error.code, 'AI_STAGE_SCHEMA_INVALID');
    assert.match(error.message, /issues \(invalid_type\)/); assert.match(error.message, /completed draft is retained/i);
    assert.doesNotMatch(error.message, /project is unchanged/i);
    return true;
  });
  assert.equal(model.doGenerateCalls.length, 5, 'invalid submissions cannot create an unbounded stage loop');
  assert.ok(events.some(event => event.type === 'draft-sync' && event.values?.headline === 'Retained content'));
  assert.equal(events.some(event => event.type === 'phase' && event.phase === 'ready'), false);
  assert.notEqual(initial.values.headline, 'Retained content');
});

test('prose after an invalid review cannot approve the draft or trigger a third submission call', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Draft content' } }), done(), call('submit_review', { approved: 'true', summary: 'Wrong approval type.', issues: [] }), done(), review()] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', languageModel: model, validateDraft }), /did not submit a review.*completed draft is retained/i);
  assert.equal(model.doGenerateCalls.length, 5);
});

test('cancellation after a rejected submission prevents its correction call', async () => {
  const initial = setup(), controller = new AbortController();
  const model = new MockLanguageModelV4({ doGenerate: [call('submit_plan', { summary: 'Missing tasks.' }), plan()] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', languageModel: model, validateDraft, signal: controller.signal,
    onProgress: event => { if (event.code === 'AI_STAGE_SCHEMA_INVALID') controller.abort(); } }), /cancelled or timed out/i);
  assert.equal(model.doGenerateCalls.length, 1);
});

test('a rejected submission cannot obtain a fresh deadline for its correction', async t => {
  const initial = setup(), started = Date.now();
  let clock = started;
  t.mock.method(Date, 'now', () => clock);
  const model = new MockLanguageModelV4({ doGenerate: async () => { clock = started + 21; return call('submit_plan', { summary: 'Missing tasks.' }); } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', timeout: 20, languageModel: model, validateDraft }), /run time limit/);
  assert.equal(model.doGenerateCalls.length, 1);
});

test('a transport retry does not spend the stage budget, which still allows only one schema correction', async () => {
  const initial = setup(), retryState = { attempted: false };
  let attempts = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (!attempts++) throw Object.assign(new Error('Temporarily unavailable.'), { statusCode: 503 });
    return call('submit_plan', { summary: 'Missing tasks after recovery.' });
  } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', languageModel: model, validateDraft, retryState }), error => {
    assert.equal(error.code, 'AI_STAGE_SCHEMA_INVALID'); assert.match(error.message, /project is unchanged/i); return true;
  });
  assert.equal(model.doGenerateCalls.length, 3, 'one unbilled retry, the submission and its single correction');
});

for (const stage of ['submit_plan', 'submit_review']) test(`the streaming OpenRouter adapter corrects invalid ${stage} input and retains opaque reasoning history`, async () => {
  const initial = setup(), requests = [], details = [{ type: 'reasoning.encrypted', data: 'opaque-stage-analysis', format: 'google-gemini-v1', index: 0 }];
  let stageAttempts = 0, writerCalls = 0;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    const names = body.tools.map(tool => tool.function.name);
    let response;
    const submitting = names.includes(stage);
    if (submitting && stageAttempts++ === 0) response = call(stage, stage === 'submit_plan' ? { summary: 'Missing tasks.' } : { approved: true, summary: 'Missing issues.' });
    else if (names.includes('submit_plan')) response = plan();
    else if (names.includes('submit_review')) response = review();
    else response = writerCalls++ ? call('validate_draft', {}) : call('set_values', { values: { headline: 'Completed streamed content' } });
    const part = response.content[0];
    const payload = { id: 'gen-stage-schema-test', model: body.model, choices: [{ index: 0,
      delta: { role: 'assistant', tool_calls: [{ index: 0, id: part.toolCallId, type: 'function', function: { name: part.toolName, arguments: part.input } }], ...(submitting && stageAttempts === 1 ? { reasoning_details: details } : {}) }, finish_reason: 'tool_calls' }] };
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', apiKey: 'mock-schema-key', model: 'qwen/qwen3.8-flash', stream: true, fetchImpl, validateDraft });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Completed streamed content');
  const submissions = requests.filter(request => request.tools.some(tool => tool.function.name === stage));
  assert.equal(submissions.length, 2);
  assert.ok(submissions[1].messages.some(message => message.role === 'tool'), 'a schema-invalid streamed tool call retains its validation feedback');
  assert.ok(submissions[1].messages.some(message => message.role === 'assistant' && JSON.stringify(message.reasoning_details) === JSON.stringify(details)), 'opaque reasoning is returned exactly as received');
  assert.ok(submissions.every(request => request.tool_choice === 'auto'), 'repair does not require an unsupported named tool choice');
});

for (const stage of ['submit_plan', 'submit_review']) for (const count of [1, 8]) test(`${stage} repairs ${count} unavailable image calls without executing the image generator`, async () => {
  const initial = setup(), events = [];
  const wrong = call('generate_image', { path: 'images/wrong-0.png', prompt: 'An image requested in the brief.' });
  for (let index = 1; index < count; index++) wrong.content.push(...call('generate_image', { path: `images/wrong-${index}.png`, prompt: 'Another image.' }).content);
  const writer = [call('set_values', { values: { headline: 'Completed after tool correction' } }), done()];
  const responses = stage === 'submit_plan' ? [wrong, plan(), ...writer, review()] : [plan(), ...writer, wrong, review()];
  const model = new MockLanguageModelV4({ doGenerate: responses });
  let images = 0;
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', generateImages: true, apiKey: 'mock-key', imageModel: 'test/image', languageModel: model, validateDraft,
    fetchImpl: async () => { images++; throw new Error('A stage submission must not generate an image.'); }, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Completed after tool correction');
  assert.equal(images, 0); assert.deepEqual(result.files, initial.files);
  const submissions = model.doGenerateCalls.filter(request => request.tools.some(tool => tool.name === stage));
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions.map(request => request.tools.map(tool => tool.name)), [[stage], [stage]], 'stage correction has no writer or image tools');
  const toolFeedback = submissions[1].prompt.filter(message => message.role === 'tool').flatMap(message => message.content);
  assert.equal(toolFeedback.filter(part => part.toolName === 'generate_image' && part.output.type === 'error-text').length, count, 'every unavailable call retains its SDK validation feedback');
  assert.ok(events.some(event => event.code === 'AI_STAGE_SCHEMA_INVALID' && event.outcome === 'result:unknown_tool'));
  assert.equal(events.some(event => event.type === 'image-start'), false);
});

for (const stage of ['submit_plan', 'submit_review']) for (const response of ['wrong-tool', 'prose']) test(`${stage} stops after an unavailable tool and a repeated ${response} response`, async () => {
  const initial = setup(), events = [];
  const wrong = () => call('generate_image', { path: 'images/wrong.png', prompt: 'An unavailable image request.' });
  const writer = [call('set_values', { values: { headline: 'Retained completed content' } }), done()];
  const second = response === 'wrong-tool' ? wrong() : done();
  const responses = stage === 'submit_plan' ? [wrong(), second, plan()] : [plan(), ...writer, wrong(), second, review()];
  const model = new MockLanguageModelV4({ doGenerate: responses });
  let images = 0;
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', generateImages: true, apiKey: 'mock-key', imageModel: 'test/image', languageModel: model, validateDraft,
    fetchImpl: async () => { images++; throw new Error('Unavailable stage tools must never execute.'); }, onProgress: event => events.push(event) }), error => {
    assert.equal(error.code, response === 'wrong-tool' ? 'AI_STAGE_SCHEMA_INVALID' : 'AI_STAGE_MISSING_RESULT');
    assert.match(error.message, stage === 'submit_review' ? /completed draft is retained/i : /project is unchanged/i);
    return true;
  });
  const submissions = model.doGenerateCalls.filter(request => request.tools.some(tool => tool.name === stage));
  assert.equal(submissions.length, 2); assert.equal(images, 0);
  assert.equal(events.some(event => event.type === 'phase' && event.phase === 'ready'), false);
});

for (const stage of ['submit_plan', 'submit_review']) for (const count of [1, 8]) test(`streamed ${stage} corrects ${count} unknown image calls with signed history and zero image requests`, async () => {
  const initial = setup(), requests = [], events = [], details = [{ type: 'reasoning.encrypted', data: 'opaque-unknown-tool-analysis', format: 'google-gemini-v1', index: 0 }];
  let stageAttempts = 0, writerCalls = 0, images = 0;
  const fetchImpl = async (url, init) => {
    if (!String(url).endsWith('/chat/completions')) { images++; throw new Error('Only chat submissions are allowed in this test.'); }
    const body = JSON.parse(init.body); requests.push(body);
    const names = body.tools.map(tool => tool.function.name), submitting = names.includes(stage);
    let response, wrong = false;
    if (submitting && stageAttempts++ === 0) {
      wrong = true; response = call('generate_image', { path: 'images/wrong-0.png', prompt: 'Requested writer image.' });
      for (let index = 1; index < count; index++) response.content.push(...call('generate_image', { path: `images/wrong-${index}.png`, prompt: 'Another writer image.' }).content);
    } else if (names.includes('submit_plan')) response = plan();
    else if (names.includes('submit_review')) response = review();
    else response = writerCalls++ ? call('validate_draft', {}) : call('set_values', { values: { headline: 'Completed streamed content' } });
    const payload = { id: 'gen-stage-unknown-tool-test', model: body.model, choices: [{ index: 0, delta: { role: 'assistant',
      tool_calls: response.content.map((part, index) => ({ index, id: part.toolCallId, type: 'function', function: { name: part.toolName, arguments: part.input } })), ...(wrong ? { reasoning_details: details } : {}) }, finish_reason: 'tool_calls' }] };
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', generateImages: true, apiKey: 'mock-key', imageModel: 'test/image', model: 'xiaomi/mimo-v2.6-flash', stream: true, fetchImpl, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Completed streamed content');
  assert.equal(images, 0); assert.equal(events.some(event => event.type === 'image-start'), false);
  const submissions = requests.filter(request => request.tools.some(tool => tool.function.name === stage));
  assert.equal(submissions.length, 2); assert.ok(submissions.every(request => request.tool_choice === 'auto'));
  const feedback = submissions[1].messages.filter(message => message.role === 'tool');
  assert.equal(feedback.length, count, 'all unavailable streamed tool calls receive feedback in the same correction request');
  assert.ok(submissions[1].messages.some(message => message.role === 'assistant' && JSON.stringify(message.reasoning_details) === JSON.stringify(details)));
  assert.equal(events.filter(event => event.type === 'tool-start' && event.tool === 'unavailable_tool').length, count);
  assert.equal(events.some(event => event.type === 'tool-start' && event.tool === 'generate_image'), false, 'untrusted stage tool names are not exposed in progress diagnostics');
});

test('unknown submission tool names never enter schema diagnostics or the final error', async () => {
  const initial = setup(), untrustedName = 'private_customer_record_DO_NOT_EXPORT', diagnostics = createAiDiagnostics({ mode: 'content' });
  const model = new MockLanguageModelV4({ doGenerate: [call(untrustedName, {}), call(untrustedName, {})] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Update the headline.', languageModel: model, validateDraft, onProgress: event => diagnostics.record(event) }), error => {
    assert.match(error.message, /result \(unknown_tool\)/); assert.equal(error.message.includes(untrustedName), false); return true;
  });
  const exported = JSON.stringify(diagnostics.snapshot());
  assert.equal(exported.includes(untrustedName), false); assert.match(exported, /result:unknown_tool/);
});

test('a shared deadline stops the workflow before another stage even when the provider ignores abort', async t => {
  const initial = setup(), started = Date.now();
  let clock = started;
  t.mock.method(Date, 'now', () => clock);
  const model = new MockLanguageModelV4({ doGenerate: async () => { clock = started + 21; return plan(); } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill content.', timeout: 20, languageModel: model, validateDraft }), /run time limit/);
  assert.equal(model.doGenerateCalls.length, 1, 'writer cannot get a fresh time budget after planning consumes the run');
});

test('Create review uses the generated schema and starts with fresh values rather than previous project fields', async () => {
  const initial = setup(), files = starterProject(true);
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_file', { path: 'index.tpl', content: files['index.tpl'] }), done(), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'create', prompt: 'Create a minimal page.', languageModel: model, validateDraft });
  assert.equal(result.values.title, 'Your next idea');
  assert.equal(result.values.headline, undefined, 'Create does not carry previous project fields into a new schema');
  const reviewer = model.doGenerateCalls.find(request => request.tools?.some(tool => tool.name === 'submit_review'));
  const user = reviewer.prompt.find(message => message.role === 'user').content[0].text;
  const draft = JSON.parse(user.split('Actual final draft:\n')[1]);
  assert.deepEqual(draft.fields.map(field => field.name), ['title']);
});

test('terminal image denial retains written content and stops after one independent review instead of futile revision passes', async () => {
  const initial = setup(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Completed text' } }), call('generate_image', { path: 'images/hero.png', prompt: 'Hero illustration', referenceIds: [] }), done(), review()] });
  let images = 0;
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Write a headline and generate hero art.', languageModel: model, validateDraft, generateImages: true, apiKey: 'mock', imageModel: 'test/image',
    fetchImpl: async () => { images++; return Response.json({ error: { code: 403, message: 'Image provider access denied' } }, { status: 403 }); }, onProgress: event => events.push(event) });
  assert.equal(result.valid, false);
  assert.equal(result.review.approved, false, 'provider failure cannot be reported as ready even if a reviewer overlooks it');
  assert.equal(result.values.headline, 'Completed text');
  assert.match(result.error, /Image provider access denied/);
  assert.equal(images, 1);
  assert.equal(events.filter(event => event.type === 'phase' && event.phase === 'revise').length, 0);
  assert.equal(result.files['images/hero.png'], undefined);
});

test('every provider request gets its own bounded pre-output retries (three at most)', async () => {
  const initial = setup(), events = [];
  const failure = () => Object.assign(new Error('Provider temporarily unavailable'), { statusCode: 503 });
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (model.doGenerateCalls.length === 2) return plan();
    throw failure();
  } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Fill content.', languageModel: model, validateDraft, onProgress: event => events.push(event) }), /temporarily unavailable/);
  assert.equal(model.doGenerateCalls.length, 6, 'the planner recovers after one retry; the writer request fails after three retries');
  assert.deepEqual(events.filter(event => event.type === 'provider-recovery').map(event => event.attempt), [1, 1, 2, 3]);
});

test('a transient error on the twelfth content call is retried without spending a content call', async () => {
  const initial = setup(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    const count = model.doGenerateCalls.length;
    if (count === 12) throw Object.assign(new Error('Provider temporarily unavailable'), { statusCode: 503 });
    return call('set_values', { values: { headline: `Updated headline ${count}` } });
  } });
  const result = await generateContentDraft({ ...initial, prompt: 'Fill content.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, false); assert.match(result.error, /step limit/);
  assert.equal(model.doGenerateCalls.length, 13, 'twelve answered content calls plus one unbilled retry');
  assert.equal(events.filter(event => event.type === 'provider-recovery').length, 1);
  assert.deepEqual(events.filter(event => event.type === 'step').map(event => event.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(result.values.headline, 'Updated headline 13');
});

test('a rate-limited planner request keeps the schema-correction attempt', async () => {
  const initial = setup(), events = [];
  const responses = [call('submit_plan', { summary: 'Missing tasks.', tasks: [] }), plan(), call('set_values', { values: { headline: 'Polski tytuł' } }), done(), review()];
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (model.doGenerateCalls.length === 1) throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
    return responses.shift();
  } });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Write Polish content.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Polski tytuł');
  assert.equal(events.filter(event => event.type === 'provider-recovery').length, 1);
  assert.ok(events.some(event => event.type === 'validation' && event.code === 'AI_STAGE_SCHEMA_INVALID'));
});

test('literal document language reaches content planning and review without exposing template source', async () => {
  const initial = setup();
  initial.files['index.tpl'] = initial.files['index.tpl'].replace('<html lang="en">', '<html lang="ru">');
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Polski tytuł' } }), done(), call('submit_review', { approved: false, summary: 'The literal document language is still Russian.', issues: ['Change the HTML document language to Polish.'], requiresSourceChanges: true })] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Make the whole page Polish.', languageModel: model, validateDraft });
  assert.equal(result.valid, false);
  assert.match(result.error, /need Edit project/);
  assert.equal(result.values.headline, 'Polski tytuł');
  for (const [tool, label] of [['submit_plan', 'Current project:\n'], ['submit_review', 'Actual final draft:\n']]) {
    const request = model.doGenerateCalls.find(input => input.tools?.some(entry => entry.name === tool));
    const text = request.prompt.find(message => message.role === 'user').content[0].text;
    const context = JSON.parse(text.split(label)[1]);
    assert.deepEqual(context.documentLanguages, [{ path: 'index.tpl', language: 'ru' }]);
    assert.equal(context.sources, undefined);
    assert.equal(text.includes('@template'), false);
    assert.match(JSON.stringify(request.prompt[0]), /literal HTML language attributes/);
  }
});

test('document language metadata distinguishes literal attributes from dynamic fields and data-lang hints', () => {
  const context = JSON.parse(aiProjectContext({ files: {
    'index.tpl': '@layout\n<HTML data-lang="ru" lang=\'pl-PL\'><body>PRIVATE SOURCE TEXT</body></HTML>\n@endlayout',
    'dynamic.tpl': '@layout\n<html lang="{{ pageLanguage }}"><body></body></html>\n@endlayout',
    'notes.md': '<html lang="ru">Unrelated documentation</html>',
  } }));
  assert.deepEqual(context.documentLanguages, [{ path: 'index.tpl', language: 'pl-pl' }]);
  assert.equal(JSON.stringify(context).includes('PRIVATE SOURCE TEXT'), false);
  assert.equal(JSON.stringify(context).includes('Unrelated documentation'), false);
});

test('restored clarifications reach planning before source-mode selection and preserve the full original brief', async () => {
  const initial = setup(), clarification = 'RESTORED_REQUIREMENT: translate the entire document to Polish, including its hardcoded language.';
  const tail = 'ORIGINAL-BRIEF-TAIL', prompt = 'ORIGINAL-BEGIN'.padEnd(6000 - tail.length, '.') + tail;
  const queue = [clarification], events = [];
  const model = new MockLanguageModelV4({ doGenerate: async options => {
    const request = options.prompt.filter(message => message.role === 'user').flatMap(message => message.content).map(part => part.text || '').join('');
    return call('submit_plan', { summary: 'The complete page translation needs source edits.', tasks: ['Translate the hardcoded document language'], requiresSourceChanges: request.includes(clarification) });
  } });
  await assert.rejects(runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt, languageModel: model, validateDraft,
    takeInstructions: () => queue.splice(0), onProgress: event => events.push(event) }), /needs Edit project/);
  assert.equal(model.doGenerateCalls.length, 1, 'the source requirement is caught before invoking a content writer');
  const request = JSON.stringify(model.doGenerateCalls[0].prompt);
  assert.ok(request.includes(prompt)); assert.equal(request.split(clarification).length - 1, 1);
  assert.equal(queue.length, 0); assert.equal(events.filter(event => event.type === 'instructions-received').length, 1);
  assert.deepEqual(initial.files, starterProject());
});

test('initial and later user clarifications reach the writer and reviewer once each', async () => {
  const initial = setup(), initialInstruction = 'INITIAL_RESTORED: change the headline using the retained draft.', laterInstruction = 'LATER_REQUEST: update the description while preserving existing assets.';
  const queue = [initialInstruction]; let laterQueued = false;
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Polski tytuł', description: 'Updated complete description' } }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, ...initial, mode: 'content', prompt: 'Continue the original page request.', languageModel: model, validateDraft,
    takeInstructions: () => queue.splice(0), onProgress(event) { if (event.type === 'phase' && event.phase === 'generate' && !laterQueued) { queue.push(laterInstruction); laterQueued = true; } } });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Polski tytuł'); assert.equal(result.values.description, 'Updated complete description');
  const requestText = call => JSON.stringify(call.prompt);
  assert.equal(requestText(model.doGenerateCalls[0]).split(initialInstruction).length - 1, 1);
  assert.equal(requestText(model.doGenerateCalls[0]).includes(laterInstruction), false);
  for (const request of [model.doGenerateCalls[1], model.doGenerateCalls.at(-1)]) {
    assert.equal(requestText(request).split(initialInstruction).length - 1, 1);
    assert.equal(requestText(request).split(laterInstruction).length - 1, 1);
  }
  assert.equal(queue.length, 0); assert.equal(model.doGenerateCalls.length, 4);
});

for (const choice of ['images-off', 'existing-path', 'missing-photo']) test(`retained source continuation ${choice} preserves the completed photo without replaying its image request`, async () => {
  const photo = Uint8Array.from(atob(png), c => c.charCodeAt(0)), original = starterProject(true);
  original['index.tpl'] = original['index.tpl'].replace('</body>', '<img src="images/doctor.png" alt="Completed doctor photo"></body>');
  original['images/doctor.png'] = photo;
  const responses = [plan()];
  if (choice !== 'images-off') responses.push(call('generate_image', { path: choice === 'existing-path' ? 'images/doctor.png' : 'images/second.png', prompt: 'The remaining requested second photo.', referenceIds: [] }));
  responses.push(call('set_values', { values: { title: 'Completed Polish copy' } }));
  if (choice === 'missing-photo') responses.push(call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<img src="images/second.png" alt="Second requested photo"></body>' }));
  responses.push(call('validate_draft', {}), review());
  const model = new MockLanguageModelV4({ doGenerate: responses }), imageRequests = [], events = [];
  const result = await runStudioAiWorkflow({ staged: true, mode: 'edit', files: original, values: { title: 'Retained title' },
    prompt: `Continue the retained page. Preserve the completed doctor photo and finish the copy.${choice === 'missing-photo' ? ' Also generate the originally requested second photo, which is still missing.' : ''}`,
    languageModel: model, validateDraft, generateImages: choice !== 'images-off', imageModel: 'fake/image', apiKey: 'fake-key', onProgress: event => events.push(event),
    fetchImpl: async (_url, options) => { imageRequests.push(JSON.parse(options.body)); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(result.valid, true); assert.equal(result.values.title, 'Completed Polish copy');
  assert.deepEqual(result.files['images/doctor.png'], photo); assert.deepEqual(original['images/doctor.png'], photo);
  assert.equal(imageRequests.length, choice === 'missing-photo' ? 1 : 0);
  if (choice === 'images-off') assert.equal(model.doGenerateCalls.some(request => request.tools.some(tool => tool.name === 'generate_image')), false);
  if (choice === 'existing-path') assert.ok(events.some(event => event.type === 'image-error' && /already exists/.test(event.error)), 'existing-path rejection happens before an image API request');
  if (choice === 'missing-photo') { assert.ok(result.files['images/second.png'] instanceof Uint8Array); assert.match(result.files['index.tpl'], /images\/second\.png/); }
});
