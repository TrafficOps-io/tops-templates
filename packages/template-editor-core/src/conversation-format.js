import { CONVERSATION_LIMITS } from './project.js';

/** Per-dialogue thread files whose large values live in content-addressed blobs (folder format v1). */
export const BLOB_TAG = '$trafficopsBlob';
const SNAPSHOT_KEYS = ['base', 'starting', 'checkpoint', 'result'];
const FILE_MAP_KEYS = new Set(['files', 'baselineFiles']);
const INLINE_TEXT_BYTES = 4096;
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i;
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i, SHA256 = /^[a-f0-9]{64}$/, ENCODINGS = new Set(['utf8', 'bytes', 'dataUrl']);
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const put = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);

function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
// Synchronous SHA-256 (FIPS 180-4) for short inputs such as dialogue ids, where an async digest would force every
// ZIP read and write to be async. Blobs keep using sha256Hex.
const K = Uint32Array.from('428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'.split(' '), word => parseInt(word, 16));
function sha256HexSync(bytes) {
  const length = bytes.length, padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64), view = new DataView(padded.buffer);
  padded.set(bytes); padded[length] = 0x80;
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000)); view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const hash = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19), w = new Uint32Array(64);
  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));
  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index++) w[index] = view.getUint32(block + index * 4);
    for (let index = 16; index < 64; index++) {
      const a = w[index - 15], b = w[index - 2];
      w[index] = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) + w[index - 7] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[index - 16];
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[index] + w[index]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] += a; hash[1] += b; hash[2] += c; hash[3] += d; hash[4] += e; hash[5] += f; hash[6] += g; hash[7] += h;
  }
  return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
}
const READABLE_ID = /^[a-z0-9_-]{1,200}$/;
/** A dialogue's file name in `.trafficops/conversations/`, shared by folders and editable ZIPs: lowercase-safe ids stay
 *  readable, anything else is `~<sha256 of the UTF-8 id>.json`, so names never collide on case-insensitive file systems. */
export function conversationThreadFileName(id) {
  return READABLE_ID.test(id) ? `${id}.json` : `~${sha256HexSync(encoder.encode(id))}.json`;
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
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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
  if (value.title !== undefined && typeof value.title !== 'string') throw new Error('Invalid dialogue title.');
  if (value.updatedAt !== undefined && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0)) throw new Error('Invalid dialogue timestamp.');
  for (const message of value.messages) { if (!plain(message)) throw new Error('Invalid conversation message.'); identifier(message.id, 'message ID'); }
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
    if (typeof value.id === 'string' && typeof value.mime === 'string' && plain(ref) && ref.encoding === 'dataUrl') cache.attachments.set(`${value.id}\u0000${value.mime}\u0000${13 + ref.mime.length + 4 * Math.ceil(ref.size / 3)}`, { ref, bytes: null });
    Object.values(value).forEach(visit);
  })(split);
  return cache;
}

function reference(bytes, encoding, context, extra = {}) {
  const ref = { [BLOB_TAG]: '', encoding, size: bytes.byteLength, ...extra };
  context.jobs.push({ ref, bytes, sinks: context.sink ? [context.blobs, context.sink] : [context.blobs] });
  return ref;
}

// Attachment content is immutable per id (new attachments get a random UUID; mention ids embed a content hash),
// so id + mime + dataUrl length is a sufficient cache key.
function externalizeAttachment(value, context) {
  const key = typeof value.id === 'string' ? `${value.id}\u0000${value.mime}\u0000${value.dataUrl.length}` : null, cached = key && context.previous.attachments.get(key);
  let dataUrl = value.dataUrl, entry = cached || null;
  if (cached) { if (cached.bytes) context.blobs.set(cached.ref[BLOB_TAG], cached.bytes); dataUrl = cached.ref; }
  else {
    const match = value.dataUrl.match(DATA_URL);
    let bytes = null;
    try { bytes = match && fromBase64(match[2]); } catch { /* Not decodable: kept inline. */ }
    // Only a canonical encoding is externalized, so join restores the exact string.
    if (bytes && toBase64(bytes) === match[2]) { dataUrl = reference(bytes, 'dataUrl', context, { mime: match[1] }); entry = { ref: dataUrl, bytes }; }
  }
  if (key && entry) context.next.attachments.set(key, entry);
  const result = {};
  for (const [name, child] of Object.entries(value)) put(result, name, name === 'dataUrl' ? dataUrl : externalize(child, context));
  return result;
}

function externalize(value, context, fileContent = false) {
  if (value instanceof Uint8Array) return reference(new Uint8Array(value), 'bytes', context);
  if (typeof value === 'string') {
    if (!fileContent) return value;
    // A lone surrogate would not survive UTF-8, so such text stays inline.
    if (!(value.isWellFormed ? value.isWellFormed() : value === value.toWellFormed?.())) return value;
    const bytes = encoder.encode(value);
    return bytes.byteLength >= INLINE_TEXT_BYTES ? reference(bytes, 'utf8', context) : value;
  }
  if (Array.isArray(value)) return value.map(item => externalize(item, context));
  if (!plain(value)) return value;
  if (Object.hasOwn(value, BLOB_TAG)) throw new Error('Reserved conversation key.');
  if (typeof value.mime === 'string' && typeof value.dataUrl === 'string') return externalizeAttachment(value, context);
  const result = {};
  for (const [name, child] of Object.entries(value)) {
    if (FILE_MAP_KEYS.has(name) && plain(child)) {
      const files = {};
      for (const [path, content] of Object.entries(child)) put(files, path, externalize(content, context, true));
      put(result, name, files);
    } else put(result, name, externalize(child, context));
  }
  return result;
}

function splitRun(run, context) {
  const key = Number.isSafeInteger(run.updatedAt) ? `${run.id}\u0000${run.updatedAt}` : null;
  let fields = key && context.previous.runs.get(key);
  if (!fields) {
    fields = { values: {}, blobs: new Map() };
    const local = { ...context, sink: fields.blobs };
    for (const name of SNAPSHOT_KEYS) if (Object.hasOwn(run, name)) fields.values[name] = externalize(run[name], local);
  }
  if (key) context.next.runs.set(key, fields);
  for (const [sha, bytes] of fields.blobs) context.blobs.set(sha, bytes);
  const result = {};
  for (const [name, child] of Object.entries(run)) put(result, name, SNAPSHOT_KEYS.includes(name) ? fields.values[name] : externalize(child, context));
  return result;
}

/** cache: the previous save's cache (read); nextCache: collects entries used by this save.
 *  `blobs` lists blobs this split produced or whose bytes it has; cache hits from a seeded cache contribute none,
 *  so use blobReferences(thread) for the full referenced set. A missing persisted blob is handled by the caller
 *  re-splitting without a cache. The walk is synchronous; hashing runs afterwards as one batch. */
export async function splitThread(thread, { cache = createSplitCache(), nextCache = createSplitCache(), hash = sha256Hex } = {}) {
  const context = { previous: cache, next: nextCache, blobs: new Map(), jobs: [], sink: null };
  const { runs = [], ...rest } = thread;
  const split = externalize(rest, context);
  split.runs = runs.map(run => splitRun(run, context));
  await Promise.all(context.jobs.map(async job => {
    const sha = await hash(job.bytes);
    job.ref[BLOB_TAG] = sha;
    for (const sink of job.sinks) sink.set(sha, job.bytes);
  }));
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
    for (const [name, child] of Object.entries(value)) put(result, name, await internalize(child));
    return result;
  }
  return internalize(split);
}
