import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { parseProject, getDefaults } from '@trafficops/template-runtime';
import { runStudioAiWorkflow } from '@trafficops/template-editor-shell/studio-ai-workflow';
import { attachmentAssets, attachmentMessage, readImageAttachments, validateAttachments } from '@trafficops/template-editor-shell/ai-attachments';
import { validateDraft } from './support/ai-validator.js';
import { starterProject } from '../src/starter.js';
import { createStudioProject, cloneStudioProject } from '../src/studio-library.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const call = (name, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: name, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] });
const done = () => ({ content: [{ type: 'text', text: 'Draft ready.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
const plan = () => call('submit_plan', { summary: 'Write and check the requested content.', tasks: ['Write the requested copy', 'Review it against the brief'] });
const review = (issues = []) => call('submit_review', { approved: !issues.length, summary: issues.length ? 'Needs a longer article.' : 'The draft matches the brief.', issues });
const setup = () => { const files = starterProject(); const { definition } = parseProject(files); return { files, definition, values: getDefaults(definition) }; };
const attachment = (useOnPage = false) => ({ id: 'photo-1', name: 'portrait.png', mime: 'image/png', dataUrl: `data:image/png;base64,${png}`, useOnPage });

test('Fill Content writes fields in separate calls, independently reviews, repairs and reviews again', async () => {
  const initial = setup(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Polski tytuł' } }), call('set_values', { values: { description: 'A complete first article.' } }), done(), review(['Expand the article to match the requested length.']), call('set_values', { values: { description: 'A revised complete article with all requested details.' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Write Polish content.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.review.approved, true);
  assert.equal(result.values.headline, 'Polski tytuł');
  assert.equal(result.values.description, 'A revised complete article with all requested details.');
  assert.deepEqual(result.files, initial.files); assert.notEqual(initial.values.headline, result.values.headline);
  assert.deepEqual(events.filter(event => event.type === 'phase').map(event => event.phase), ['plan', 'generate', 'review', 'revise', 'review', 'ready']);
  const reviews = model.doGenerateCalls.filter(input => input.toolChoice?.toolName === 'submit_review');
  assert.equal(reviews.length, 2);
  assert.ok(JSON.stringify(reviews[1].prompt).includes(result.values.description), 'review sees the actual revised content');
});

for (const mode of ['edit', 'create']) test(`${mode} source generation has planning, independent reviewer, revision and a second review`, async () => {
  const files = starterProject(true), events = [];
  const write = mode === 'create' ? call('set_file', { path: 'index.tpl', content: files['index.tpl'] }) : call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<footer>First draft</footer></body>' });
  const model = new MockLanguageModelV4({ doGenerate: [plan(), write, done(), review(['Add the requested FAQ.']), call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<section id="faq">Requested FAQ</section></body>' }), done(), review()] });
  const result = await runStudioAiWorkflow({ mode, files, values: { title: 'Original' }, prompt: 'Add a FAQ.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.match(result.files['index.tpl'], /Requested FAQ/);
  assert.equal(files['index.tpl'].includes('Requested FAQ'), false);
  assert.equal(events.filter(event => event.type === 'review').length, 2);
});

test('content image generation uses selected references, keeps binary assets in draft and preserves source', async () => {
  const initial = setup(), refs = [attachment(true)], images = [];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('generate_image', { path: 'images/article.png', prompt: 'An editorial illustration', referenceIds: ['photo-1'] }), call('set_values', { values: { image: 'images/article.png', headline: 'New headline' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Fill content and generate an article image.', attachments: refs, generateImages: true, apiKey: 'mock-secret', imageModel: 'test/image', languageModel: model, validateDraft,
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
  const result = await runStudioAiWorkflow({ mode: 'create', prompt: 'Create a page with hero art.', attachments: refs, generateImages: true, apiKey: 'mock', imageModel: 'test/image', languageModel: model, validateDraft, fetchImpl: async () => Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }) });
  assert.ok(result.files['images/hero.png'] instanceof Uint8Array); assert.ok(result.files['images/reference-photo-1.png'] instanceof Uint8Array);
});

test('failed review never marks a draft ready, and content repair cannot change source files', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'First' } }), done(), review(['Missing requested facts']), call('set_values', { values: { headline: 'Second' } }), done(), review(['Still missing']), call('set_values', { values: { headline: 'Third' } }), done(), review(['Still missing'])] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Fill the page', languageModel: model, validateDraft });
  assert.equal(result.valid, false); assert.match(result.error, /reviewer/); assert.equal(result.review.approved, false); assert.deepEqual(result.files, initial.files);
});

test('content rejects invalid fields, accepts a corrected tool call, and has no JSON-only empty response path', async () => {
  const initial = setup();
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { showNote: 'wrong type', extra: 'bad' } }), call('set_values', { values: { headline: 'Valid content', showNote: true } }), done(), review()] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Fill content', languageModel: model, validateDraft });
  assert.equal(result.values.showNote, true); assert.equal(result.values.extra, undefined);
  assert.ok(model.doGenerateCalls.filter(call => call.tools?.some(tool => tool.name === 'set_values')).length > 0);
});

test('Fill Content preserves an existing remote image while updating other fields', async () => {
  const initial = setup(); initial.values.image = 'https://example.com/existing-photo.jpg?version=1';
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_values', { values: { headline: 'Updated headline' } }), done(), review()] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Update the headline and preserve the image.', languageModel: model, validateDraft });
  assert.equal(result.valid, true); assert.equal(result.values.image, initial.values.image); assert.equal(result.values.headline, 'Updated headline');
});

test('cancelling before reviewer completes rejects without altering project content', async () => {
  const initial = setup(), controller = new AbortController();
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    if (input.toolChoice?.toolName === 'submit_plan') return plan();
    if (input.toolChoice?.toolName === 'submit_review') { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); }
    return model.doGenerateCalls.length === 2 ? call('set_values', { values: { headline: 'Draft only' } }) : done();
  } });
  await assert.rejects(runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Fill', languageModel: model, validateDraft, signal: controller.signal }));
  assert.notEqual(initial.values.headline, 'Draft only');
});

test('a streamed planner provider failure rejects once, redacts the key and preserves the original', async () => {
  const initial = setup(), original = structuredClone(initial);
  let requests = 0;
  await assert.rejects(runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Fill', stream: true, apiKey: 'mock-secret', model: 'test/model', validateDraft,
    fetchImpl: async () => { requests++; throw new Error('Provider unavailable: mock-secret'); } }), /Provider unavailable: \[redacted\]/);
  assert.equal(requests, 1, 'a provider failure must not repeat paid requests');
  assert.deepEqual(initial, original);
});

test('attachment validation bounds input, excludes reference-only images from assets and preserves creation handoff', async () => {
  const refs = await readImageAttachments([new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'photo.png', { type: 'image/png' })]);
  assert.equal(refs.length, 1); assert.deepEqual(attachmentAssets(refs), {});
  assert.ok(Array.isArray(attachmentMessage('Brief', refs)));
  assert.throws(() => validateAttachments(Array.from({ length: 5 }, () => attachment())), /up to 4/);
  assert.throws(() => validateAttachments([{ ...attachment(), mime: 'image/svg+xml' }]), /PNG/);
  const project = createStudioProject({ kind: 'landing', name: 'AI refs', files: starterProject(true), aiPrompt: 'Use photos', aiAttachments: refs, aiGenerateImages: true });
  assert.deepEqual(project.aiAttachments, refs);
  assert.equal(cloneStudioProject(project).aiAttachments, undefined);
});
