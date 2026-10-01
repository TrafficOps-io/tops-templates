import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { validateAttachments } from '../src/ai-attachments.js';
import { FILE_ATTACHMENT_LIMITS, fileAiAttachmentBytes, fileAiAttachmentMessage, readFileAiAttachments, validateFileAiAttachments } from '../src/file-ai-attachments.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
const image = () => ({ id: 'image-1', name: 'photo.png', mime: 'image/png', dataUrl: `data:image/png;base64,${png}` });
const pdf = () => ({ id: 'pdf-1', name: 'brief.pdf', mime: 'application/pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64')}` });
const document = (text = 'Keep the headline in Ukrainian.') => ({ id: 'text-1', name: 'brief.md', mime: 'text/markdown', text });

test('file references normalize supported images, PDF and text without page-asset flags', async () => {
  const original = { ...image(), useOnPage: true };
  const references = await readFileAiAttachments([
    new File([Buffer.from('%PDF-1.4\n%%EOF\n')], 'brief.pdf'),
    new File(['Колір: зелений'], 'brief.txt', { type: 'text/plain' }),
  ], [original]);
  assert.deepEqual(references[0], image());
  assert.equal(references[1].mime, 'application/pdf');
  assert.equal(references[2].text, 'Колір: зелений');
  assert.equal(references[2].mime, 'text/plain');
  assert.equal(original.useOnPage, true, 'normalization does not mutate the existing image-only reference');
  assert.equal(references.some(item => 'useOnPage' in item), false);
  assert.throws(() => validateAttachments([pdf()]), /Attach PNG, JPEG or WebP images/, 'legacy attachment workflows remain image-only');
});

test('binary Word containers and invalid text/PDF data fail before being used as references', async () => {
  await assert.rejects(readFileAiAttachments([new File(['not a Word document'], 'brief.docx', { type: 'text/plain' })]), /Attach PNG, JPEG, WebP, PDF or UTF-8 text documents/);
  await assert.rejects(readFileAiAttachments([new File([Uint8Array.of(0xff, 0xfe, 0x41)], 'brief.txt')]), /UTF-8 text document/);
  await assert.rejects(readFileAiAttachments([new File([Uint8Array.of(65, 0, 66)], 'brief.txt')]), /UTF-8 text document/);
  await assert.rejects(readFileAiAttachments([new File(['plain text'], 'brief.pdf')]), /do not match the PDF format/);
  assert.throws(() => fileAiAttachmentBytes({ ...pdf(), dataUrl: 'https://example.com/brief.pdf' }), /valid PDF/);
  assert.throws(() => fileAiAttachmentBytes({ ...pdf(), dataUrl: 'data:application/pdf;base64,!invalid!' }), /valid PDF/);
  assert.throws(() => validateFileAiAttachments([image(), { ...image() }]), /Invalid reference file/);
});

test('file references enforce per-file UTF-8 byte bounds, total bytes and count', async () => {
  assert.throws(() => validateFileAiAttachments([document('я'.repeat(FILE_ATTACHMENT_LIMITS.textBytes / 2 + 1))]), /256 KiB/);
  await assert.rejects(readFileAiAttachments([new File(['x'.repeat(FILE_ATTACHMENT_LIMITS.textBytes + 1)], 'brief.txt')]), /256 KiB/);
  await assert.rejects(readFileAiAttachments([new File([new Uint8Array(FILE_ATTACHMENT_LIMITS.bytes + 1)], 'brief.pdf')]), /4 MiB/);
  const bytes = new Uint8Array(FILE_ATTACHMENT_LIMITS.bytes); bytes.set(new TextEncoder().encode('%PDF-1.4'));
  await assert.rejects(readFileAiAttachments(Array.from({ length: 4 }, (_, index) => new File([bytes], `${index}.pdf`))), /12 MiB/);
  assert.throws(() => validateFileAiAttachments(Array.from({ length: 5 }, (_, index) => ({ ...document(), id: `ref-${index}` }))), /up to 4 reference files/);
  assert.throws(() => fileAiAttachmentMessage('Edit file', null), /up to 4 reference files/);
});

test('oversized image dimensions reject before invoking the browser bitmap decoder', async () => {
  const originalDecoder = globalThis.createImageBitmap;
  let decoded = 0;
  globalThis.createImageBitmap = async () => { decoded++; return { close() {} }; };
  try {
    for (const offset of [16, 20]) {
      const bytes = Buffer.from(png, 'base64'); bytes.writeUInt32BE(4097, offset);
      await assert.rejects(readFileAiAttachments([new File([bytes], 'oversized.png', { type: 'image/png' })]), /4096 pixels per side and 16 megapixels/);
      assert.throws(() => validateFileAiAttachments([{ ...image(), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }]), /4096 pixels per side and 16 megapixels/);
    }
    assert.equal(decoded, 0, 'large headers cannot trigger bitmap memory allocation');
    const valid = await readFileAiAttachments([new File([Buffer.from(png, 'base64')], 'valid.png', { type: 'image/png' })]);
    assert.equal(valid.length, 1); assert.equal(decoded, 1, 'a bounded image still reaches the native format validation');
  } finally {
    if (originalDecoder) globalThis.createImageBitmap = originalDecoder;
    else delete globalThis.createImageBitmap;
  }
});

test('OpenRouter transport sends images/PDF as file content and UTF-8 documents as text', async () => {
  let request;
  const model = createOpenRouter({ apiKey: 'mock-secret', fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return Response.json({ id: 'mock-response', model: 'test/model', choices: [{ index: 0, message: { role: 'assistant', content: 'Ready' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  } })('test/model');
  await generateText({ model, messages: [{ role: 'user', content: fileAiAttachmentMessage('Edit only photo.png', [image(), pdf(), document()]) }], maxRetries: 0 });
  const content = request.messages[0].content;
  assert.deepEqual(content.find(part => part.type === 'image_url'), { type: 'image_url', image_url: { url: image().dataUrl } });
  assert.deepEqual(content.find(part => part.type === 'file'), { type: 'file', file: { filename: 'brief.pdf', file_data: pdf().dataUrl } });
  assert.ok(content.some(part => part.type === 'text' && part.text.includes(document().text)));
  assert.equal(content.filter(part => part.type === 'file').length, 1, 'text references need no provider-side document parser');
  assert.equal(fileAiAttachmentMessage('Edit file'), 'Edit file');
});
