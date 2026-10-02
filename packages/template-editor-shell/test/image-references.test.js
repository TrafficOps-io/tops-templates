import test from 'node:test';
import assert from 'node:assert/strict';
import { earlierImageAttachments, imageReferenceCatalog, IMAGE_REFERENCE_LIMIT } from '../src/image-references.js';
import { draftImageTool } from '../src/ai-image-tool.js';
import { attachmentMessage } from '../src/ai-attachments.js';
import { stepCard } from '../src/agent-steps.js';
import { runToState } from '../src/chat-cards.js';
import { localizeAiErrorText, normalizeAiProviderError, referenceSupportError } from '../src/ai-provider-errors.js';
import { generateImageWithOpenRouter } from '../src/openrouter-images.js';
import { sanitizeAiToolValidationEvent } from '../src/ai-tool-validation.js';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const png = Uint8Array.from(atob(pngBase64), character => character.charCodeAt(0));
const dataUrl = `data:image/png;base64,${pngBase64}`;
const image = (id, name = `${id}.png`, extra = {}) => ({ id, name, mime: 'image/png', dataUrl, useOnPage: false, ...extra });

test('earlier image attachments come from user messages, most recent first, deduplicated and image-only', () => {
  const history = [
    { role: 'user', attachments: [image('a', 'first.png'), { id: 'doc', name: 'brief.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }] },
    { role: 'assistant', text: 'Done', attachments: [image('x')] },
    { role: 'user', attachments: [image('b', 'second.png'), image('a', 'first.png')] },
    { role: 'user', prompt: 'clarification', attachments: [] },
  ];
  assert.deepEqual(earlierImageAttachments(history).map(item => item.id), ['b', 'a']);
});

test('the catalog orders current, earlier and mentioned images with stable short handles and a cap', () => {
  const earlier = Array.from({ length: 12 }, (_, index) => image(`old-${index}`, `old-${index}.png`));
  const catalog = imageReferenceCatalog({ attachments: [image('now', 'photo.png'), image('mention-abc', 'img/logo.png')], earlier: [image('now', 'photo.png'), ...earlier] });
  assert.equal(catalog.entries.length, IMAGE_REFERENCE_LIMIT);
  assert.deepEqual(catalog.entries.slice(0, 3).map(({ handle, name, source }) => [handle, name, source]), [['ref1', 'photo.png', 'current'], ['ref2', 'img/logo.png', 'mentioned'], ['ref3', 'old-0.png', 'earlier']]);
  assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, IMAGE_REFERENCE_LIMIT, 'an earlier copy of a current attachment is not listed twice');
  const text = catalog.describe();
  assert.match(text, /ref1 — photo\.png \(attached to this message/);
  assert.match(text, /ref3 — old-0\.png \(attached earlier in this dialog; not shown again/);
  assert.match(text, /project image path/);
});

test('references resolve leniently by handle, id, name or a current draft image path', () => {
  const catalog = imageReferenceCatalog({ attachments: [image('11111111-2222-3333-4444-555555555555', 'photo.png')], earlier: [image('old', 'earlier.jpg', { mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' })] });
  const hero = Uint8Array.of(...png, 1), files = { 'index.tpl': '@layout\n@endlayout', 'img/hero.png': hero };
  const resolved = catalog.resolve(['REF1', '@ref2', 'img/hero.png'], files);
  assert.deepEqual(resolved.map(item => item.name), ['photo.png', 'earlier.jpg', 'img/hero.png']);
  assert.equal(resolved[0].dataUrl, dataUrl); assert.equal(resolved[1].dataUrl, 'data:image/jpeg;base64,/9j/4AAQ'); assert.equal(resolved[2].dataUrl, `data:image/png;base64,${btoa(String.fromCharCode(...hero))}`);
  assert.deepEqual(catalog.resolve(['11111111-2222-3333-4444-555555555555', 'photo.png', 'ref1'], files).map(item => item.name), ['photo.png'], 'aliases of one image are sent once');
  assert.throws(() => catalog.resolve(['ref9'], files), /Unknown image reference "ref9".*ref1 \(photo\.png\).*ref2 \(earlier\.jpg\)/);
  assert.throws(() => catalog.resolve(['index.tpl'], files), /Unknown image reference/);
  assert.throws(() => catalog.resolve(['ref1', 'ref2', 'img/hero.png', 'img/hero.png', 'photo.png'].concat(['x']), files), /Unknown image reference "x"/);
  assert.throws(() => imageReferenceCatalog({}).resolve(['ref1'], {}), /No image references are attached/);
  assert.deepEqual(imageReferenceCatalog({}).resolve([], {}), []);
});

test('attached image parts carry their handle next to the existing page-asset wording', () => {
  const content = attachmentMessage('Brief', [image('photo-1', 'portrait.png'), image('photo-2', 'product.png', { useOnPage: true })]);
  assert.equal(content[1].text, 'Attached image ref1: portrait.png. Visual reference only; do not embed this screenshot or photo in the page.');
  assert.equal(content[3].text, 'Attached image ref2: product.png. Available page asset: images/reference-photo-2.png');
});

test('generate_image takes up to 3 references, accepts the legacy referenceIds alias and reports the reference count', async () => {
  let files = { 'index.tpl': '@layout\n@endlayout' };
  const calls = [], events = [];
  const generateImage = async input => { calls.push(input); return Uint8Array.of(...png, calls.length); };
  generateImage.resolveReferences = (tokens, current) => imageReferenceCatalog({ attachments: [image('photo-1', 'portrait.png')] }).resolve(tokens, current);
  const tool = draftImageTool({ generateImage, getFiles: () => files, commit(next) { files = next; }, onProgress: event => events.push(event) });
  const schema = tool.inputSchema;
  assert.match(tool.description, /from scratch/i); assert.match(tool.description, /1–3 reference/); assert.match(tool.description, /MUST pass references/);
  assert.equal(schema.safeParse({ path: 'a.png', prompt: 'x', references: ['ref1', 'ref2', 'ref3', 'ref4'] }).success, false);
  assert.deepEqual(await tool.execute({ path: 'img/a.png', prompt: 'Same person, new pose', references: ['ref1'] }), { ok: true, path: 'img/a.png', references: 1 });
  assert.deepEqual(await tool.execute({ path: 'img/b.png', prompt: 'Variant of the first', referenceIds: ['photo-1', 'img/a.png'] }), { ok: true, path: 'img/b.png', references: 2 });
  assert.deepEqual(await tool.execute({ path: 'img/c.png', prompt: 'From scratch' }), { ok: true, path: 'img/c.png' });
  assert.deepEqual(calls.map(call => call.references.map(item => item.name)), [['portrait.png'], ['portrait.png', 'img/a.png'], []]);
  assert.deepEqual(events.filter(event => event.type === 'image-start').map(({ references, referenceNames }) => [references, referenceNames]), [[1, ['portrait.png']], [2, ['portrait.png', 'img/a.png']], [0, []]]);
  const wrong = await tool.execute({ path: 'img/d.png', prompt: 'Like the photo', references: ['11111111-typo'] });
  assert.equal(wrong.ok, false); assert.match(wrong.error, /Unknown image reference "11111111-typo".*ref1 \(portrait\.png\)/);
  assert.equal(calls.length, 3, 'an unknown reference never reaches the paid generator');
  assert.deepEqual(await tool.execute({ path: 'img/e.png', prompt: 'Retry', references: ['ref1'] }), { ok: true, path: 'img/e.png', references: 1 }, 'an unknown reference is not terminal');
  for (const field of ['references', 'referenceIds']) assert.ok(sanitizeAiToolValidationEvent({ type: 'tool-validation', tool: 'generate_image', issueField: field, issueCode: 'too_big' }));
});

test('image steps show how many references were used', () => {
  assert.equal(stepCard({ id: 'a', tool: 'generate_image', path: 'img/a.png', references: 2, status: 'running' }, { language: 'en' }).label, 'Generating image img/a.png from 2 reference(s)');
  assert.equal(stepCard({ id: 'a', tool: 'generate_image', path: 'img/a.png', references: 1, status: 'running' }, { language: 'ru' }).label, 'Генерирую img/a.png по референсам: 1');
  assert.equal(stepCard({ id: 'a', tool: 'generate_image', path: 'img/a.png', references: 3, status: 'done' }, { language: 'uk' }).label, 'Генерую img/a.png за референсами: 3');
  assert.equal(stepCard({ id: 'a', tool: 'generate_image', path: 'img/a.png', status: 'done' }, { language: 'ru' }).label, 'Генерирую изображение img/a.png');
});

test('an image model without input_references gets a clear terminal message in the user language', async () => {
  const body = { error: { code: 404, message: 'No endpoints found that support input_references.' } };
  const failure = referenceSupportError(normalizeAiProviderError(body, { status: 404 }), { model: 'openai/dall-e-3' });
  assert.equal(failure.message, 'The image model openai/dall-e-3 does not accept reference images. Choose a model that supports input_references (for example, Gemini Flash Image) or generate without a reference.');
  assert.equal(failure.terminalImage, true); assert.equal(failure.retryable, false);
  assert.equal(referenceSupportError(normalizeAiProviderError({ error: { code: 402, message: 'Insufficient credits' } }, { status: 402 }), { model: 'x' }), undefined);
  assert.equal(localizeAiErrorText(`Image generation could not finish: ${failure.message} Completed content is retained.`, { language: 'ru' }),
    'Image generation could not finish: Модель изображений openai/dall-e-3 не принимает референсы. Выберите модель с поддержкой input_references (например, Gemini Flash Image) или сгенерируйте без референса. Completed content is retained.');
  assert.match(localizeAiErrorText(failure.message, { language: 'uk' }), /^Модель зображень openai\/dall-e-3 не приймає референси/);
  assert.equal(localizeAiErrorText(failure.message, { language: 'en' }), failure.message);
  assert.match(stepCard({ id: 'a', tool: 'generate_image', path: 'img/a.png', references: 1, status: 'error', detail: failure.message }, { language: 'ru' }).detail, /^Модель изображений openai\/dall-e-3 не принимает референсы/);
  const identity = (text, values = {}) => text.replace(/\{([A-Za-z]+)\}/g, (match, key) => values[key] ?? match);
  assert.match(runToState({ id: 'r', state: 'failed', error: `Image generation could not finish: ${failure.message}` }, identity, 'uk').message, /^Image generation could not finish: Модель зображень openai\/dall-e-3/);
  const fetchImpl = async () => Response.json(body, { status: 404 });
  await assert.rejects(generateImageWithOpenRouter({ apiKey: 'sk-or-v1-0123456789abcdef', imageModel: 'openai/dall-e-3', prompt: 'Variant', references: [dataUrl], fetchImpl }), error => /does not accept reference images/.test(error.message) && error.terminalImage === true);
  await assert.rejects(generateImageWithOpenRouter({ apiKey: 'sk-or-v1-0123456789abcdef', imageModel: 'openai/dall-e-3', prompt: 'Scratch', fetchImpl }), error => !/does not accept reference images/.test(error.message));
});
