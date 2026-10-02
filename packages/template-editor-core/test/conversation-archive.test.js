import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { CONVERSATION_LIMITS, LIMITS, createZip, inspectZip, readZip, readZipProject, validateConversationDocument, validatePortableMetadata } from '../src/project.js';
import { conversationThreadFileName, sha256Hex, splitThread, validateThreadFile } from '../src/conversation-format.js';
import { conversationDocumentFromFiles, conversationFilesFromDocument } from '../src/conversation-archive.js';

const DIR = '.trafficops/conversations';
const metadata = { schema: 1, projectId: 'project-1', kind: 'landing', name: 'Demo' };
const files = { 'index.tpl': '@layout\nHi\n@endlayout' };
const png = `data:image/png;base64,${Buffer.from('fake image bytes').toString('base64')}`;
const big = 'x'.repeat(5000);
const json = value => strToU8(JSON.stringify(value));
const thread = (id, extra = {}) => ({ schema: 1, id, revision: 1, title: 'Dialogue', messages: [], runs: [], ...extra });
function document() {
  const attachment = { id: 'a1', name: 'hero.png', mime: 'image/png', dataUrl: png, useOnPage: false };
  return { schema: 1, projectId: 'project-1', revision: 4,
    threads: [{ id: 'thread-1', revision: 3, title: 'Hero', messages: [{ id: 'm1', role: 'user', prompt: 'Blue', attachments: [attachment] }] },
      { id: 'Thread Two', revision: 1, title: 'Footer', messages: [{ id: 'm2', role: 'user', prompt: 'Same image', attachments: [{ ...attachment }] }] }],
    runs: [{ id: 'r1', threadId: 'thread-1', messageId: 'm1', state: 'ready', updatedAt: 10,
      base: { files: { 'index.html': big, 'logo.png': new Uint8Array([1, 2, 3]) } }, result: { files: { 'index.html': `${big}!` }, valid: true } }] };
}
const withoutRevisions = value => ({ ...value, revision: 0, threads: value.threads.map(({ revision: _revision, ...rest }) => rest) });
// A raw archive with the given extra entries next to a valid project.
const raw = (extra, base = { 'index.tpl': strToU8('x'), '.trafficops/project.json': json(metadata) }) => zipSync({ ...base, ...extra });
function noise(size) {
  const bytes = new Uint8Array(size);
  let state = 0x9e3779b9;
  for (let index = 0; index < size; index++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; bytes[index] = state & 255; }
  return bytes;
}

test('thread file names: readable ids stay readable; others are the sha256 of the UTF-8 id', async () => {
  assert.equal(conversationThreadFileName('thread-1'), 'thread-1.json');
  assert.equal(conversationThreadFileName('initial-thread-64-abc_9'), 'initial-thread-64-abc_9.json');
  for (const id of ['Thread Two', 'ÄÖü 💬', 'A'.repeat(55), 'B'.repeat(56), 'C'.repeat(64), 'D'.repeat(119), 'x/../y', 'e'.repeat(201), 'f'.repeat(160) + 'G']) {
    assert.equal(conversationThreadFileName(id), `~${await sha256Hex(new TextEncoder().encode(id))}.json`, id);
  }
});

test('new layout round-trips per-dialogue files and deduplicated blobs through the ZIP', async () => {
  const original = document(), conversationFiles = await conversationFilesFromDocument(original);
  assert.equal(conversationFiles.threads.length, 2);
  assert.equal(conversationFiles.blobs.size, 4, 'the shared image is stored once');
  const bytes = createZip(files, { metadata, conversationFiles });
  const names = Object.keys(unzipSync(bytes));
  assert.ok(names.includes(`${DIR}/thread-1.json`));
  assert.ok(names.includes(`${DIR}/${conversationThreadFileName('Thread Two')}`));
  assert.equal(names.filter(name => name.startsWith(`${DIR}/blobs/`)).length, 4);
  assert.ok(!names.includes('.trafficops/conversations.json'));
  const imported = readZipProject(bytes, { history: true });
  assert.deepEqual({ ...imported.files }, files);
  assert.deepEqual(imported.metadata, metadata);
  assert.deepEqual(imported.folders, []);
  assert.equal(imported.conversations, undefined);
  assert.deepEqual(imported.conversationFiles.threads.map(item => item.id).sort(), ['Thread Two', 'thread-1']);
  assert.ok(imported.conversationFiles.blobs instanceof Map);
  const restored = await conversationDocumentFromFiles(imported.conversationFiles, 'project-1');
  assert.deepEqual(restored, withoutRevisions(original));
  assert.deepEqual({ ...readZip(bytes, { history: true }) }, files);
});

