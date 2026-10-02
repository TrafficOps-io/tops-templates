import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAttachments, attachmentType, attachmentUsage, filesFromClipboard, filesFromDrop, matchesAccept } from '../src/chat/attachments.js';

const MiB = 1024 * 1024;
const limits = { count: 10, bytesPerFile: 512 * MiB, bytesTotal: 1024 * MiB, accept: 'image/*,audio/*,video/*,.docx,.txt' };
const file = (name, size = 1024, type = '') => ({ name, size, type });

test('the eleventh file is rejected by count before it is added', () => {
  const current = Array.from({ length: 9 }, (_, index) => file(`photo-${index}.png`, 1024, 'image/png'));
  const { accepted, rejected } = appendAttachments(current, [file('ten.png', 1024, 'image/png'), file('eleven.png', 1024, 'image/png')], limits);
  assert.deepEqual(accepted.map(item => item.name), ['ten.png']);
  assert.deepEqual(rejected.map(item => [item.file.name, item.reason]), [['eleven.png', 'count']]);
});

test('size, total and type limits are checked per file and the rest is accepted in the original order', () => {
  const incoming = [
    file('a.mp3', 10 * MiB, 'audio/mpeg'),
    file('huge.mov', 513 * MiB, 'video/quicktime'),
    file('b.docx', 400 * MiB),
    file('c.mp4', 500 * MiB, 'video/mp4'),
    file('tool.exe', 1024, 'application/x-msdownload'),
    file('notes.txt', 2048, 'text/plain'),
    file('cover.webp', 4096),
  ];
  const { accepted, rejected } = appendAttachments([file('old.png', 200 * MiB, 'image/png')], incoming, limits);
  assert.deepEqual(accepted.map(item => item.name), ['a.mp3', 'b.docx', 'notes.txt', 'cover.webp']);
  assert.deepEqual(rejected.map(item => [item.file.name, item.reason]), [['huge.mov', 'size'], ['c.mp4', 'total'], ['tool.exe', 'type']]);
});

test('empty files are rejected by size and no limits means everything is accepted', () => {
  assert.deepEqual(appendAttachments([], [file('empty.png', 0, 'image/png')], limits).rejected.map(item => item.reason), ['size']);
  const all = Array.from({ length: 12 }, (_, index) => file(`x${index}.exe`, 600 * MiB));
  assert.equal(appendAttachments([], all).accepted.length, 12);
});

test('accept matches MIME wildcards, exact types and extensions; attachment types fall back to the extension', () => {
  assert.ok(matchesAccept(file('a.PNG'), 'image/*'));
  assert.ok(matchesAccept(file('a.bin', 1, 'audio/mpeg'), 'audio/mpeg'));
  assert.ok(matchesAccept(file('Report.DOCX'), '.docx'));
  assert.ok(!matchesAccept(file('a.exe'), 'image/*,.docx'));
  assert.ok(matchesAccept(file('a.exe'), ''));
  assert.equal(attachmentType(file('a.jpg')), 'image');
  assert.equal(attachmentType(file('a.wav')), 'audio');
  assert.equal(attachmentType(file('a', 1, 'video/webm')), 'video');
  assert.equal(attachmentType(file('a.docx')), 'document');
});

test('the counter reports files and bytes against the limits', () => {
  assert.deepEqual(attachmentUsage([file('a', 10), file('b', 20)], limits), { count: 2, maxCount: 10, bytes: 30, maxBytes: 1024 * MiB });
  assert.deepEqual(attachmentUsage([], undefined), { count: 0, maxCount: undefined, bytes: 0, maxBytes: undefined });
});

test('files come from paste and drop, preferring the FileList over items', () => {
  const a = file('a.png'), b = file('b.png');
  assert.deepEqual(filesFromClipboard({ clipboardData: { files: [a], items: [{ kind: 'file', getAsFile: () => b }] } }), [a]);
  assert.deepEqual(filesFromClipboard({ clipboardData: { files: [], items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => b }] } }), [b]);
  assert.deepEqual(filesFromDrop({ dataTransfer: { files: [a, b], items: [] } }), [a, b]);
  assert.deepEqual(filesFromDrop({}), []);
});
