import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { fileAiSupport, runFileAiWorkflow, FILE_AI_MAX_SOURCE_BYTES } from '../src/file-ai-workflow.js';
import { fileAiImageDataUrl, normalizeFileAiImage } from '../src/file-ai-image.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const pngBytes = () => Uint8Array.from(atob(png), character => character.charCodeAt(0));
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const call = (name, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: name, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] });
const done = text => ({ content: [{ type: 'text', text: text || 'Done.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
const review = (issues = []) => call('submit_file_review', { approved: !issues.length, summary: issues.length ? 'Repair the requested change.' : 'The edited file matches the request.', issues });
const plan = () => call('submit_image_prompt', { prompt: 'Preserve the selected original composition and make its background blue.', summary: 'Change only the background.' });
const validateDraft = async ({ files, values }) => ({ files, values });
const setup = () => ({ path: 'styles.css', files: { 'index.tpl': 'Unrelated template', 'styles.css': 'body { color: red; }', 'images/photo.png': pngBytes(), 'notes.txt': 'Unrelated notes' }, values: { heading: 'Original heading', obsolete: 'Keep raw saved values' }, prompt: 'Change the text color to blue.', validateDraft });
const modelWith = responses => new MockLanguageModelV4({ doGenerate: responses });

test('single-file support includes all stored UTF-8 text and bounds full source context', () => {
  for (const path of ['index.tpl', 'style.css', 'app.js', 'data.json', 'drawing.svg', 'article.md', 'config.conf']) assert.deepEqual(fileAiSupport(path, 'text'), { supported: true, kind: 'text' });
  assert.deepEqual(fileAiSupport('images/photo.png', pngBytes()), { supported: true, kind: 'image' });
  assert.equal(fileAiSupport('large.css', 'x'.repeat(FILE_AI_MAX_SOURCE_BYTES + 1)).supported, false);
  assert.match(fileAiSupport('large.css', 'x'.repeat(FILE_AI_MAX_SOURCE_BYTES + 1)).reason, /64 KiB/);
  for (const path of ['image.gif', 'image.avif', 'document.pdf']) assert.equal(fileAiSupport(path, pngBytes()).supported, false);
});

test('a validated text edit preserves every other file and raw saved values, then independently reviews it', async () => {
  const initial = setup(), original = structuredClone(initial.files), events = [];
  const model = modelWith([call('set_file', { path: initial.path, content: 'body { color: blue; }' }), call('validate_draft', {}), review()]);
  const result = await runFileAiWorkflow({ ...initial, languageModel: model, validateDraft: async options => ({ ...await validateDraft(options), values: { heading: 'Normalized heading' } }), onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.path, initial.path); assert.equal(result.files[initial.path], 'body { color: blue; }');
  for (const path of Object.keys(original).filter(path => path !== initial.path)) assert.deepEqual(result.files[path], original[path]);
  assert.deepEqual(initial.files, original); assert.deepEqual(result.values, initial.values);
  assert.deepEqual(events.filter(event => event.type === 'phase').map(event => event.phase), ['generate', 'review', 'ready']);
  const reviewed = model.doGenerateCalls.at(-1);
  assert.ok(JSON.stringify(reviewed.prompt).includes('body { color: blue; }'));
  assert.ok(!JSON.stringify(reviewed.prompt).includes('Unrelated notes'), 'unrelated file content is not sent to the model');
});

test('the writer cannot target another path or add a file even when requested by its tool payload', async () => {
  const initial = setup();
  const model = modelWith([call('set_file', { path: 'new.css', content: 'Bad' }), call('edit_file', { path: 'notes.txt', search: 'Unrelated', replace: 'Bad' }), call('edit_file', { path: initial.path, search: 'red', replace: 'blue' }), call('validate_draft', {}), review()]);
  const result = await runFileAiWorkflow({ ...initial, languageModel: model });
  assert.deepEqual(Object.keys(result.files), Object.keys(initial.files));
  assert.equal(result.files['notes.txt'], 'Unrelated notes'); assert.equal(result.files[initial.path], 'body { color: blue; }');
});

test('exact replacements reject ambiguous occurrences and preserve surrounding text', async () => {
  const initial = { ...setup(), path: 'notes.txt', prompt: 'Change the final line.', files: { 'notes.txt': 'Repeat\nRepeat\nLast line' } };
  const model = modelWith([call('edit_file', { path: initial.path, search: 'Repeat', replace: 'Changed' }), call('edit_file', { path: initial.path, search: 'Last line', replace: 'Final line' }), call('validate_draft', {}), review()]);
  const result = await runFileAiWorkflow({ ...initial, languageModel: model });
  assert.equal(result.files[initial.path], 'Repeat\nRepeat\nFinal line');
});

test('review findings cause a scoped repair and a new independent review', async () => {
  const initial = setup(), events = [];
  const model = modelWith([call('set_file', { path: initial.path, content: 'body { color: green; }' }), call('validate_draft', {}), review(['The requested color was blue, not green.']), call('edit_file', { path: initial.path, search: 'green', replace: 'blue' }), call('validate_draft', {}), review()]);
  const result = await runFileAiWorkflow({ ...initial, languageModel: model, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(result.files[initial.path], 'body { color: blue; }');
  assert.equal(events.filter(event => event.type === 'review').length, 2);
  assert.deepEqual(events.filter(event => event.type === 'phase').map(event => event.phase), ['generate', 'review', 'revise', 'review', 'ready']);
});

test('three rejected reviews retain a draft while never marking it ready', async () => {
  const initial = setup(), responses = [], events = [];
  for (const color of ['green', 'pink', 'purple']) responses.push(call('set_file', { path: initial.path, content: `body { color: ${color}; }` }), call('validate_draft', {}), review(['The requested blue color is missing.']));
  const result = await runFileAiWorkflow({ ...initial, languageModel: modelWith(responses), onProgress: event => events.push(event) });
  assert.equal(result.valid, false); assert.equal(result.review.approved, false); assert.match(result.error, /reviewer/);
  assert.equal(events.some(event => event.phase === 'ready'), false); assert.equal(initial.files[initial.path], 'body { color: red; }');
});

test('prose without edits and invalid independent reviews cannot approve the file', async () => {
  const initial = setup();
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: modelWith([done('I changed it.')]) }), /no changes/);
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: modelWith([call('set_file', { path: initial.path, content: 'body { color: blue; }' }), call('validate_draft', {}), done('Looks fine'), done('Approved')]) }), /valid file review/);
});

test('host validation cannot silently add files or change unrelated source or binary bytes', async () => {
  for (const mutation of [files => { files['other.txt'] = 'Unexpected'; }, files => { files['notes.txt'] = 'Unexpected'; }, files => { files['images/photo.png'][0] = 0; }]) {
    const initial = setup(), original = structuredClone(initial.files);
    const model = modelWith([call('set_file', { path: initial.path, content: 'body { color: blue; }' }), call('validate_draft', {}), done()]);
    await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, validateDraft: async ({ files, values }) => { mutation(files); return { files, values }; } }), /validation attempted to change another file/);
    assert.deepEqual(initial.files, original);
  }
});

