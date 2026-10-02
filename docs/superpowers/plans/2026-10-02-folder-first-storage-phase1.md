# Folder-first storage, Phase 1 (core format + adapter + runtime): implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the per-dialogue conversation format, the `ConversationStore` contract, an in-memory store and the document-shaped adapter to `@trafficops/template-editor-core`, then make the conversation runtime compatible with them.

**Architecture:**
- `conversation-format.js` is pure. It splits a conversation document into thread files and content-addressed blobs, and joins them back.
- `createStoreConversationPort` implements the existing `host.conversations` port (`load`, `save`, `subscribe`) on top of any `ConversationStore`. It uses a two-level CAS: a local document counter, plus a revision for each thread carried inside the document.
- The runtime gets a per-thread run limit, a strictly increasing `run.updatedAt`, `queueInitialRequest` in place of `migrateLegacy`, and quiet heartbeat conflicts.

**Tech stack:** plain ES modules, `node:test` with `node:assert/strict`, WebCrypto `crypto.subtle` (SHA-256), Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-10-02-folder-first-storage-design.md`. Relevant sections: "Project folder format v1", "Limits", "Units → template-editor-core", "Testing → Core/Adapter" and "Delivery phases" 1.

**Out of scope (later plans):**
- Phase 2: `editor/src/storage/*`, the directory store and the Studio UI flows.
- Phase 3: the HTTP store.

Studio keeps running on its IndexedDB port during this phase. Its `host.ai.recovery` is simply no longer read by the runtime. That is intended, because there are no users, and the browser test for it is removed in phase 2.

**Conventions to follow:**
- Code style is dense: single-line guards and `const a = …, b = …`. Match the surrounding files.
- Errors are either a plain `Error` with a user-facing English message, or a `ConflictError` / `ValidationError` from `src/errors.js` (`error.code` is `'conflict'` / `'validation'`).
- To run the tests of one file from the repo root: `node --test packages/template-editor-core/test/<file>.test.js`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/template-editor-core/src/project.js` | modify | new `CONVERSATION_LIMITS`, per-dialogue run limit, 24 MiB history bytes |
| `packages/template-editor-core/src/conversation-format.js` | create | blob refs, split/join, thread-file validation, grouping, hashing |
| `packages/template-editor-core/src/memory-conversation-store.js` | create | reference `ConversationStore`, for tests and for hosts' fakes |
| `packages/template-editor-core/src/conversation-store-contract.js` | create | contract cases for any store, independent of the test runner |
| `packages/template-editor-core/src/conversation-port.js` | create | `createStoreConversationPort(store, { projectId })` |
| `packages/template-editor-core/src/index.js`, `package.json`, `contract.d.ts` | modify | exports and types |
| `packages/template-editor-core/test/conversation-limits.test.js` | create | limits |
| `packages/template-editor-core/test/conversation-format.test.js` | create | split/join |
| `packages/template-editor-core/test/conversation-store.test.js` | create | contract suite against the memory store |
| `packages/template-editor-core/test/conversation-port.test.js` | create | adapter |
| `packages/template-editor-shell/src/conversation-runtime.js` | modify | runtime changes |
| `packages/template-editor-shell/test/conversation-runtime.test.js` | modify | runtime tests |

---

## Chunk 1: Core format, store contract and adapter

### Task 1: Conversation limits

**Files:**
- Modify `packages/template-editor-core/src/project.js`:
  - `:10` (`CONVERSATION_LIMITS`)
  - `:32-35` (the `Uint8Array` byte-limit branch)
  - `:46` and `:50` (total-size message)
  - `:60-70` (the `validateConversationDocument` loop)
- Test: `packages/template-editor-core/test/conversation-limits.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_LIMITS, clonePortablePayload, validateConversationDocument } from '../src/project.js';

const doc = (threads, runs) => ({ schema: 1, projectId: 'p', revision: 0, threads, runs });

test('history limits count runs per dialogue, not per project', () => {
  const runs = Array.from({ length: 150 }, (_, index) => ({ id: `r${index}`, threadId: index < 100 ? 'a' : 'b' }));
  validateConversationDocument(doc([{ id: 'a', messages: [] }, { id: 'b', messages: [] }], runs));
  assert.throws(() => validateConversationDocument(doc([{ id: 'a', messages: [] }], [...runs.slice(0, 100), { id: 'extra', threadId: 'a' }])), /at most 100 runs/);
});

test('history assets may reach 24 MiB and the in-memory document 512 MiB', () => {
  assert.equal(CONVERSATION_LIMITS.blob, 24 * 1024 * 1024);
  assert.equal(CONVERSATION_LIMITS.total, 512 * 1024 * 1024);
  assert.equal(CONVERSATION_LIMITS.threadEncoded, 16 * 1024 * 1024);
  assert.equal(clonePortablePayload({ asset: new Uint8Array(20 * 1024 * 1024) }).asset.byteLength, 20 * 1024 * 1024);
  assert.throws(() => clonePortablePayload({ asset: new Uint8Array(25 * 1024 * 1024) }), /24 MiB/);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test packages/template-editor-core/test/conversation-limits.test.js`
Expected: FAIL. The first test throws `Project history supports at most 100 runs.`, and in the second `CONVERSATION_LIMITS.blob` is `undefined`.

- [ ] **Step 3: Implement**

In `project.js`, replace line 10:

```js
const MiB = 1024 * 1024;
// runs is per dialogue; total/nodes bound the joined in-memory document; encoded bounds the legacy single-file sidecar (removed in phase 2).
export const CONVERSATION_LIMITS = Object.freeze({ threads: 100, runs: 100, messages: 500, total: 512 * MiB, encoded: 192 * MiB, nodes: 2000000, depth: 64, threadEncoded: 16 * MiB, blob: 24 * MiB });
```

In `clonePortablePayload`, replace the `Uint8Array` branch:

```js
    if (item instanceof Uint8Array) {
      if (item.byteLength > CONVERSATION_LIMITS.blob) throw new Error('Project history asset exceeds 24 MiB.');
      total += item.byteLength; return new Uint8Array(item);
    }
```

Change both `'Project history exceeds 128 MiB. Archive older dialogue snapshots before continuing.'` messages to `'Project history exceeds 512 MiB. Archive older dialogue snapshots before continuing.'`.

In `validateConversationDocument`, change the `for (const [key, limit] of …)` header to:

```js
  for (const [key, limit] of [['threads', CONVERSATION_LIMITS.threads], ['runs', CONVERSATION_LIMITS.threads * CONVERSATION_LIMITS.runs]]) {
```

Then insert the following after that loop, before `return document;`:

```js
  const perThread = new Map();
  for (const run of document.runs) if (typeof run.threadId === 'string') {
    const count = (perThread.get(run.threadId) || 0) + 1;
    if (count > CONVERSATION_LIMITS.runs) throw new Error(`A dialogue supports at most ${CONVERSATION_LIMITS.runs} runs.`);
    perThread.set(run.threadId, count);
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test packages/template-editor-core/test/conversation-limits.test.js`
Expected: PASS (2 tests)

Run: `npm test --workspace @trafficops/template-editor-core`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-core/src/project.js packages/template-editor-core/test/conversation-limits.test.js
git commit -m "feat(core): conversation limits per dialogue, 24 MiB history assets"
```

---

### Task 2: Conversation format (split and join)

**Files:**
- Create: `packages/template-editor-core/src/conversation-format.js`
- Test: `packages/template-editor-core/test/conversation-format.test.js`

Rules from the spec:
- A string in a `files` or `baselineFiles` map that is ≥ 4096 bytes in UTF-8 becomes a `utf8` blob.
- Every `Uint8Array` becomes a `bytes` blob.
- An object with string `mime` and `dataUrl` fields is an attachment. Its `dataUrl` becomes a `dataUrl` blob only if the base64 re-encodes identically; otherwise it stays inline, which keeps the round-trip lossless.
- `$trafficopsBlob` is a reserved key.
- The four snapshot fields of a run are cached under `(run.id, run.updatedAt)`. Attachment blobs are cached under `attachment.id`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test packages/template-editor-core/test/conversation-format.test.js`
Expected: FAIL with `Cannot find module '…/conversation-format.js'`

- [ ] **Step 3: Implement `conversation-format.js`**

```js
import { CONVERSATION_LIMITS } from './project.js';

/** Per-dialogue thread files whose large values live in content-addressed blobs (folder format v1). */
export const BLOB_TAG = '$trafficopsBlob';
const SNAPSHOT_KEYS = ['base', 'starting', 'checkpoint', 'result'];
const FILE_MAP_KEYS = new Set(['files', 'baselineFiles']);
const INLINE_TEXT_BYTES = 4096;
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i;
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i, SHA256 = /^[a-f0-9]{64}$/, ENCODINGS = new Set(['utf8', 'bytes', 'dataUrl']);
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);

