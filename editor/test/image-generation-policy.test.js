import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { parseProject, getDefaults } from '@trafficops/template-runtime';
import { runStudioAiWorkflow } from '@trafficops/template-editor-shell/studio-ai-workflow';
import { TEMPLATE_SYSTEM_PROMPT } from '@trafficops/template-editor-shell/openrouter-ai';
import { starterProject } from './support/starter.js';
import { validateDraft } from './support/ai-validator.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const call = (toolName, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] });
const done = () => ({ content: [{ type: 'text', text: 'Draft ready.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
const plan = (imageRequests = []) => call('submit_plan', { summary: 'Complete the requested page changes.', tasks: ['Make the requested changes'], imageRequests });
const review = () => call('submit_review', { approved: true, summary: 'Draft approved.', issues: [] });
const imageModel = 'google/gemini-3.1-flash-lite-image';
const photoMarkup = '<img src="images/product.png" alt="Product photo" />';

for (const mode of ['create', 'edit', 'content']) test(`${mode} generates all six images requested in the brief`, async () => {
  const paths = Array.from({ length: 6 }, (_, index) => `images/photo-${index + 1}.png`), requests = [];
  const files = starterProject(true);
  if (mode === 'content') {
    const fields = paths.map((_, index) => `  @param photo${index + 1} Image = "" label="Photo ${index + 1}"`).join('\n');
    const markup = paths.map((_, index) => `<img src="{{ photo${index + 1} }}" alt="Photo ${index + 1}" />`).join('\n');
    files['index.tpl'] = files['index.tpl'].replace('@endsection', `${fields}\n@endsection`).replace('</body>', `${markup}</body>`);
  }
  const { definition } = parseProject(files), values = getDefaults(definition);
  const markup = paths.map((path, index) => `<img src="${path}" alt="Photo ${index + 1}" />`).join('\n');
  const write = mode === 'content' ? call('set_values', { values: Object.fromEntries(paths.map((path, index) => [`photo${index + 1}`, path])) })
    : mode === 'create' ? call('set_file', { path: 'index.tpl', content: files['index.tpl'].replace('</body>', `${markup}</body>`) })
      : call('edit_file', { path: 'index.tpl', search: '</body>', replace: `${markup}</body>` });
  const model = new MockLanguageModelV4({ doGenerate: [plan(paths.map((_, index) => `Generate requested product photograph ${index + 1}`)),
    ...paths.map((path, index) => call('generate_image', { path, prompt: `Requested product photograph ${index + 1}` })), write, call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode, files, values, definition, prompt: 'Generate exactly six different product photographs and display all six on the page.', imageModel, apiKey: 'offline-key', languageModel: model, validateDraft,
    fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(result.valid, true); assert.equal(result.plan.imageRequests.length, 6); assert.equal(requests.length, 6);
  assert(requests.every(request => request.model === imageModel));
  for (const [index, path] of paths.entries()) {
    assert(result.files[path] instanceof Uint8Array);
    if (mode === 'content') assert.equal(result.values[`photo${index + 1}`], path);
    else assert(result.files['index.tpl'].includes(path));
    assert.equal(files[path], undefined, 'generated assets remain in the draft');
  }
  if (mode === 'content') assert.equal(result.files['index.tpl'], files['index.tpl']);
});

test('a revision finishes a six-image brief without regenerating completed images', async () => {
  const files = starterProject(true), events = [], requests = [];
  const paths = Array.from({ length: 6 }, (_, index) => `images/revision-${index + 1}.png`);
  const markup = selected => selected.map((path, index) => `<img src="${path}" alt="Requested photo ${index + 1}" />`).join('\n');
  const generate = selected => selected.map(path => call('generate_image', { path, prompt: `Requested photograph for ${path}` }));
  const model = new MockLanguageModelV4({ doGenerate: [plan(paths.map(path => `Generate the requested photograph ${path}`)),
    ...generate(paths.slice(0, 3)), call('edit_file', { path: 'index.tpl', search: '</body>', replace: `${markup(paths.slice(0, 3))}</body>` }), call('validate_draft', {}), review(),
    ...generate(paths.slice(3)), call('edit_file', { path: 'index.tpl', search: '</body>', replace: `${markup(paths.slice(3))}</body>` }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'edit', files, prompt: 'Generate exactly six photographs and display all six on the page.', imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, onProgress: event => events.push(event),
    fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(result.valid, true); assert.equal(requests.length, 6);
  const reviews = events.filter(event => event.type === 'review').map(event => event.review);
  assert.equal(reviews.length, 2); assert.equal(reviews[0].approved, false); assert.match(reviews[0].issues.join(' '), /Only 3\/6 requested generated raster images/);
  assert.equal(reviews[1].approved, true);
  for (const path of paths) {
    assert(result.files[path] instanceof Uint8Array); assert(result.files['index.tpl'].includes(path));
    assert.equal(events.filter(event => event.type === 'image-start' && event.path === path).length, 1);
  }
});

for (const [mode, prompt] of [
  ['create', 'Create a simple page titled Updated title. Do not include or generate any images.'],
  ['edit', 'Change the page title to Updated title.'],
  ['content', 'Change the page title to Updated title without generating images.'],
]) test(`${mode} honors a ${mode === 'edit' ? 'text-only' : 'no-images'} brief with an image model configured`, async () => {
  const files = starterProject(true), { definition } = parseProject(files), values = getDefaults(definition);
  const writes = mode === 'create' ? [call('set_file', { path: 'index.tpl', content: files['index.tpl'].replace('Your next idea', 'Updated title') })]
    : [call('set_values', { values: { title: 'Updated title' } })];
  const model = new MockLanguageModelV4({ doGenerate: [plan(), ...writes, call('validate_draft', {}), review()] });
  let imageRequests = 0;
  const result = await runStudioAiWorkflow({ staged: true, mode, files, values, definition, prompt, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft,
    fetchImpl: async () => { imageRequests++; throw new Error('This brief must not generate images'); } });
  assert.equal(result.valid, true); assert.deepEqual(result.plan.imageRequests, []); assert.equal(imageRequests, 0);
  assert.equal(Object.values(result.files).some(content => content instanceof Uint8Array), false);
  assert(model.doGenerateCalls.some(input => input.tools.some(tool => tool.name === 'generate_image')), 'an available image model does not require an image request');
  if (mode === 'create') assert(result.files['index.tpl'].includes('Updated title'));
  else assert.equal(result.values.title, 'Updated title');
});

test('the shared source prompt no longer instructs image-enabled writers to prefer SVG placeholders', () => {
  assert(!TEMPLATE_SYSTEM_PROMPT.includes('use simple SVG placeholders for missing art'));
});

for (const mode of ['edit', 'create']) for (const imageChoice of [undefined, true]) test(`${mode} (${imageChoice === undefined ? 'configured default' : 'explicit choice'}) sends requested raster art to the exact selected image model and references real PNG bytes`, async () => {
  const files = starterProject(true), requests = [], events = [];
  const content = files['index.tpl'].replace('</body>', `${photoMarkup}</body>`);
  const write = mode === 'create' ? call('set_file', { path: 'index.tpl', content }) : call('edit_file', { path: 'index.tpl', search: '</body>', replace: `${photoMarkup}</body>` });
  const model = new MockLanguageModelV4({ doGenerate: [plan(['Generate a new product photograph']), call('generate_image', { path: 'images/product.png', prompt: 'A realistic product photograph', referenceIds: ['reference-1'] }), write, call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode, files, values: { title: 'Saved title' }, prompt: 'Generate a product photo and put it on the page.', generateImages: imageChoice, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft,
    attachments: [{ id: 'reference-1', name: 'Reference', mime: 'image/png', dataUrl: `data:image/png;base64,${png}`, useOnPage: false }], onProgress: event => events.push(event),
    fetchImpl: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(result.valid, true); assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/images');
  assert.equal(requests[0].body.model, imageModel); assert.equal(requests[0].body.output_format, 'png'); assert.equal(requests[0].body.input_references[0].image_url.url, `data:image/png;base64,${png}`);
  assert(result.files['images/product.png'] instanceof Uint8Array); assert.equal(result.files['images/product.svg'], undefined); assert(result.files['index.tpl'].includes(photoMarkup));
  if (mode === 'edit') assert.equal(result.values.title, 'Saved title');
  assert(events.some(event => event.type === 'image-start' && event.path === 'images/product.png'));
  const source = model.doGenerateCalls.find(input => input.tools.some(tool => tool.name === 'generate_image'));
  assert(JSON.stringify(source.prompt).includes('Do not substitute SVG drawings'));
  const reviewed = model.doGenerateCalls.find(input => input.tools.some(tool => tool.name === 'submit_review'));
  assert(JSON.stringify(reviewed.prompt).includes('images/product.png')); assert(JSON.stringify(reviewed.prompt).includes(imageModel));
});

test('a text SVG substitution cannot receive ready approval, and the bounded revision uses the selected image provider', async () => {
  const files = starterProject(true), events = []; let imageRequests = 0;
  const first = files['index.tpl'].replace('</body>', '<img src="images/product.svg" alt="Product photo" /></body>');
  const model = new MockLanguageModelV4({ doGenerate: [plan(['Generate a realistic product photograph']), call('set_file', { path: 'images/product.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>' }), call('set_file', { path: 'index.tpl', content: first }), call('validate_draft', {}), review(), call('generate_image', { path: 'images/product.png', prompt: 'Requested realistic product photo', referenceIds: [] }), call('edit_file', { path: 'index.tpl', search: 'images/product.svg', replace: 'images/product.png' }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'create', prompt: 'Generate a realistic product photograph for the page.', generateImages: true, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, onProgress: event => events.push(event), fetchImpl: async (_url, init) => { imageRequests++; assert.equal(JSON.parse(init.body).model, imageModel); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  const reviews = events.filter(event => event.type === 'review').map(event => event.review);
  assert.equal(reviews.length, 2); assert.equal(reviews[0].approved, false); assert.match(reviews[0].issues.join(' '), /Only 0\/1 requested generated raster images/);
  assert.equal(imageRequests, 1); assert.equal(result.valid, true); assert(result.files['images/product.png'] instanceof Uint8Array); assert(result.files['index.tpl'].includes('images/product.png')); assert(!result.files['index.tpl'].includes('images/product.svg'));
});

test('an unreferenced generated PNG cannot make an SVG stand-in complete the requested photo', async () => {
  const files = starterProject(true), events = []; let images = 0;
  const model = new MockLanguageModelV4({ doGenerate: [plan(['Generate and display a product photo']), call('generate_image', { path: 'images/product.png', prompt: 'Product photo', referenceIds: [] }), call('set_file', { path: 'index.tpl', content: files['index.tpl'] }), call('validate_draft', {}), review(), call('set_file', { path: 'notes.md', content: 'First revision still lacks the requested photograph.' }), call('validate_draft', {}), review(), call('set_file', { path: 'notes.md', content: 'Second revision still lacks the requested photograph.' }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'create', prompt: 'Generate and display a product photo.', generateImages: true, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, onProgress: event => events.push(event), fetchImpl: async () => { images++; return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(images, 1); assert.equal(result.valid, false); assert(result.files['images/product.png'] instanceof Uint8Array);
  assert.equal(events.filter(event => event.type === 'review').length, 3); assert.match(result.error, /requested generated raster images/);
});

test('explicit SVG icon and vector-logo requests remain valid with an image model configured and generate no paid raster images', async () => {
  const files = starterProject(true);
  const content = files['index.tpl'].replace('</body>', '<svg aria-label="Arrow icon" viewBox="0 0 20 20"><path d="M2 10h14l-4-4m4 4-4 4"/></svg><img src="images/logo.svg" alt="Vector logo" /></body>');
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('set_file', { path: 'index.tpl', content }), call('set_file', { path: 'images/logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>' }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'create', prompt: 'Create an SVG arrow icon and a simple vector logo. Do not generate photos.', generateImages: true, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, fetchImpl: async () => { throw new Error('No raster image requested'); } });
  assert.equal(result.valid, true); assert(result.files['index.tpl'].includes('<svg')); assert.equal(typeof result.files['images/logo.svg'], 'string');
});

test('explicit image-generation opt-out overrides the configured model and never exposes a paid image tool', async () => {
  const files = starterProject(true);
  const model = new MockLanguageModelV4({ doGenerate: [plan(), call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<p>Clearly labeled photo placeholder</p></body>' }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'edit', files, values: { title: 'Saved title' }, prompt: 'Add a labeled image placeholder without generating an image.', generateImages: false, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, fetchImpl: async () => { throw new Error('Explicit opt-out must not call an image provider'); } });
  assert.equal(result.valid, true); assert.equal(result.values.title, 'Saved title'); assert(model.doGenerateCalls.every(input => !input.tools.some(tool => tool.name === 'generate_image')));
});

test('a failed image provider never becomes a successful SVG placeholder or triggers another paid image request', async () => {
  const files = starterProject(true), events = []; let images = 0;
  const model = new MockLanguageModelV4({ doGenerate: [plan(['Generate a product photograph']), call('generate_image', { path: 'images/product.png', prompt: 'Product photo', referenceIds: [] }), call('set_file', { path: 'index.tpl', content: files['index.tpl'] }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'create', prompt: 'Generate a product photograph.', generateImages: true, imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, onProgress: event => events.push(event), fetchImpl: async () => { images++; return Response.json({ error: { code: 402, message: 'Insufficient image credits' } }, { status: 402 }); } });
  assert.equal(images, 1); assert.equal(result.valid, false); assert.equal(result.files['images/product.png'], undefined); assert.match(result.error, /Insufficient image credits/); assert(!events.some(event => event.type === 'phase' && event.phase === 'ready'));
});

for (const mode of ['edit', 'create']) test(`${mode} cannot bypass image generation by omitting the image plan`, async () => {
  const files = starterProject(true), events = [];
  const omitted = () => call('submit_plan', { summary: 'Draw the requested photo as an SVG.', tasks: ['Write a vector stand-in'] });
  const model = new MockLanguageModelV4({ doGenerate: [omitted(), omitted()] });
  await assert.rejects(runStudioAiWorkflow({ staged: true, mode, files, prompt: 'Generate a realistic product photograph.', imageModel, apiKey: 'offline-key', languageModel: model, validateDraft, onProgress: event => events.push(event), fetchImpl: async () => { throw new Error('The invalid plan must not start paid image work'); } }), error => {
    assert.equal(error.code, 'AI_STAGE_SCHEMA_INVALID');
    assert.match(error.message, /imageRequests/);
    return true;
  });
  assert.equal(model.doGenerateCalls.length, 2, 'only one read-only correction is allowed');
  assert(model.doGenerateCalls.every(input => input.tools.length === 1 && input.tools[0].name === 'submit_plan'));
  assert(!events.some(event => event.type === 'phase' && event.phase === 'generate'));
});

test('one schema correction restores the missing image plan and then uses the configured raster model', async () => {
  const files = starterProject(true), requests = [];
  const omitted = call('submit_plan', { summary: 'Create the page.', tasks: ['Write the page with a product photo'] });
  const model = new MockLanguageModelV4({ doGenerate: [omitted, plan(['Generate a product photograph']), call('generate_image', { path: 'images/product.png', prompt: 'A realistic product photograph' }), call('set_file', { path: 'index.tpl', content: files['index.tpl'].replace('</body>', `${photoMarkup}</body>`) }), call('validate_draft', {}), review()] });
  const result = await runStudioAiWorkflow({ staged: true, mode: 'create', prompt: 'Generate a product photo and put it on the page.', imageModel, apiKey: 'offline-key', languageModel: model, validateDraft,
    fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); } });
  assert.equal(result.valid, true); assert.equal(requests.length, 1); assert.equal(requests[0].model, imageModel);
  assert(result.files['images/product.png'] instanceof Uint8Array); assert(result.files['index.tpl'].includes(photoMarkup));
  assert(JSON.stringify(model.doGenerateCalls[1].prompt).includes('imageRequests'));
});
