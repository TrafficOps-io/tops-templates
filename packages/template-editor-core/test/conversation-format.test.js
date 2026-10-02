import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOB_TAG, createSplitCache, documentOf, joinThread, seedSplitCache, sha256Hex, splitThread, threadHash, threadsOf, validateThreadFile } from '../src/conversation-format.js';

const big = 'x'.repeat(5000);
const png = `data:image/png;base64,${Buffer.from('fake image bytes').toString('base64')}`;
function thread() {
  return { schema: 1, id: 'thread-1', revision: 0, title: 'Hero', archived: false,
    messages: [{ id: 'm1', role: 'user', prompt: 'Make it blue', status: 'saved', attachments: [{ id: 'a1', name: 'hero.png', mime: 'image/png', dataUrl: png, useOnPage: false }] }],
    runs: [{ id: 'r1', threadId: 'thread-1', messageId: 'm1', state: 'ready', updatedAt: 10, owner: { sessionId: 's', expiresAt: 5 },
      base: { files: { 'index.html': big, 'small.css': 'a{}', 'logo.png': new Uint8Array([1, 2, 3]) }, translations: { en: { title: 'Old' } } },
      result: { files: { 'index.html': `${big}!` }, values: { title: 'New' }, valid: true } }] };
}
async function roundTrip(value) {
  const { thread: split, blobs } = await splitThread(value);
  return { split, blobs, joined: await joinThread(split, async sha => blobs.get(sha)) };
}

test('split externalizes large file text, bytes and attachment data URLs, and join restores them exactly', async () => {
  const original = thread(), { split, blobs, joined } = await roundTrip(original);
  assert.deepEqual(joined, original);
  assert.equal(split.runs[0].base.files['small.css'], 'a{}');
  assert.equal(split.runs[0].base.files['index.html'].encoding, 'utf8');
  assert.match(split.runs[0].base.files['index.html'][BLOB_TAG], /^[a-f0-9]{64}$/);
  assert.equal(split.runs[0].base.files['logo.png'].encoding, 'bytes');
  assert.deepEqual([split.messages[0].attachments[0].dataUrl.encoding, split.messages[0].attachments[0].dataUrl.mime], ['dataUrl', 'image/png']);
  assert.equal(blobs.size, 4);
  assert.equal(JSON.stringify(split).includes(big), false);
  assert.equal(validateThreadFile(split), split);
});

test('identical snapshot content across runs is stored once', async () => {
  const value = thread(); value.runs.push({ ...structuredClone(value.runs[0]), id: 'r2' });
  assert.equal((await roundTrip(value)).blobs.size, 4);
});

test('a data URL that is non-canonical or not decodable stays inline', async () => {
  for (const dataUrl of ['data:image/png;base64,QR==', 'data:image/png;base64,Q', 'data:image/png;base64,QQ=']) {
    const value = thread(); value.messages[0].attachments[0].dataUrl = dataUrl;
    const { split, joined } = await roundTrip(value);
    assert.equal(split.messages[0].attachments[0].dataUrl, dataUrl);
    assert.deepEqual(joined, value);
  }
});

test('random documents round-trip losslessly (seeded property test)', async () => {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = items => items[Math.floor(random() * items.length)];
  const text = () => 'abcé€😀\n'.repeat(1 + Math.floor(random() * (random() < 0.3 ? 1200 : 4)));
  const bytes = () => Uint8Array.from({ length: Math.floor(random() * 64) }, () => Math.floor(random() * 256));
  const dataUrl = () => pick([png, 'data:image/png;base64,QR==', 'data:image/png;base64,Q', `data:image/webp;base64,${Buffer.from(bytes()).toString('base64')}`]);
  const generators = [text, bytes, () => 7, () => null, () => ({ files: { 'a.html': text(), 'b.bin': bytes() } }), () => ({ id: `att-${Math.floor(random() * 1e9)}`, mime: 'image/png', dataUrl: dataUrl() })];
  const value = depth => depth < 3 && random() < 0.4 ? (random() < 0.5 ? [value(depth + 1), value(depth + 1)] : { nested: value(depth + 1), other: value(depth + 1) }) : pick(generators)();
  for (let index = 0; index < 50; index++) {
    const original = { schema: 1, id: 't', revision: 0, messages: [{ id: 'm', payload: value(0) }],
      runs: [{ id: 'r', threadId: 't', updatedAt: index, base: { files: { 'x.html': text(), 'y.png': bytes() } }, extra: value(0) }] };
    assert.deepEqual((await roundTrip(original)).joined, original, `iteration ${index}`);
  }
});