function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function toBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
export function fromBase64(text) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateBlobRef(value) {
  if (!plain(value) || typeof value[BLOB_TAG] !== 'string' || !SHA256.test(value[BLOB_TAG])) throw new Error('Invalid conversation blob reference.');
  if (!ENCODINGS.has(value.encoding) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > CONVERSATION_LIMITS.blob) throw new Error('Invalid conversation blob reference.');
  if (value.encoding === 'dataUrl' && (typeof value.mime !== 'string' || !MIME.test(value.mime))) throw new Error('Invalid conversation blob reference.');
  return value;
}

/** Every blob hash a split value references; raw bytes are rejected (thread files are JSON). */
export function blobReferences(value, found = new Set()) {
  if (value instanceof Uint8Array) throw new Error('Dialogue files cannot contain raw bytes.');
  if (Array.isArray(value)) for (const item of value) blobReferences(item, found);
  else if (plain(value)) {
    if (Object.hasOwn(value, BLOB_TAG)) found.add(validateBlobRef(value)[BLOB_TAG]);
    else for (const child of Object.values(value)) blobReferences(child, found);
  }
  return found;
}

export function validateThreadFile(value) {
  if (!plain(value) || value.schema !== 1) throw new Error('Unsupported dialogue file schema.');
  const id = identifier(value.id, 'dialogue ID');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid dialogue revision.');
  if (!Array.isArray(value.messages) || value.messages.length > CONVERSATION_LIMITS.messages) throw new Error(`A dialogue supports at most ${CONVERSATION_LIMITS.messages} messages.`);
  if (!Array.isArray(value.runs) || value.runs.length > CONVERSATION_LIMITS.runs) throw new Error(`A dialogue supports at most ${CONVERSATION_LIMITS.runs} runs.`);
  const ids = new Set();
  for (const run of value.runs) {
    if (!plain(run)) throw new Error('Invalid conversation run.');
    const runId = identifier(run.id, 'run ID');
    if (run.threadId !== id) throw new Error('A conversation run belongs to another dialogue.');
    if (ids.has(runId)) throw new Error('Duplicate conversation run ID.');
    ids.add(runId);
  }
  if (value.createdBy !== undefined && (!plain(value.createdBy) || typeof value.createdBy.id !== 'string' || typeof value.createdBy.name !== 'string')) throw new Error('Invalid dialogue author.');
  blobReferences(value);
  if (encoder.encode(JSON.stringify(value)).byteLength > CONVERSATION_LIMITS.threadEncoded) throw new Error('A dialogue exceeds 16 MiB. Start a new dialogue or remove old results.');
  return value;
}

/** Document → thread files (runs grouped under their dialogue). Every run needs a dialogue. */
export function threadsOf(document) {
  const byId = new Map(document.threads.map(thread => [thread.id, { ...thread, schema: 1, revision: thread.revision ?? 0, runs: [] }]));
  for (const run of document.runs) {
    const thread = byId.get(run.threadId);
    if (!thread) throw new Error('A conversation run has no dialogue.');
    thread.runs.push(run);
  }
  return [...byId.values()];
}

export function documentOf(projectId, threads, revision) {
  return { schema: 1, projectId, revision, threads: threads.map(({ schema: _schema, runs: _runs, ...thread }) => thread), runs: threads.flatMap(thread => thread.runs) };
}

export function createSplitCache() { return { runs: new Map(), attachments: new Map() }; }

/** Seeds a cache from a persisted (split) thread, so the next save hashes nothing that is already stored.
 *  Seeded entries carry no bytes: their blobs are persisted by definition. */
export function seedSplitCache(cache, split) {
  for (const run of split.runs || []) if (Number.isSafeInteger(run.updatedAt)) {
    const values = {};
    for (const name of SNAPSHOT_KEYS) if (Object.hasOwn(run, name)) values[name] = run[name];
    cache.runs.set(`${run.id}\u0000${run.updatedAt}`, { values, blobs: new Map() });
  }
  (function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!plain(value) || Object.hasOwn(value, BLOB_TAG)) return;
    const ref = value.dataUrl;
    // "data:" + mime + ";base64," + base64 → the joined dataUrl length the attachment key uses.
    if (typeof value.id === 'string' && typeof value.mime === 'string' && plain(ref) && ref.encoding === 'dataUrl') cache.attachments.set(`${value.id}\u0000${13 + ref.mime.length + 4 * Math.ceil(ref.size / 3)}`, { ref, bytes: null });
    Object.values(value).forEach(visit);
  })(split);
  return cache;
}

async function reference(bytes, encoding, context, extra = {}) {
  const sha = await context.hash(bytes);
  context.blobs.set(sha, bytes);
  return { [BLOB_TAG]: sha, encoding, size: bytes.byteLength, ...extra };
}

// Attachment content is immutable per id (new attachments get a random UUID; mention ids embed a content hash),
// so id + dataUrl length is a sufficient cache key.
async function externalizeAttachment(value, context) {
  const key = typeof value.id === 'string' ? `${value.id}\u0000${value.dataUrl.length}` : null, cached = key && context.previous.attachments.get(key);
  let dataUrl = value.dataUrl;
  if (cached) { if (cached.bytes) context.blobs.set(cached.ref[BLOB_TAG], cached.bytes); dataUrl = cached.ref; }
  else {
    const match = value.dataUrl.match(DATA_URL);
    let bytes = null;
    try { bytes = match && fromBase64(match[2]); } catch { /* Not decodable: kept inline. */ }
    // Only a canonical encoding is externalized, so join restores the exact string.
    if (bytes && toBase64(bytes) === match[2]) dataUrl = await reference(bytes, 'dataUrl', context, { mime: match[1] });
  }
  if (key && typeof dataUrl !== 'string') context.next.attachments.set(key, cached || { ref: dataUrl, bytes: context.blobs.get(dataUrl[BLOB_TAG]) });
  const result = {};
  for (const [name, child] of Object.entries(value)) result[name] = name === 'dataUrl' ? dataUrl : await externalize(child, context);
  return result;
}

async function externalize(value, context, fileContent = false) {
  if (value instanceof Uint8Array) return reference(new Uint8Array(value), 'bytes', context);
  if (typeof value === 'string') {
    if (!fileContent) return value;
    const bytes = encoder.encode(value);
    return bytes.byteLength >= INLINE_TEXT_BYTES ? reference(bytes, 'utf8', context) : value;
  }
  if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await externalize(item, context)); return result; }
  if (!plain(value)) return value;
  if (Object.hasOwn(value, BLOB_TAG)) throw new Error('Reserved conversation key.');
  if (typeof value.mime === 'string' && typeof value.dataUrl === 'string') return externalizeAttachment(value, context);
  const result = {};
  for (const [name, child] of Object.entries(value)) {
    if (FILE_MAP_KEYS.has(name) && plain(child)) {
      const files = {};
      for (const [path, content] of Object.entries(child)) files[path] = await externalize(content, context, true);
      result[name] = files;
    } else result[name] = await externalize(child, context);
  }
  return result;
}

async function splitRun(run, context) {
  const key = Number.isSafeInteger(run.updatedAt) ? `${run.id}\u0000${run.updatedAt}` : null;
  let fields = key && context.previous.runs.get(key);
  if (!fields) {
    fields = { values: {}, blobs: new Map() };
    const local = { ...context, blobs: fields.blobs };
    for (const name of SNAPSHOT_KEYS) if (Object.hasOwn(run, name)) fields.values[name] = await externalize(run[name], local);
  }
  if (key) context.next.runs.set(key, fields);
  for (const [sha, bytes] of fields.blobs) context.blobs.set(sha, bytes);
  const result = {};
  for (const [name, child] of Object.entries(run)) result[name] = SNAPSHOT_KEYS.includes(name) ? fields.values[name] : await externalize(child, context);
  return result;
}

/** cache: the previous save's cache (read); nextCache: collects entries used by this save. */
export async function splitThread(thread, { cache = createSplitCache(), nextCache = createSplitCache(), hash = sha256Hex } = {}) {
  const context = { previous: cache, next: nextCache, hash, blobs: new Map() };
  const { runs = [], ...rest } = thread;
  const split = await externalize(rest, context);
  split.runs = [];
  for (const run of runs) split.runs.push(await splitRun(run, context));
  return { thread: split, blobs: context.blobs };
}

export async function threadHash(split) {
  const { revision: _revision, ...rest } = split;
  return sha256Hex(encoder.encode(canonicalJson(rest)));
}