test('cancellation during the reviewer preserves original files and emits no ready state', async () => {
  const initial = setup(), original = structuredClone(initial.files), controller = new AbortController(), events = [];
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    if (input.tools?.some(tool => tool.name === 'submit_file_review')) { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); }
    return model.doGenerateCalls.length === 1 ? call('set_file', { path: initial.path, content: 'body { color: blue; }' }) : call('validate_draft', {});
  } });
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, signal: controller.signal, onProgress: event => events.push(event) }), /cancelled/);
  assert.deepEqual(initial.files, original); assert.equal(events.some(event => event.phase === 'ready'), false);
});

test('pre-aborted, invalid prompt, oversized context and missing target reject before provider calls', async () => {
  const initial = setup(), controller = new AbortController(); controller.abort();
  const model = modelWith([]);
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, signal: controller.signal }), /cancelled/);
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, prompt: ' ' }), /1–6,000/);
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, path: 'missing.txt' }), /no longer exists/);
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, files: { [initial.path]: 'x'.repeat(FILE_AI_MAX_SOURCE_BYTES + 1) } }), /64 KiB/);
  assert.equal(model.doGenerateCalls.length, 0);
});

test('image editing uses the selected image first, sends attached references, and reviews actual original and edited pixels', async () => {
  const initial = { ...setup(), path: 'images/photo.png', prompt: 'Make its background blue.' }, requests = [], events = [];
  const attached = { id: 'style-guide', name: 'style.png', mime: 'image/png', dataUrl: `data:image/png;base64,${png}` };
  const document = { id: 'brief', name: 'brief.txt', mime: 'text/plain', text: 'Preserve the person and change only the background.' };
  const model = modelWith([plan(), review()]);
  const result = await runFileAiWorkflow({ ...initial, languageModel: model, attachments: [attached, document], apiKey: 'test-key', model: 'test/text', imageModel: 'test/image', fetchImpl: async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] });
  }, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/images');
  assert.equal(requests[0].body.model, 'test/image'); assert.equal(requests[0].body.output_format, 'png');
  assert.deepEqual(requests[0].body.input_references.map(item => item.image_url.url), [fileAiImageDataUrl(initial.files[initial.path], initial.path), attached.dataUrl]);
  assert.match(requests[0].body.prompt, /Edit the FIRST input reference/);
  for (const path of Object.keys(initial.files).filter(path => path !== initial.path)) assert.deepEqual(result.files[path], initial.files[path]);
  assert.ok(JSON.stringify(model.doGenerateCalls[0].prompt).includes(document.text), 'document instructions reach the image planner');
  const imageParts = model.doGenerateCalls[1].prompt.flatMap(message => message.content || []).filter(part => part.type === 'file' && part.mediaType === 'image/png');
  assert.equal(imageParts.length, 3, 'the independent reviewer receives original, edited, and reference images');
  assert.deepEqual(imageParts.map(part => part.filename), [undefined, undefined, 'style.png'], 'original and edited images precede attached references');
  const planParts = model.doGenerateCalls[0].prompt.flatMap(message => message.content || []).filter(part => part.type === 'file' && part.mediaType === 'image/png');
  assert.deepEqual(planParts.map(part => part.filename), [undefined, 'style.png'], 'the selected original is the first image in planning');
  assert.equal(events.filter(event => event.type === 'image-start').length, 1);
});