test('history: false rejects new-layout entries; the default stays 20 MiB', async () => {
  const bytes = createZip(files, { metadata, conversationFiles: await conversationFilesFromDocument(document()) });
  assert.throws(() => readZipProject(bytes), /history/i);
  assert.throws(() => inspectZip(bytes), /history/i);
  assert.throws(() => readZip(bytes), /history/i);
  assert.throws(() => readZipProject(raw({ [`${DIR}/`]: new Uint8Array() })), /history/i);
  assert.throws(() => inspectZip(new Uint8Array(LIMITS.archive + 1)), /20 MiB/);
  assert.equal(LIMITS.portableArchive, 512 * 1024 * 1024);
});

test('history: true accepts archives larger than 20 MiB', async () => {
  const value = { schema: 1, projectId: 'project-1', revision: 0, threads: [{ id: 't1', messages: [] }],
    runs: [{ id: 'r1', threadId: 't1', updatedAt: 1, base: { files: { 'photo.jpg': noise(21 * 1024 * 1024) } } }] };
  const bytes = createZip(files, { metadata, conversationFiles: await conversationFilesFromDocument(value) });
  assert.ok(bytes.length > LIMITS.archive);
  assert.throws(() => readZipProject(bytes), /20 MiB/);
  const restored = await conversationDocumentFromFiles(readZipProject(bytes, { history: true }).conversationFiles, 'project-1');
  assert.deepEqual(restored.runs[0].base.files['photo.jpg'], value.runs[0].base.files['photo.jpg']);
});

test('history entries do not count against the user entry or user size caps', async () => {
  const user = Object.fromEntries(Array.from({ length: LIMITS.count }, (_, index) => [`f${index}.txt`, 'x']));
  const split = await splitThread(thread('t1', { runs: [{ id: 'r1', threadId: 't1', base: { files: { 'a.bin': new Uint8Array(3) } } }] }));
  const [[sha, blob]] = split.blobs;
  const entries = { ...Object.fromEntries(Object.entries(user).map(([name, value]) => [name, strToU8(value)])), '.trafficops/project.json': json(metadata),
    [`${DIR}/t1.json`]: json(split.thread), [`${DIR}/blobs/${sha}`]: blob };
  assert.equal(readZipProject(zipSync(entries), { history: true }).conversationFiles.threads.length, 1);
  assert.throws(() => readZipProject(zipSync({ ...entries, 'one-more.txt': strToU8('x') }), { history: true }), /500/);
  // 31 MiB of user files plus 4 MiB of history: only the user files count against 32 MiB.
  const large = { 'index.tpl': 'x', ...Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`a${index}.bin`, new Uint8Array(7.75 * 1024 * 1024)])) };
  const heavy = { schema: 1, projectId: 'project-1', revision: 0, threads: [{ id: 't1', messages: [] }], runs: [{ id: 'r1', threadId: 't1', updatedAt: 1, base: { files: { 'b.bin': new Uint8Array(4 * 1024 * 1024) } } }] };
  const zip = createZip(large, { metadata, conversationFiles: await conversationFilesFromDocument(heavy) });
  assert.equal(Object.keys(readZipProject(zip, { history: true }).files).length, 5);
});

test('history entry caps: at most 100 dialogue files and 10 000 blobs', async () => {
  const threads = Object.fromEntries(Array.from({ length: CONVERSATION_LIMITS.threads + 1 }, (_, index) => [`${DIR}/t${index}.json`, json(thread(`t${index}`))]));
  assert.throws(() => readZipProject(raw(threads), { history: true }), /100 dialogues/);
  const blobs = Object.fromEntries(Array.from({ length: 10001 }, (_, index) => [`${DIR}/blobs/${index.toString(16).padStart(64, '0')}`, new Uint8Array([1])]));
  assert.throws(() => readZipProject(raw(blobs), { history: true }), /10000 blobs/);
  const many = { threads: Array.from({ length: CONVERSATION_LIMITS.threads + 1 }, (_, index) => thread(`t${index}`)), blobs: new Map() };
  assert.throws(() => createZip(files, { metadata, conversationFiles: many }), /100 dialogues/);
});