/** getBlob(sha) → Uint8Array | Promise<Uint8Array>; calls are memoized per join. */
export async function joinThread(split, getBlob) {
  const loaded = new Map();
  const load = sha => { if (!loaded.has(sha)) loaded.set(sha, Promise.resolve(getBlob(sha))); return loaded.get(sha); };
  async function internalize(value) {
    if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await internalize(item)); return result; }
    if (!plain(value)) return value;
    if (Object.hasOwn(value, BLOB_TAG)) {
      const ref = validateBlobRef(value), bytes = await load(ref[BLOB_TAG]);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== ref.size) throw new Error('A conversation attachment is missing or damaged.');
      return ref.encoding === 'utf8' ? decoder.decode(bytes) : ref.encoding === 'dataUrl' ? `data:${ref.mime};base64,${toBase64(bytes)}` : new Uint8Array(bytes);
    }
    const result = {};
    for (const [name, child] of Object.entries(value)) result[name] = await internalize(child);
    return result;
  }
  return internalize(split);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test packages/template-editor-core/test/conversation-format.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-core/src/conversation-format.js packages/template-editor-core/test/conversation-format.test.js
git commit -m "feat(core): per-dialogue conversation format with content-addressed blobs"
```

---

### Task 3: Memory store and the store contract suite

**Files:**
- Create: `packages/template-editor-core/src/memory-conversation-store.js`
- Create: `packages/template-editor-core/src/conversation-store-contract.js`
- Test: `packages/template-editor-core/test/conversation-store.test.js`

The contract does not depend on `node:assert`, so phase 2 can run it in a browser through Playwright. It is a list of `{ name, run(createStore) }` cases. `createStore({ graceMs })` returns a fresh, empty store.

- [ ] **Step 1: Write the contract suite**

`conversation-store-contract.js`:

```js
import { BLOB_TAG, sha256Hex } from './conversation-format.js';

/** Runner-agnostic cases every ConversationStore must pass. createStore({ graceMs }) returns a fresh, empty store. */
function check(condition, message) { if (!condition) throw new Error(`Store contract: ${message}`); }
async function rejects(promise, predicate, message) {
  try { await promise; } catch (error) { check(predicate(error), `${message} (got ${error?.code || ''} ${error?.message})`); return; }
  check(false, `${message} (resolved)`);
}
const thread = (id = 't1', extra = {}) => ({ schema: 1, id, revision: 0, title: 'Dialogue', messages: [], runs: [], ...extra });
const bytes = text => new TextEncoder().encode(text);
const conflict = error => error?.code === 'conflict';

export const conversationStoreContract = [
  { name: 'writes, lists and versions a thread', async run(createStore) {
    const store = await createStore();
    check((await store.listThreads()).length === 0, 'a new store is empty');
    check((await store.writeThread(thread(), { expectedRevision: 0 })).revision === 1, 'create assigns revision 1');
    check((await store.writeThread({ ...thread(), title: 'Renamed', revision: 99 }, { expectedRevision: 1 })).revision === 2, 'the body revision is ignored');
    const [listed] = await store.listThreads();
    check(listed.id === 't1' && listed.revision === 2 && listed.title === 'Renamed', 'listThreads returns the latest thread with its revision');
  } },
  { name: 'rejects stale writes and duplicate creates as conflicts', async run(createStore) {
    const store = await createStore();
    await store.writeThread(thread(), { expectedRevision: 0 });
    await rejects(store.writeThread(thread(), { expectedRevision: 0 }), conflict, 'a second create conflicts');
    await rejects(store.writeThread(thread(), { expectedRevision: 5 }), conflict, 'a stale update conflicts');
  } },
  { name: 'deletes idempotently and with CAS', async run(createStore) {
    const store = await createStore();
    await store.deleteThread('missing', { expectedRevision: 0 });
    await store.writeThread(thread(), { expectedRevision: 0 });
    await rejects(store.deleteThread('t1', { expectedRevision: 7 }), conflict, 'a stale delete conflicts');
    await store.deleteThread('t1', { expectedRevision: 1 });
    check((await store.listThreads()).length === 0, 'the thread is deleted');
  } },
  { name: 'stores blobs idempotently and verifies their hash', async run(createStore) {
    const store = await createStore(), data = bytes('blob'), sha = await sha256Hex(data);
    await store.putBlob(sha, data); await store.putBlob(sha, data);
    check(new TextDecoder().decode(await store.getBlob(sha)) === 'blob', 'getBlob returns the stored bytes');
    await rejects(store.putBlob('0'.repeat(64), data), error => !conflict(error), 'a hash mismatch is rejected');
    await rejects(store.getBlob('f'.repeat(64)), () => true, 'a missing blob is rejected');
  } },
  { name: 'rejects threads that reference missing blobs, foreign runs or exceed limits', async run(createStore) {
    const store = await createStore();
    const ref = { [BLOB_TAG]: 'a'.repeat(64), encoding: 'bytes', size: 1 };
    await rejects(store.writeThread(thread('t1', { messages: [{ id: 'm', attachment: ref }] }), { expectedRevision: 0 }), error => !conflict(error), 'a missing blob reference is rejected');
    await rejects(store.writeThread(thread('t2', { runs: [{ id: 'r', threadId: 'other' }] }), { expectedRevision: 0 }), error => !conflict(error), 'a foreign run is rejected');
    await rejects(store.writeThread(thread('t3', { title: 'x'.repeat(16 * 1024 * 1024) }), { expectedRevision: 0 }), error => /16 MiB/.test(error.message), 'an oversize thread is rejected');
    const large = new Uint8Array(24 * 1024 * 1024 + 1);
    await rejects(store.putBlob(await sha256Hex(large), large), error => /24 MiB/.test(error.message), 'an oversize blob is rejected');
  } },
  { name: 'garbage collection keeps referenced and recent blobs', async run(createStore) {
    const kept = bytes('kept'), loose = bytes('loose'), keptSha = await sha256Hex(kept), looseSha = await sha256Hex(loose);
    const fill = async store => {
      await store.putBlob(keptSha, kept); await store.putBlob(looseSha, loose);
      await store.writeThread(thread('t1', { messages: [{ id: 'm', file: { [BLOB_TAG]: keptSha, encoding: 'bytes', size: kept.byteLength } }] }), { expectedRevision: 0 });
    };
    const patient = await createStore({ graceMs: 60 * 60 * 1000 });
    if (!patient.collectGarbage) return;
    await fill(patient); await patient.collectGarbage();
    await patient.getBlob(looseSha);
    const eager = await createStore({ graceMs: 0 });
    await fill(eager); await new Promise(resolve => setTimeout(resolve, 20)); await eager.collectGarbage();
    await eager.getBlob(keptSha);
    await rejects(eager.getBlob(looseSha), () => true, 'an old unreferenced blob is collected');
  } },
  { name: 'watchers hear committed changes', async run(createStore) {
    const store = await createStore();
    if (!store.watch) return;
    let calls = 0; const stop = store.watch(() => { calls++; });
    await store.writeThread(thread(), { expectedRevision: 0 }); await store.deleteThread('t1', { expectedRevision: 1 });
    await new Promise(resolve => setTimeout(resolve, 0)); stop();
    check(calls >= 2, 'writes and deletes notify watchers');
  } },
];
```

`conversation-store.test.js`:

```js
import test from 'node:test';
import { conversationStoreContract } from '../src/conversation-store-contract.js';
import { createMemoryConversationStore } from '../src/memory-conversation-store.js';

for (const contract of conversationStoreContract) test(`memory store: ${contract.name}`, () => contract.run(options => createMemoryConversationStore(options)));
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test packages/template-editor-core/test/conversation-store.test.js`
Expected: FAIL with `Cannot find module '…/memory-conversation-store.js'`

- [ ] **Step 3: Implement `memory-conversation-store.js`**

```js
import { ConflictError, ValidationError } from './errors.js';
import { CONVERSATION_LIMITS } from './project.js';
import { blobReferences, sha256Hex, validateThreadFile } from './conversation-format.js';