test('malformed image output and mismatched original image extensions reject without affecting the project', async () => {
  const initial = { ...setup(), path: 'images/photo.png', prompt: 'Edit the image.' };
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: modelWith([plan()]), apiKey: 'test', imageModel: 'test/image', fetchImpl: async () => Response.json({ data: [{ b64_json: btoa('not pixels'), media_type: 'image/png' }] }) }), /contents do not match/);
  assert.throws(() => fileAiImageDataUrl(pngBytes(), 'image.jpg'), /do not match/);
  const file = new File([pngBytes()], 'edited.png', { type: 'image/png' });
  await assert.rejects(normalizeFileAiImage(file, 'image.jpg'), /original JPEG or WebP format is unavailable/);
});

test('paid image provider failures are not retried and provider credentials are redacted', async () => {
  const initial = { ...setup(), path: 'images/photo.png', prompt: 'Edit the image.' }, key = 'private-key-for-test'; let requests = 0;
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: modelWith([plan()]), apiKey: key, imageModel: 'test/image', fetchImpl: async () => {
    requests++; return Response.json({ error: { message: `Image service unavailable ${key}`, code: 503 } }, { status: 503 });
  } }), error => !error.message.includes(key) && error.message.includes('[redacted]'));
  assert.equal(requests, 1);
});

test('cancellation returns promptly when an image provider ignores the abort signal, and a late response cannot become ready', async () => {
  const initial = { ...setup(), path: 'images/photo.png', prompt: 'Edit the image.' }, original = structuredClone(initial.files), events = [], controller = new AbortController();
  let startedResolve, responseResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const operation = runFileAiWorkflow({ ...initial, languageModel: modelWith([plan()]), apiKey: 'test', imageModel: 'test/image', signal: controller.signal, onProgress: event => events.push(event), fetchImpl: () => {
    startedResolve(); return new Promise(resolve => { responseResolve = resolve; });
  } });
  await started; controller.abort();
  await assert.rejects(operation, /cancelled/);
  responseResolve(Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(initial.files, original); assert.equal(events.some(event => event.phase === 'ready' || event.type === 'file-set'), false);
});

test('the workflow run timeout interrupts an unresponsive host validation and leaves the project unchanged', async () => {
  const initial = setup(), original = structuredClone(initial.files), events = [];
  const model = modelWith([call('set_file', { path: initial.path, content: 'body { color: blue; }' }), call('validate_draft', {})]);
  await assert.rejects(runFileAiWorkflow({ ...initial, languageModel: model, timeout: 30, validateDraft: () => new Promise(() => {}), onProgress: event => events.push(event) }), /run time limit/);
  assert.deepEqual(initial.files, original); assert.equal(events.some(event => event.phase === 'ready'), false);
});