test('new history paths reject traversal, hidden, nested and non-canonical names', async () => {
  const sha = 'a'.repeat(64);
  for (const name of [`${DIR}/../x.json`, `${DIR}/.hidden.json`, `${DIR}/sub/a.json`, `${DIR}/sub/`, `${DIR}/a.txt`, `${DIR}/Upper.json`, `${DIR}/~abc.json`,
    `${DIR}/blobs/notasha`, `${DIR}/blobs/${sha.toUpperCase()}`, `${DIR}/blobs/${sha}/`, `${DIR}/blobs/${sha}/x`, `${DIR}/blobs/.${sha}`, `${DIR}/blobs`, `${DIR}`]) {
    assert.throws(() => readZipProject(raw({ [name]: name.endsWith('/') ? new Uint8Array() : json(thread('a')) }), { history: true }), /history entry|Unsafe|Invalid/, name);
  }
  // A dialogue stored under another id's name.
  assert.throws(() => readZipProject(raw({ [`${DIR}/b.json`]: json(thread('a')) }), { history: true }), /name/);
  assert.throws(() => readZipProject(raw({ [`${DIR}/${conversationThreadFileName('Other Id')}`]: json(thread('Some Id')) }), { history: true }), /name/);
  // A valid hashed name, and empty directory entries for the history folders.
  const imported = readZipProject(raw({ [`${DIR}/`]: new Uint8Array(), [`${DIR}/blobs/`]: new Uint8Array(), [`${DIR}/${conversationThreadFileName('Some Id')}`]: json(thread('Some Id')) }), { history: true });
  assert.deepEqual(imported.conversationFiles.threads.map(item => item.id), ['Some Id']);
  assert.deepEqual(imported.folders, []);
});

test('new history is validated: dialogue files, referenced blobs, identity and blob hashes', async () => {
  assert.throws(() => readZipProject(raw({ [`${DIR}/a.json`]: json({ ...thread('a'), runs: [{ id: 'r', threadId: 'b' }] }) }), { history: true }), /another dialogue/);
  assert.throws(() => readZipProject(raw({ [`${DIR}/a.json`]: strToU8('{nope') }), { history: true }));
  const missing = thread('a', { messages: [{ id: 'm', data: { $trafficopsBlob: 'b'.repeat(64), encoding: 'bytes', size: 1 } }] });
  assert.throws(() => readZipProject(raw({ [`${DIR}/a.json`]: json(missing) }), { history: true }), /missing/);
  assert.throws(() => readZipProject(raw({ [`${DIR}/a.json`]: json(thread('a')) }, { 'index.tpl': strToU8('x') }), { history: true }), /identity/);
  assert.throws(() => readZipProject(raw({ [`${DIR}/a.json`]: json(thread('a')), '.trafficops/conversations.json': json({ schema: 1, projectId: 'project-1', revision: 0, threads: [], runs: [] }) }), { history: true }), /two/i);
  const split = await splitThread(thread('a', { runs: [{ id: 'r1', threadId: 'a', base: { files: { 'a.bin': new Uint8Array([1, 2, 3]) } } }] }));
  const [[sha]] = split.blobs;
  const forged = readZipProject(raw({ [`${DIR}/a.json`]: json(split.thread), [`${DIR}/blobs/${sha}`]: new Uint8Array([9, 9, 9]) }), { history: true });
  await assert.rejects(conversationDocumentFromFiles(forged.conversationFiles, 'project-1'), /hash/);
  await assert.rejects(conversationDocumentFromFiles({ threads: [split.thread], blobs: new Map() }, 'project-1'), /missing/);
  assert.throws(() => createZip(files, { metadata, conversationFiles: { threads: [split.thread], blobs: new Map() } }), /missing/);
  await assert.rejects(async () => createZip(files, { conversationFiles: await conversationFilesFromDocument(document()) }), /identity/);
  await assert.rejects(async () => createZip(files, { metadata, conversations: document(), conversationFiles: await conversationFilesFromDocument(document()) }), /two/i);
  const oversized = { [`${DIR}/blobs/${'c'.repeat(64)}`]: new Uint8Array(CONVERSATION_LIMITS.blob + 1) };
  assert.throws(() => readZipProject(raw(oversized), { history: true }), /too large/);
});