/** Reference ConversationStore. Blob refresh and GC follow the directory store's grace rules. */
export function createMemoryConversationStore({ now = Date.now, graceMs = 10 * 60 * 1000 } = {}) {
  const threads = new Map(), blobs = new Map(), watchers = new Set();
  const emit = () => { for (const watcher of [...watchers]) { try { watcher(); } catch { /* A watcher cannot break a commit. */ } } };
  return {
    async listThreads() { return [...threads.values()].map(value => structuredClone(value)); },
    async writeThread(thread, { expectedRevision }) {
      const file = validateThreadFile(structuredClone(thread)), current = threads.get(file.id)?.revision ?? 0;
      if (current !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before saving.');
      for (const sha of blobReferences(file)) if (!blobs.has(sha)) throw new ValidationError('The dialogue references a missing attachment.');
      const revision = current + 1;
      threads.set(file.id, { ...file, revision }); emit();
      return { revision };
    },
    async deleteThread(id, { expectedRevision }) {
      const current = threads.get(id);
      if (!current) return;
      if (current.revision !== expectedRevision) throw new ConflictError('The dialogue changed elsewhere. Reload before deleting it.');
      threads.delete(id); emit();
    },
    async putBlob(sha, bytes) {
      if (bytes.byteLength > CONVERSATION_LIMITS.blob) throw new Error('A conversation attachment exceeds 24 MiB.');
      if (await sha256Hex(bytes) !== sha) throw new ValidationError('The conversation attachment does not match its hash.');
      const existing = blobs.get(sha);
      if (existing) { if (now() - existing.at > graceMs / 2) existing.at = now(); return; }
      blobs.set(sha, { bytes: new Uint8Array(bytes), at: now() });
    },
    async getBlob(sha) {
      const blob = blobs.get(sha);
      if (!blob) throw new Error('A conversation attachment is missing.');
      return new Uint8Array(blob.bytes);
    },
    watch(listener) { watchers.add(listener); return () => watchers.delete(listener); },
    async collectGarbage() {
      const referenced = new Set();
      for (const thread of threads.values()) blobReferences(thread, referenced);
      for (const [sha, blob] of blobs) if (!referenced.has(sha) && now() - blob.at > graceMs) blobs.delete(sha);
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test packages/template-editor-core/test/conversation-store.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-core/src/memory-conversation-store.js packages/template-editor-core/src/conversation-store-contract.js packages/template-editor-core/test/conversation-store.test.js
git commit -m "feat(core): ConversationStore contract suite and memory store"
```

---

### Task 4: The document-shaped adapter

**Files:**
- Create: `packages/template-editor-core/src/conversation-port.js`
- Test: `packages/template-editor-core/test/conversation-port.test.js`

Required behaviour, from the spec section "Units → createConversationPort":
- **Local CAS:** if `expectedRevision !== counter`, throw `ConflictError` before any I/O.
- **Store CAS:** each thread is written with `thread.revision ?? 0`.
- **Unchanged threads:** a thread whose hash and revision are unchanged is never written.
- **Deletion:** a thread absent from the document is deleted.
- **Write order:** blobs first, then the thread.
- **Counter:** monotonic. It is bumped by a load, a successful save, a watch refresh that saw changes, and any save that fails after I/O has started. A save rejected by validation before any I/O leaves the counter unchanged, because nothing was written.
- **Queue:** load, save, refresh and GC all run through one queue.
- **GC:** runs once after the first load, and after a save that deleted threads or dropped references.
- **Missing blob:** if `writeThread` fails with `validation`, re-split the thread with every byte and re-upload all of its blobs once.
- **Validate first:** every changed thread is split and validated before any I/O, so a save over a limit writes nothing.
- **Cheap refresh:** a watch refresh first compares listed revisions and reads blobs only if something changed. The adapter's own writes therefore never trigger a re-read.
- **Seeded cache:** `load` seeds the split cache from the persisted files, so the first save after a load hashes nothing it already stored.
- **Damaged files:** a thread file that fails validation or references a missing blob is skipped. The document carries a `storageWarning`, and the file is left out of the snapshot, so it is never deleted.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoreConversationPort } from '../src/conversation-port.js';
import { createMemoryConversationStore } from '../src/memory-conversation-store.js';
import { sha256Hex } from '../src/conversation-format.js';

const big = 'y'.repeat(6000);
const png = `data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
function addThread(document, id, extra = {}) {
  document.threads.push({ id, title: id, archived: false, messages: [{ id: `${id}-m`, role: 'user', prompt: 'Go', status: 'saved', attachments: [{ id: `${id}-a`, name: 'x.png', mime: 'image/png', dataUrl: png }] }], ...extra });
  document.runs.push({ id: `${id}-r`, threadId: id, messageId: `${id}-m`, state: 'ready', updatedAt: 1, owner: { sessionId: 's', expiresAt: 1 }, base: { files: { 'index.html': big, 'logo.png': new Uint8Array([7]) } } });
  return document;
}
const port = (store, options = {}) => createStoreConversationPort(store, { projectId: 'p', ...options });

test('save then load in a fresh adapter round-trips the document, with revisions carried on threads', async () => {
  const store = createMemoryConversationStore(), a = port(store);
  const loaded = await a.load();
  assert.deepEqual([loaded.revision, loaded.threads, loaded.runs], [1, [], []]);
  const saved = await a.save(addThread(loaded, 't1'), { expectedRevision: 1 });
  assert.equal(saved.revision, 2); assert.equal(saved.threads[0].revision, 1);
  const reread = await port(store).load();
  assert.deepEqual(reread.threads, saved.threads); assert.deepEqual(reread.runs, saved.runs);
  assert.equal(JSON.stringify((await store.listThreads())[0]).includes(big), false);
});

test('a stale document is rejected locally before any I/O', async () => {
  const store = createMemoryConversationStore(), a = port(store);
  const document = await a.load();
  await assert.rejects(a.save(addThread(document, 't1'), { expectedRevision: 0 }), error => error.code === 'conflict');
  assert.equal((await store.listThreads()).length, 0);
});

test('a thread changed by another adapter fails the per-thread CAS; an untouched stale thread is not written', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  const seeded = await a.save(addThread(addThread(await a.load(), 't1'), 't2'), { expectedRevision: 1 });
  const fromB = await b.load();
  await a.save({ ...seeded, threads: seeded.threads.map(thread => thread.id === 't1' ? { ...thread, title: 'A edit' } : thread) }, { expectedRevision: seeded.revision });
  await assert.rejects(b.save({ ...fromB, threads: fromB.threads.map(thread => thread.id === 't1' ? { ...thread, title: 'B edit' } : thread) }, { expectedRevision: fromB.revision }), error => error.code === 'conflict');
  const retry = await b.load();
  const ok = await b.save({ ...retry, threads: retry.threads.map(thread => thread.id === 't2' ? { ...thread, title: 'B t2' } : thread) }, { expectedRevision: retry.revision });
  assert.deepEqual(ok.threads.map(thread => thread.title), ['A edit', 'B t2']);
});

test('a watch refresh between copy and save rejects the stale save without deleting the new thread', async () => {
  const store = createMemoryConversationStore(), a = port(store), b = port(store);
  const seen = []; a.subscribe(document => seen.push(document.revision));
  const copy = await a.load();
  await b.save(addThread(await b.load(), 'from-b'), { expectedRevision: 1 });
  await settle();
  assert.equal(seen.length, 1); assert.ok(seen[0] > copy.revision, 'the counter increases on a watch refresh');
  await assert.rejects(a.save({ ...copy, threads: [], runs: [] }, { expectedRevision: copy.revision }), error => error.code === 'conflict');
  assert.deepEqual((await store.listThreads()).map(thread => thread.id), ['from-b']);
});

test('a heartbeat-only change reaches the store without hashing any blob; a message status change also persists', async () => {
  const store = createMemoryConversationStore(); let blobHashes = 0;
  const a = port(store, { hashBlob: bytes => { blobHashes++; return sha256Hex(bytes); } });
  const saved = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const before = blobHashes;
  const beat = structuredClone(saved); beat.runs[0].owner.expiresAt = 999; beat.threads[0].messages[0].status = 'interrupted';
  await a.save(beat, { expectedRevision: saved.revision });
  assert.equal(blobHashes, before);
  const reread = await port(store).load();
  assert.equal(reread.runs[0].owner.expiresAt, 999); assert.equal(reread.threads[0].messages[0].status, 'interrupted');
});

test('removing a thread deletes it and collects its blobs', async () => {
  const store = createMemoryConversationStore({ graceMs: 0 }), a = port(store);
  const saved = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const [file] = await store.listThreads(), sha = file.runs[0].base.files['index.html'].$trafficopsBlob;
  await new Promise(resolve => setTimeout(resolve, 5));
  await a.save({ ...saved, threads: [], runs: [] }, { expectedRevision: saved.revision });
  assert.equal((await store.listThreads()).length, 0);
  await assert.rejects(store.getBlob(sha));
});

test('a watch refresh that arrives during save I/O runs after the save completes', async () => {
  const inner = createMemoryConversationStore(), gate = deferred(), order = [];
  const store = { ...inner, async writeThread(thread, options) { order.push('write'); await gate.promise; return inner.writeThread(thread, options); },
    async listThreads() { order.push('list'); return inner.listThreads(); } };
  let notify; store.watch = listener => { notify = listener; return () => {}; };
  const a = port(store); a.subscribe(() => {});
  const document = await a.load(); order.length = 0;
  const pending = a.save(addThread(document, 't1'), { expectedRevision: document.revision });
  await settle(); notify(); await settle();
  assert.deepEqual(order, ['write']);
  gate.resolve(); await pending; await settle();
  assert.deepEqual(order, ['write', 'list']);
});

test('a failed save bumps the local counter so the runtime reloads', async () => {
  const inner = createMemoryConversationStore(); let fail = true;
  const store = { ...inner, async writeThread(thread, options) { if (fail) throw new Error('disk full'); return inner.writeThread(thread, options); } };
  const a = port(store), document = await a.load();
  await assert.rejects(a.save(addThread(structuredClone(document), 't1'), { expectedRevision: 1 }), /disk full/);
  fail = false;
  await assert.rejects(a.save(addThread(structuredClone(document), 't1'), { expectedRevision: 1 }), error => error.code === 'conflict');
  const reloaded = await a.load();
  assert.equal((await a.save(addThread(reloaded, 't1'), { expectedRevision: reloaded.revision })).threads.length, 1);
});

test('the adapter’s own writes never make a watch refresh read blobs', async () => {
  const inner = createMemoryConversationStore(); let reads = 0;
  const store = { ...inner, async getBlob(sha) { reads++; return inner.getBlob(sha); } };
  const a = port(store); a.subscribe(() => {});
  const document = await a.load();
  const saved = await a.save(addThread(document, 't1'), { expectedRevision: document.revision });
  const beat = structuredClone(saved); beat.runs[0].owner.expiresAt = 2;
  await a.save(beat, { expectedRevision: saved.revision }); await settle();
  assert.equal(reads, 0);
});

test('the first save after a load hashes no blob of an untouched snapshot', async () => {
  const store = createMemoryConversationStore(), seeder = port(store);
  await seeder.save(addThread(await seeder.load(), 't1'), { expectedRevision: 1 });
  let hashes = 0; const a = port(store, { hashBlob: bytes => { hashes++; return sha256Hex(bytes); } });
  const loaded = await a.load(); loaded.runs[0].owner.expiresAt = 3;
  await a.save(loaded, { expectedRevision: loaded.revision });
  assert.equal(hashes, 0);
});

test('a save with one over-limit thread writes nothing', async () => {
  const store = createMemoryConversationStore(), a = port(store), document = addThread(await a.load(), 't1');
  // Nine 1.9 MiB messages: each passes the 2 MiB text limit of clonePortablePayload, together they exceed 16 MiB.
  document.threads.push({ id: 't2', title: 't2', archived: false, messages: Array.from({ length: 9 }, (_, index) => ({ id: `big-${index}`, role: 'user', prompt: 'x'.repeat(1.9 * 1024 * 1024) })) });
  await assert.rejects(a.save(document, { expectedRevision: document.revision }), /16 MiB/);
  assert.equal((await store.listThreads()).length, 0);
});

test('a damaged thread file is skipped with a warning and never deleted', async () => {
  const inner = createMemoryConversationStore(), deleted = [];
  const store = { ...inner, async listThreads() { return [...await inner.listThreads(), { schema: 1, id: 'bad', revision: 3, messages: 'nope', runs: [] }]; },
    async deleteThread(id, options) { deleted.push(id); return inner.deleteThread(id, options); } };
  const a = port(store), loaded = await a.load();
  assert.deepEqual(loaded.threads, []); assert.match(loaded.storageWarning, /could not be opened/);
  const saved = await a.save(addThread(loaded, 't1'), { expectedRevision: loaded.revision });
  assert.deepEqual(saved.threads.map(thread => thread.id), ['t1']); assert.deepEqual(deleted, []);
});

test('a partial multi-thread commit converges when a state-setting change is re-applied after reload', async () => {
  const inner = createMemoryConversationStore(); let failOnce = false;
  const store = { ...inner, async writeThread(thread, options) {
    if (thread.id === 't2' && failOnce) { failOnce = false; throw Object.assign(new Error('Concurrent write'), { code: 'conflict' }); }
    return inner.writeThread(thread, options);
  } };
  const a = port(store), seeded = await a.save(addThread(addThread(await a.load(), 't1'), 't2'), { expectedRevision: 1 });
  failOnce = true;
  const interrupt = document => { for (const run of document.runs) run.state = 'interrupted'; return document; };
  await assert.rejects(a.save(interrupt(structuredClone(seeded)), { expectedRevision: seeded.revision }), error => error.code === 'conflict');
  const reloaded = await a.load();
  assert.deepEqual(reloaded.runs.map(run => run.state), ['interrupted', 'ready']);
  const saved = await a.save(interrupt(reloaded), { expectedRevision: reloaded.revision });
  assert.deepEqual(saved.runs.map(run => run.state), ['interrupted', 'interrupted']);
});

test('a blob collected after another window dropped it is re-uploaded on the next write', async () => {
  const store = createMemoryConversationStore({ graceMs: 0 }), a = port(store), b = port(store);
  const fromA = await a.save(addThread(await a.load(), 't1'), { expectedRevision: 1 });
  const sha = (await store.listThreads())[0].runs[0].base.files['index.html'].$trafficopsBlob, fromB = await b.load();
  await new Promise(resolve => setTimeout(resolve, 5));
  await b.save({ ...fromB, threads: [], runs: [] }, { expectedRevision: fromB.revision });
  await assert.rejects(store.getBlob(sha));
  const saved = await a.save(addThread(structuredClone(fromA), 't2'), { expectedRevision: fromA.revision });
  assert.ok(saved.threads.some(thread => thread.id === 't2'));
  assert.equal((await store.getBlob(sha)).byteLength, 6000);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test packages/template-editor-core/test/conversation-port.test.js`
Expected: FAIL with `Cannot find module '…/conversation-port.js'`

- [ ] **Step 3: Implement `conversation-port.js`**

```js
import { ConflictError } from './errors.js';
import { CONVERSATION_LIMITS, validateConversationDocument } from './project.js';
import { blobReferences, createSplitCache, documentOf, joinThread, seedSplitCache, sha256Hex, splitThread, threadHash, threadsOf, validateThreadFile } from './conversation-format.js';

/**
 * host.conversations over any ConversationStore. The runtime keeps one document; the store keeps one file per dialogue.
 * Two-level CAS: a local counter (document.revision) rejects stale same-window copies before I/O, and each thread
 * carries its store revision (thread.revision) so a stale thread fails the store's compare-and-swap.
 */
export function createStoreConversationPort(store, { projectId, hashBlob = sha256Hex } = {}) {
  validateConversationDocument({ schema: 1, projectId, revision: 0, threads: [], runs: [] }, projectId);
  // snapshot: valid persisted threads (id → { revision, hash, refs }); listed: every listed file's revision, damaged ones included.
  let counter = 0, snapshot = new Map(), listed = new Map(), cache = createSplitCache(), warning, queue = Promise.resolve(), collected = false, unwatch = null;
  const listeners = new Set();
  const serial = operation => { const task = queue.catch(() => {}).then(operation); queue = task; return task; };
  const notify = document => { for (const listener of [...listeners]) { try { listener(structuredClone(document)); } catch { /* A detached view. */ } } };
  const publishDocument = threads => ({ ...documentOf(projectId, threads, ++counter), ...(warning ? { storageWarning: warning } : {}) });
  const collect = () => store.collectGarbage ? store.collectGarbage().catch(() => {}) : undefined;

  async function read(files) {
    const blobs = new Map(), threads = [], next = new Map(), seeded = createSplitCache(), skipped = [];
    const getBlob = sha => { if (!blobs.has(sha)) blobs.set(sha, store.getBlob(sha)); return blobs.get(sha); };
    for (const file of files) {
      try {
        validateThreadFile(file);
        threads.push(await joinThread(file, getBlob));
        next.set(file.id, { revision: file.revision, hash: await threadHash(file), refs: blobReferences(file) });
        seedSplitCache(seeded, file);
      } catch (error) { skipped.push(`${typeof file?.id === 'string' ? file.id : 'unknown'}: ${error.message}`); }
    }
    // A damaged file stays out of the snapshot, so no save ever deletes it.
    listed = new Map(files.map(file => [file?.id, file?.revision])); snapshot = next; cache = seeded;
    warning = skipped.length ? `Some dialogues could not be opened and were left untouched (${skipped.join('; ').slice(0, 1000)}).` : undefined;
    return publishDocument(threads);
  }

  function load() {
    return serial(async () => {
      const document = await read(await store.listThreads());
      if (!collected) { collected = true; await collect(); }
      return structuredClone(document);
    });
  }

  function refresh() {
    return serial(async () => {
      const files = await store.listThreads();
      if (files.length === listed.size && files.every(file => listed.get(file?.id) === file?.revision)) return;
      notify(await read(files));
    }).catch(() => {});
  }

  function save(document, { expectedRevision = document.revision } = {}) {
    return serial(async () => {
      if (expectedRevision !== counter) throw new ConflictError('Conversation history changed in another window. Reload the dialogue before saving.');
      const threads = threadsOf(validateConversationDocument(document, projectId));
      if (threads.length > CONVERSATION_LIMITS.threads) throw new Error(`Project history supports at most ${CONVERSATION_LIMITS.threads} dialogues.`);
      const nextCache = createSplitCache(), next = new Map(), changes = [], persisted = new Set([...snapshot.values()].flatMap(entry => [...entry.refs]));
      // Split and validate every changed thread before any I/O, so an over-limit save writes nothing.
      for (const thread of threads) {
        const parts = await splitThread(thread, { cache, nextCache, hash: hashBlob });
        const hash = await threadHash(parts.thread), known = snapshot.get(thread.id), expected = thread.revision ?? 0;
        if (known && known.hash === hash && known.revision === expected) { next.set(thread.id, known); continue; }
        validateThreadFile(parts.thread);
        changes.push({ thread, parts, hash, known, expected });
      }
      const removed = [...snapshot].filter(([id]) => !threads.some(thread => thread.id === id));
      let dropped = removed.length > 0;
      try {
        for (const { thread, parts, hash, known, expected } of changes) {
          const write = async ({ thread: split, blobs }, everything) => {
            for (const [sha, bytes] of blobs) if (everything || !persisted.has(sha)) await store.putBlob(sha, bytes);
            return store.writeThread(split, { expectedRevision: expected });
          };
          // A blob believed persisted may have been collected after another window dropped it: re-split with every byte, retry once.
          const { revision } = await write(parts, false).catch(async error => { if (error?.code !== 'validation') throw error; return write(await splitThread(thread, { hash: hashBlob }), true); });
          const refs = blobReferences(parts.thread);
          if (known && [...known.refs].some(sha => !refs.has(sha))) dropped = true;
          next.set(thread.id, { revision, hash, refs }); listed.set(thread.id, revision); thread.revision = revision;
        }
        for (const [id, known] of removed) { await store.deleteThread(id, { expectedRevision: known.revision }); listed.delete(id); }
      } catch (error) { counter++; throw error; }
      cache = nextCache; snapshot = next;
      const saved = publishDocument(threads);
      notify(saved);
      if (dropped) await collect();
      return structuredClone(saved);
    });
  }

  return {
    projectId, load, save,
    subscribe(listener) {
      listeners.add(listener);
      if (!unwatch && store.watch) unwatch = store.watch(() => { void refresh(); });
      return () => { listeners.delete(listener); if (!listeners.size && unwatch) { unwatch(); unwatch = null; } };
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test packages/template-editor-core/test/conversation-port.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-core/src/conversation-port.js packages/template-editor-core/test/conversation-port.test.js
git commit -m "feat(core): document-shaped conversation port over a ConversationStore"
```

---

### Task 5: Exports and types

**Files:**
- Modify: `packages/template-editor-core/src/index.js`
- Modify: `packages/template-editor-core/package.json` (`exports`)
- Modify: `packages/template-editor-core/contract.d.ts`, in two places: after the `ConversationPort` interface (line 52) and after the `validateConversationDocument` declaration (line 145)

- [ ] **Step 1: Add the exports**

Append to `src/index.js`:

```js
export * from './conversation-format.js';
export * from './conversation-port.js';
export * from './memory-conversation-store.js';
```

The contract suite stays off the main entry. Add this line to `package.json` `exports`:

```json
    "./conversation-store-contract": "./src/conversation-store-contract.js",
```

- [ ] **Step 2: Add the types**

After the `ConversationPort` interface in `contract.d.ts`:

```ts
/** One dialogue file of folder format v1; large values are { $trafficopsBlob, encoding, size, mime? } references. */
export interface ConversationThreadFile { schema: 1; id: string; revision: number; title?: string; updatedAt?: number; createdBy?: { id: string; name: string }; messages: ConversationEntry[]; runs: ConversationEntry[]; [key: string]: any }
export interface ConversationStore {
  listThreads(options?: { signal?: AbortSignal }): Promise<ConversationThreadFile[]>;
  /** expectedRevision 0 creates; a mismatch rejects with ConflictError. The body revision is ignored. */
  writeThread(thread: ConversationThreadFile, options: { expectedRevision: number; signal?: AbortSignal }): Promise<{ revision: number }>;
  /** A missing thread resolves. */
  deleteThread(id: string, options: { expectedRevision: number; signal?: AbortSignal }): Promise<void>;
  putBlob(sha256: string, bytes: Uint8Array, options?: { signal?: AbortSignal }): Promise<void>;
  getBlob(sha256: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  watch?(onChange: () => void): () => void;
  /** References are computed from persisted threads; unreferenced blobs inside the grace period are kept. */
  collectGarbage?(options?: { signal?: AbortSignal }): Promise<void>;
}
```

Replace the `CONVERSATION_LIMITS` declaration (line 143) with:

```ts
export const CONVERSATION_LIMITS: Readonly<{ threads: number; runs: number; messages: number; total: number; nodes: number; depth: number; encoded: number; threadEncoded: number; blob: number }>;
```

After the `validateConversationDocument` declaration:

```ts
export const BLOB_TAG: '$trafficopsBlob';
export interface ConversationSplitCache { readonly runs: Map<string, unknown>; readonly attachments: Map<string, unknown> }
export function createSplitCache(): ConversationSplitCache;
export function seedSplitCache(cache: ConversationSplitCache, thread: ConversationThreadFile): ConversationSplitCache;
export function threadsOf(document: ConversationDocument): ConversationThreadFile[];
export function documentOf(projectId: string, threads: ConversationThreadFile[], revision: number): ConversationDocument;
export function threadHash(thread: ConversationThreadFile): Promise<string>;
export function sha256Hex(bytes: Uint8Array): Promise<string>;
export function blobReferences(value: unknown, found?: Set<string>): Set<string>;
export function validateBlobRef<T>(value: T): T;
export function toBase64(bytes: Uint8Array): string;
export function fromBase64(text: string): Uint8Array;
export function canonicalJson(value: unknown): string;
// The './conversation-store-contract' subpath is test tooling and stays untyped (JS only).
export function createStoreConversationPort(store: ConversationStore, options: { projectId: string; hashBlob?: (bytes: Uint8Array) => Promise<string> }): ConversationPort;
export function createMemoryConversationStore(options?: { now?: () => number; graceMs?: number }): ConversationStore;
export function splitThread(thread: ConversationThreadFile, options?: { cache?: ConversationSplitCache; nextCache?: ConversationSplitCache; hash?: (bytes: Uint8Array) => Promise<string> }): Promise<{ thread: ConversationThreadFile; blobs: Map<string, Uint8Array> }>;
export function joinThread(thread: ConversationThreadFile, getBlob: (sha256: string) => Uint8Array | Promise<Uint8Array>): Promise<ConversationThreadFile>;
export function validateThreadFile(value: unknown): ConversationThreadFile;
```

- [ ] **Step 3: Verify**

Run: `npm test --workspace @trafficops/template-editor-core && npm run check --workspace @trafficops/template-editor-core`
Expected: all PASS; `node --check` prints nothing

Run: `node -e "import('@trafficops/template-editor-core').then(m => console.log(typeof m.createStoreConversationPort, typeof m.createMemoryConversationStore))"`
Expected: `function function`

- [ ] **Step 4: Commit**

```bash
git add packages/template-editor-core/src/index.js packages/template-editor-core/package.json packages/template-editor-core/contract.d.ts
git commit -m "feat(core): export the conversation store contract and adapter"
```

---

## Chunk 2: Runtime changes

All edits are in `packages/template-editor-shell/src/conversation-runtime.js` and `packages/template-editor-shell/test/conversation-runtime.test.js`. Line numbers refer to the file before this chunk; locate the code by its content as well.

To run all shell tests: `npm test --workspace @trafficops/template-editor-shell`

### Task 6: Strictly increasing `run.updatedAt`

**Why:** the adapter caches snapshot splits under `(run.id, run.updatedAt)`. Without this change, two snapshot mutations in the same millisecond would share a cache key.

- [ ] **Step 1: Write the failing test** (append it to `conversation-runtime.test.js`)

```js
test('run updatedAt strictly increases whenever a run changes, even with a frozen clock', async t => {
  const local = fixture('frozen-clock');
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', now: () => 1000, workflows: basicWorkflows(async options => {
    options.onProgress({ type: 'file-set', path: 'style.css', files: { ...options.files, 'style.css': 'blue' }, values: options.values });
    return { files: { ...options.files, 'style.css': 'blue' }, values: options.values, valid: true, summary: 'Done' };
  }) });
  t.after(() => session.dispose()); await session.ready;
  await session.submit({ prompt: 'Edit', snapshot: state() });
  await until(() => local.read().runs[0]?.state === 'ready');
  const before = session.getSnapshot().runs[0].updatedAt;
  await session.markApplied(session.getSnapshot().runs[0].id, 4);
  assert.ok(local.read().runs[0].updatedAt > before, 'markApplied bumps updatedAt');
  const seen = local.saved.map(document => document.runs[0]).filter(Boolean);
  for (let index = 1; index < seen.length; index++) {
    const { owner: _before, updatedAt: before, ...previous } = seen[index - 1], { owner: _after, updatedAt: after, ...current } = seen[index];
    if (JSON.stringify(previous) !== JSON.stringify(current)) assert.ok(after > before, `save ${index}: updatedAt ${after} must exceed ${before}`);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test --test-name-pattern="frozen clock" packages/template-editor-shell/test/conversation-runtime.test.js`
Expected: FAIL with `markApplied bumps updatedAt`. That assertion runs first; without it the loop fails with `updatedAt 1000 must exceed 1000`.

- [ ] **Step 3: Implement**

Inside `createConversationSession`, right after `function report(error) { … }` (line 240), add:

```js
  // Strictly increasing per run: the conversation store caches snapshot splits under (run.id, updatedAt).
  const touch = run => { run.updatedAt = Math.max(now(), (Number.isSafeInteger(run.updatedAt) ? run.updatedAt : 0) + 1); };
```

Replace each **run** timestamp write with `touch(…)`. Thread timestamps (`thread.updatedAt`, `target.updatedAt`) stay as they are.

| Line | Before | After |
|---|---|---|
| 269 (`recoverOrphans`) | `run.updatedAt = now();` | `touch(run);` |
| 335 (`ownedMutation`) | `change(current, next); current.updatedAt = now();` | `change(current, next); touch(current);` |
| 349 (run start) | `current.updatedAt = now()` | `touch(current)` |
| 648 (`stop`) | `current.updatedAt = now();` | `touch(current);` |
| 659 (`discard`) | `run.updatedAt = now()` | `touch(run)` |
| 665 (`markApplied`) | `run.updatedAt = now();` | `touch(run);` |
| 666 (`reconcileApplied`) | `run.updatedAt = now()` | `touch(run)` |

Check that no run write remains: `grep -n "updatedAt = now()" packages/template-editor-shell/src/conversation-runtime.js` should show only `thread.updatedAt` / `target.updatedAt` lines. The `createdAt: now(), updatedAt: now()` literals of newly created runs and threads are also expected.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test --workspace @trafficops/template-editor-shell`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-shell/src/conversation-runtime.js packages/template-editor-shell/test/conversation-runtime.test.js
git commit -m "fix(shell): run updatedAt strictly increases per run"
```

---

### Task 7: The run limit applies per dialogue

**Depends on Chunk 1, Task 1.** The runtime test fixture validates every save with the core `validateConversationDocument`. Without the per-dialogue limit there, 101 runs fail with `Project history supports at most 100 runs.`

- [ ] **Step 1: Write the failing test** (append it to `conversation-runtime.test.js`)

```js
test('the run limit applies per dialog, not per project', async t => {
  const runs = Array.from({ length: 100 }, (_, index) => ({ id: `run-${index}`, threadId: 'full', messageId: 'message', state: 'ready', createdAt: 1, updatedAt: 1 }));
  const local = fixture('run-limit', { schema: 1, projectId: 'run-limit', revision: 0, threads: [{ id: 'full', title: 'Full', archived: false, messages: [{ id: 'message', role: 'user', prompt: 'Earlier' }] }], runs }), wait = deferred();
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => wait.promise) });
  t.after(() => { wait.resolve(); session.dispose(); }); await session.ready;
  await assert.rejects(session.submit({ threadId: 'full', prompt: 'One more', snapshot: state() }), /AI run limit/);
  const threadId = await session.submit({ prompt: 'New dialog', snapshot: state() });
  assert.equal(session.getSnapshot().runs.filter(run => run.threadId === threadId).length, 1);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test --test-name-pattern="per dialog" packages/template-editor-shell/test/conversation-runtime.test.js`
Expected: FAIL. The second `submit` rejects with `The project has reached its AI run limit`.

- [ ] **Step 3: Implement**

In `assertRoom` (line 518), replace:

```js
    if (next.runs.length >= 100) throw new Error('The project has reached its AI run limit. Export a backup before removing old results.');
```

with:

```js
    if (next.runs.filter(run => run.threadId === thread.id).length >= 100) throw new Error('This dialog has reached its AI run limit. Start a new dialog.');
```

In `submit` (line 615), replace the same `next.runs.length >= 100` line with:

```js
        if (next.runs.filter(run => run.threadId === threadId).length >= 100) throw new Error('This dialog has reached its AI run limit. Start a new dialog.');
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test --workspace @trafficops/template-editor-shell`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-shell/src/conversation-runtime.js packages/template-editor-shell/test/conversation-runtime.test.js
git commit -m "fix(shell): AI run limit is per dialog"
```

---

### Task 8: `queueInitialRequest` replaces `migrateLegacy`

`migrateLegacy` (lines 273–309) does two jobs:
- It imports `ai.recovery`. That is legacy and is removed.
- It handles the `initial.autoStart` kickoff. That is kept, with deterministic, filename-safe ids.

- [ ] **Step 1: Write the failing tests**

Two tests cover the removed `ai.recovery` import. Delete both:
- `'legacy recovery keeps the user clarifications for the continuation'` in `conversation-runtime.test.js`, around line 395.
- `'legacy selected-block recovery migrates its immutable baseline and scope rather than project mode'` in `packages/template-editor-shell/test/conversation-block-runtime.test.js:87-96`. Keep that file's imports: `blockScopeFiles` is still used at line 35.

Then append to `conversation-runtime.test.js`:

```js
test('an initial request becomes one deterministic dialog even when two windows open the project', async t => {
  const local = fixture('initial-twice', { schema: 1, projectId: 'initial-twice', revision: 0, threads: [], runs: [] }), wait = deferred(); let claims = 0;
  local.host.ai.initialRequest = { id: 'brief-1', prompt: 'Create a ceramics landing', mode: 'create', autoStart: true, attachments: [], claim: async () => { claims++; return claims === 1; } };
  const workflows = basicWorkflows(() => wait.promise);
  const first = createConversationSession(local.host, { locks: null, sessionId: 'one', workflows }), second = createConversationSession(local.host, { locks: null, sessionId: 'two', workflows });
  t.after(() => { wait.resolve(); first.dispose(); second.dispose(); });
  await Promise.all([first.ready, second.ready]);
  const saved = local.read();
  assert.equal(saved.threads.length, 1); assert.equal(saved.runs.length, 1);
  assert.match(saved.threads[0].id, /^initial-thread-[^:]+$/); assert.match(saved.runs[0].id, /^initial-run-[^:]+$/);
  assert.equal(saved.runs[0].initialClaim, 'brief-1'); assert.equal(Object.hasOwn(saved, 'legacyMigrated'), false);
});

test('an already claimed initial request fails instead of generating twice', async t => {
  const local = fixture('initial-claimed', { schema: 1, projectId: 'initial-claimed', revision: 0, threads: [], runs: [] });
  local.host.ai.initialRequest = { id: 'brief-2', prompt: 'Create', mode: 'create', autoStart: true, claim: async () => false };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail('No provider call')) });
  t.after(() => session.dispose()); await session.ready;
  await until(() => session.getSnapshot().runs[0]?.state === 'failed');
  assert.match(session.getSnapshot().runs[0].error, /already started/);
});

test('an initial request queued by a window that died before claiming is not created again', async t => {
  const runId = 'initial-run-earlier', initial = { schema: 1, projectId: 'initial-crashed', revision: 0,
    threads: [{ id: 'initial-thread-earlier', title: 'Create', archived: false, messages: [{ id: 'initial-message-earlier', role: 'user', prompt: 'Create', status: 'saved' }] }],
    runs: [{ id: runId, threadId: 'initial-thread-earlier', messageId: 'initial-message-earlier', state: 'queued', phase: 'queued', initialClaim: 'brief-3', owner: { sessionId: 'dead', fence: 0, expiresAt: 0 }, scope: { kind: 'project' }, createdAt: 1, updatedAt: 1 }] };
  const local = fixture('initial-crashed', initial);
  local.host.ai.initialRequest = { id: 'brief-3', prompt: 'Create', mode: 'create', autoStart: true, claim: async () => true };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', workflows: basicWorkflows(() => assert.fail('No provider call')) });
  t.after(() => session.dispose()); await session.ready;
  assert.deepEqual(local.read().runs.map(run => [run.id, run.state]), [[runId, 'interrupted']]);
});

test('two windows over one conversation store queue one initial request dialog', async t => {
  const store = createMemoryConversationStore(), wait = deferred(), workflows = basicWorkflows(() => wait.promise);
  const open = sessionId => {
    const local = fixture('shared-store');
    local.host.conversations = createStoreConversationPort(store, { projectId: 'shared-store' });
    local.host.ai.initialRequest = { id: 'brief-4', prompt: 'Create', mode: 'create', autoStart: true, claim: async () => true };
    local.host.ai.begin = () => wait.promise.then(() => ({ apiKey: 'k', model: 'test/model', imageModel: '' }));
    return createConversationSession(local.host, { locks: null, sessionId, workflows });
  };
  const first = open('one'), second = open('two');
  t.after(() => { wait.resolve(); first.dispose(); second.dispose(); });
  await Promise.all([first.ready, second.ready]);
  const threads = await store.listThreads();
  assert.equal(threads.length, 1); assert.equal(threads[0].runs.length, 1);
});
```

Extend the existing core import at the top of `conversation-runtime.test.js` (line 3):

```js
import { createMemoryConversationStore, createStoreConversationPort, validateConversationDocument } from '@trafficops/template-editor-core';
```

- [ ] **Step 2: Run them and check which fail**

Run: `node --test --test-name-pattern="initial request" packages/template-editor-shell/test/conversation-runtime.test.js`
Expected:
- `'…becomes one deterministic dialog…'` FAILS: its ids start with `legacy-`, and `legacyMigrated` is present.
- `'…died before claiming…'` FAILS: `migrateLegacy` deduplicates by the `legacy-run-<hash>` id, not by `initialClaim`, so it adds a second queued run.
- `'…already claimed…'` and `'two windows over one conversation store…'` already PASS. They are regression guards: the second relies on the adapter's per-thread CAS from Chunk 1.

- [ ] **Step 3: Implement**

Replace the whole `async function migrateLegacy() { … }` (lines 273–309) with:

```js
  // A host-provided creation brief becomes one queued run. Ids derive from the brief, so two windows
  // opening the same new project create the same dialogue file and the second create loses the CAS.
  async function queueInitialRequest() {
    const initial = host.ai?.initialRequest;
    if (!initial?.autoStart || doc.runs.some(run => run.initialClaim === initial.id)) return;
    const key = conversationContentHash(initial.id).replace(/:/g, '-');
    const threadId = `initial-thread-${key}`, messageId = `initial-message-${key}`, runId = `initial-run-${key}`;
    const state = await host.project.open(), locale = state.locale, base = snapshotOf(state, locale);
    base.projectId = doc.projectId;
    await mutate(next => {
      if (next.runs.some(run => run.initialClaim === initial.id)) return false;
      let thread = next.threads.find(value => value.id === threadId);
      if (!thread) next.threads.push(thread = { id: threadId, title: String(initial.prompt || 'New project').slice(0, 80), createdAt: now(), updatedAt: now(), archived: false, messages: [] });
      if (!thread.messages.some(message => message.id === messageId)) thread.messages.push({ id: messageId, role: 'user', prompt: initial.prompt, parts: [{ type: 'text', text: initial.prompt }], attachments: clone(initial.attachments || []), mentions: [], createdAt: now(), status: 'saved' });
      next.runs.push({ id: runId, threadId, messageId, attempt: 0, owner: { sessionId, fence: 0, expiresAt: now() + leaseMs }, state: 'queued', phase: 'queued', base, locale, scope: { kind: 'project' }, mode: initial.mode,
        generateImages: initial.generateImages, initialClaim: initial.id, createdAt: now(), updatedAt: now(), clarifications: [] });
    });
  }
```

In the `ready` IIFE (line 312), replace `await recoverOrphans(); await migrateLegacy();` with `await recoverOrphans(); await queueInitialRequest();`.

Keep the imports of `validateBlockEditScope`, `storedResult` and `readSetOf`: `execute` and the block-scope paths still use them. Then run `grep -n "recovery" packages/template-editor-shell/src/conversation-runtime.js`; only provider-recovery references should remain.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test --workspace @trafficops/template-editor-shell`
Expected: all PASS, including the existing `'an initial creation without optional image settings persists its brief before missing credentials'`.

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-shell/src/conversation-runtime.js packages/template-editor-shell/test/conversation-runtime.test.js packages/template-editor-shell/test/conversation-block-runtime.test.js
git commit -m "refactor(shell): queueInitialRequest replaces legacy migration with deterministic ids"
```

---

### Task 9: Quiet heartbeat-tick conflicts

- [ ] **Step 1: Write the failing test** (append it to `conversation-runtime.test.js`)

```js
test('heartbeat-tick conflicts stay quiet for two ticks and report on the third', async t => {
  const local = fixture('quiet-heartbeat'), wait = deferred(); let conflicts = 0;
  const save = local.host.conversations.save, withoutOwners = document => JSON.stringify({ threads: document.threads, runs: document.runs.map(({ owner: _owner, ...run }) => run) });
  local.host.conversations.save = async (next, options) => {
    const current = local.read();
    if (current.runs[0]?.state === 'running' && withoutOwners(next) === withoutOwners(current)) { conflicts++; throw Object.assign(new Error('Concurrent heartbeat'), { code: 'conflict' }); }
    return save(next, options);
  };
  const session = createConversationSession(local.host, { locks: null, sessionId: 'owner', leaseMs: 60, workflows: basicWorkflows(() => wait.promise) });
  t.after(() => { wait.resolve(); session.dispose(); }); await session.ready;
  await session.submit({ prompt: 'Edit', snapshot: state() }); await until(() => local.connections.length === 1);
  await until(() => conflicts >= 8);
  assert.equal(session.getSnapshot().error, undefined);
  await until(() => /Concurrent heartbeat/.test(session.getSnapshot().error || ''));
});
```

Each heartbeat `mutate` makes 4 attempts, so 8 conflicts mean two missed ticks. With `leaseMs: 60`, the tick interval is 20 ms.

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test --test-name-pattern="heartbeat-tick" packages/template-editor-shell/test/conversation-runtime.test.js`
Expected: FAIL. `error` is set after the first tick.

- [ ] **Step 3: Implement**

Directly above `const heartbeat = setInterval(` (line 316), add:

```js
  // Routine heartbeat conflicts with other windows retry on the next tick; the lease (3 ticks) covers two misses.
  let leaseMisses = 0, orphanMisses = 0;
  const quietly = (error, misses) => { if (error?.code !== 'conflict' || misses >= 3) report(error); };
```

Replace the two heartbeat calls. This line:

```js
    if (owned.length) void mutate(next => { for (const run of next.runs) if (owned.includes(run.id) && active(run) && run.owner?.sessionId === sessionId) run.owner.expiresAt = now() + leaseMs; }).catch(report);
```

becomes:

```js
    if (owned.length) void mutate(next => { for (const run of next.runs) if (owned.includes(run.id) && active(run) && run.owner?.sessionId === sessionId) run.owner.expiresAt = now() + leaseMs; })
      .then(() => { leaseMisses = 0; }, error => quietly(error, ++leaseMisses));
```

And `void recoverOrphans().catch(report);` becomes:

```js
    void recoverOrphans().then(() => { orphanMisses = 0; }, error => quietly(error, ++orphanMisses));
```

Leave `ready.catch(report)` and the `await recoverOrphans()` call inside `ready` unchanged. Only the heartbeat tick becomes quiet.

Known and accepted: once the 3rd miss reports, the next tick's conflict reload in `mutate` (line 253) replaces `doc`, so `doc.error` can disappear until the following report. This is no worse than today, where every tick reported. The test polls every 5 ms and catches the reported state.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test --workspace @trafficops/template-editor-shell`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/template-editor-shell/src/conversation-runtime.js packages/template-editor-shell/test/conversation-runtime.test.js
git commit -m "fix(shell): heartbeat conflicts retry quietly for two ticks"
```

---

### Task 10: Phase verification

- [ ] **Step 1: Run the affected workspaces**

```bash
npm test --workspace @trafficops/template-editor-core
npm test --workspace @trafficops/template-editor-shell
npm test --workspace @trafficops/template-studio
```

Expected: all PASS. In this phase Studio still uses its IndexedDB conversation port. There are two behaviour changes, both intended by the spec:
- `host.ai.recovery` is no longer read.
- An `initialRequest` with `autoStart: false` (LibraryHost when `aiStarted`) no longer gets a thread containing only the brief. `editor/test/durable-ai-recovery-browser.mjs` is a Playwright test, not part of `npm test`; it is expected to break and is removed in phase 2.

- [ ] **Step 2: Confirm the runtime has no legacy references**

Run: `grep -n "legacyMigrated\|legacy-run\|legacy-message\|ai?.recovery\|ai.recovery" packages/template-editor-shell/src/conversation-runtime.js`
Expected: no output

- [ ] **Step 3: Hand off**

Phase 1 is done when all three workspaces pass. The next plan is phase 2, Studio storage: `editor/src/storage/*`, a directory store that passes `conversationStoreContract` in a browser, and the folder-first flows. When writing the directory store, note that thread ids become file names, so `{threadId}.json` must encode the ids (`encodeURIComponent`).