test('a cache seeded from a persisted thread makes an unchanged re-split hash nothing', async () => {
  const value = thread(), { split } = await roundTrip(value); let hashes = 0;
  await splitThread(value, { cache: seedSplitCache(createSplitCache(), split), hash: bytes => { hashes++; return sha256Hex(bytes); } });
  assert.equal(hashes, 0);
});

test('the reserved blob key cannot appear in content', async () => {
  const value = thread(); value.messages[0].meta = { [BLOB_TAG]: 'x' };
  await assert.rejects(splitThread(value), /Reserved conversation key/);
});

test('a run split is reused while run.updatedAt is unchanged; other fields are always re-serialized', async () => {
  const value = thread(); let hashes = 0;
  const hash = bytes => { hashes++; return sha256Hex(bytes); };
  const first = createSplitCache();
  await splitThread(value, { cache: createSplitCache(), nextCache: first, hash });
  const initial = hashes;
  value.runs[0].owner.expiresAt = 99; value.messages[0].status = 'interrupted';
  const second = createSplitCache(), { thread: split } = await splitThread(value, { cache: first, nextCache: second, hash });
  assert.equal(hashes, initial);
  assert.equal(split.runs[0].owner.expiresAt, 99); assert.equal(split.messages[0].status, 'interrupted');
  value.runs[0].updatedAt = 11; value.runs[0].result.files['index.html'] = `${big}?`;
  await splitThread(value, { cache: second, nextCache: createSplitCache(), hash });
  assert.ok(hashes > initial);
});

test('threadHash ignores revision and changes with content', async () => {
  const { split } = await roundTrip(thread());
  assert.equal(await threadHash({ ...split, revision: 7 }), await threadHash(split));
  assert.notEqual(await threadHash({ ...split, title: 'Other' }), await threadHash(split));
});

test('thread files reject foreign or duplicate runs, raw bytes, too many runs and oversize content', () => {
  const base = { schema: 1, id: 't', revision: 0, messages: [], runs: [] };
  assert.throws(() => validateThreadFile({ ...base, runs: [{ id: 'r', threadId: 'other' }] }), /another dialogue/);
  assert.throws(() => validateThreadFile({ ...base, runs: [{ id: 'r', threadId: 't' }, { id: 'r', threadId: 't' }] }), /Duplicate/);
  assert.throws(() => validateThreadFile({ ...base, messages: [{ id: 'm', raw: new Uint8Array(1) }] }), /raw bytes/);
  assert.throws(() => validateThreadFile({ ...base, runs: Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, threadId: 't' })) }), /at most 100 runs/);
  assert.throws(() => validateThreadFile({ ...base, title: 'x'.repeat(16 * 1024 * 1024) }), /16 MiB/);
});

test('threadsOf groups runs by dialogue and documentOf restores the document shape', () => {
  const document = { schema: 1, projectId: 'p', revision: 3, threads: [{ id: 'a', revision: 2, messages: [] }, { id: 'b', messages: [] }], runs: [{ id: 'r1', threadId: 'b' }, { id: 'r2', threadId: 'a' }] };
  const threads = threadsOf(document);
  assert.deepEqual(threads.map(item => [item.schema, item.id, item.revision, item.runs.map(run => run.id)]), [[1, 'a', 2, ['r2']], [1, 'b', 0, ['r1']]]);
  assert.deepEqual(documentOf('p', threads, 9), { schema: 1, projectId: 'p', revision: 9,
    threads: [{ id: 'a', revision: 2, messages: [] }, { id: 'b', revision: 0, messages: [] }], runs: [{ id: 'r2', threadId: 'a' }, { id: 'r1', threadId: 'b' }] });
  assert.throws(() => threadsOf({ ...document, runs: [{ id: 'r3', threadId: 'missing' }] }), /no dialogue/);
});