test('generated (hosting) ZIPs never contain history', async () => {
  const zip = unzipSync(createZip({ 'index.html': '<p>x</p>' }, { generated: true, metadata, conversationFiles: await conversationFilesFromDocument(document()) }));
  assert.deepEqual(Object.keys(zip), ['index.html']);
});

test('the legacy conversations.json entry still reads, with and without history', () => {
  const legacy = { schema: 1, projectId: 'project-1', revision: 2, threads: [{ id: 't1', title: 'Old' }], runs: [] };
  const bytes = createZip(files, { metadata, conversations: legacy });
  assert.ok(Object.keys(unzipSync(bytes)).includes('.trafficops/conversations.json'));
  for (const options of [undefined, { history: false }, { history: true }]) {
    const imported = readZipProject(bytes, options);
    assert.deepEqual(imported.conversations, legacy);
    assert.equal(imported.conversationFiles, undefined);
  }
});

test('ids must be well-formed UTF-16: lone surrogates would collide once encoded as UTF-8', () => {
  for (const id of ['a\uD800', '\uDC00b', 'x\uDC00\uD800y']) {
    assert.throws(() => validateThreadFile(thread(id)), /Invalid dialogue ID/, JSON.stringify(id));
    assert.throws(() => validateConversationDocument({ schema: 1, projectId: 'p', revision: 0, threads: [{ id }], runs: [] }), /Invalid history threads ID/);
    assert.throws(() => validateThreadFile(thread('t', { messages: [{ id }] })), /Invalid message ID/);
    assert.throws(() => validatePortableMetadata({ ...metadata, projectId: id }), /Invalid portable project ID/);
    assert.throws(() => conversationThreadFileName(id), /Invalid dialogue ID/);
  }
  for (const id of ['💬 chat', 'ÄÖü', '\uD83D\uDE00']) {
    assert.equal(validateThreadFile(thread(id)).id, id);
    assert.equal(validateConversationDocument({ schema: 1, projectId: id, revision: 0, threads: [{ id }], runs: [] }).projectId, id);
  }
});

test('readZipProject drops blobs that no dialogue references', async () => {
  const split = await splitThread(thread('a', { runs: [{ id: 'r1', threadId: 'a', base: { files: { 'a.bin': new Uint8Array([1, 2, 3]) } } }] }));
  const [[sha, blob]] = split.blobs, orphan = 'd'.repeat(64);
  const imported = readZipProject(raw({ [`${DIR}/a.json`]: json(split.thread), [`${DIR}/blobs/${sha}`]: blob, [`${DIR}/blobs/${orphan}`]: new Uint8Array([7]) }), { history: true });
  assert.deepEqual([...imported.conversationFiles.blobs.keys()], [sha]);
});

test('conversationDocumentFromFiles reports damaged files as validation errors with their message', async () => {
  const bad = { ...thread('a'), runs: [{ id: 'r', threadId: 'b' }] };
  await assert.rejects(conversationDocumentFromFiles({ threads: [bad], blobs: new Map() }, 'project-1'), error => error.code === 'validation' && error.message === 'A conversation run belongs to another dialogue.');
  const broken = thread('a', { messages: [{ id: 'm', data: { $trafficopsBlob: 'b'.repeat(64), encoding: 'bytes', size: 2 } }] });
  await assert.rejects(conversationDocumentFromFiles({ threads: [broken], blobs: new Map([['b'.repeat(64), new Uint8Array([1])]]) }, 'project-1'), error => error.code === 'validation');
});

test('the entry-count error states the user-entry limit', () => {
  const user = Object.fromEntries(Array.from({ length: LIMITS.count + 1 }, (_, index) => [`f${index}.txt`, strToU8('x')]));
  assert.throws(() => readZipProject(zipSync(user)), new RegExp(`at most ${LIMITS.count} files and folders outside \\.trafficops`));
  assert.throws(() => readZipProject(zipSync({ ...user, ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`g${index}.txt`, strToU8('x')])) })), new RegExp(`at most ${LIMITS.count} files and folders`));
});
