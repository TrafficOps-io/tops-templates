import { strToU8, unzipSync, zipSync } from 'fflate';

export const LIMITS = Object.freeze({ archive: 20 * 1024 * 1024, total: 32 * 1024 * 1024, file: 8 * 1024 * 1024, text: 2 * 1024 * 1024, count: 500 });
const TEXT_FILE = /\.(?:tpl(?:\.(?:html|php|txt))?|php|html?|css|js|mjs|json|md|txt|svg|xml|yaml|yml|csv|map)$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const VALUES_ENTRY = '.trafficops/values.json';
const METADATA_ENTRY = '.trafficops/project.json';
const CONVERSATIONS_ENTRY = '.trafficops/conversations.json';
const MiB = 1024 * 1024;
// runs is per dialogue; total/nodes bound the joined in-memory document; encoded bounds the legacy single-file sidecar (removed in phase 2).
export const CONVERSATION_LIMITS = Object.freeze({ threads: 100, runs: 100, messages: 500, total: 512 * MiB, encoded: 192 * MiB, nodes: 2000000, depth: 64, threadEncoded: 16 * MiB, blob: 24 * MiB });
const BYTES_TAG = '$trafficopsBytes';

function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

/** Bounded JSON-compatible payload, with typed bytes for snapshots and attachments. */
export function clonePortablePayload(value) {
  const ancestors = new Set();
  let nodes = 0, total = 0;
  function visit(item, depth, key = '') {
    if (++nodes > CONVERSATION_LIMITS.nodes || depth > CONVERSATION_LIMITS.depth) throw new Error('Project history is too complex.');
    if (item === null || typeof item === 'boolean') { total += 4; return item; }
    if (typeof item === 'number' && Number.isFinite(item)) { total += 8; return item; }
    if (typeof item === 'string') {
      const size = encoder.encode(item).length;
      const attachmentUrl = key === 'dataUrl' && /^data:(?:image\/(?:png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/]*={0,2}$/.test(item);
      if (size > (attachmentUrl ? Math.ceil(4 * 1024 * 1024 / 3) * 4 + 128 : LIMITS.text)) throw new Error('Project history text or attachment exceeds its size limit.');
      total += size; return item;
    }
    if (item instanceof Uint8Array) {
      if (item.byteLength > CONVERSATION_LIMITS.blob) throw new Error('Project history asset exceeds 24 MiB.');
      total += item.byteLength; return new Uint8Array(item);
    }
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw new Error('Project history must contain JSON values or bytes.');
    if (ancestors.has(item)) throw new Error('Project history cannot contain circular references.');
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) result = item.map(child => visit(child, depth + 1));
    else {
      if (Object.hasOwn(item, BYTES_TAG)) throw new Error('Reserved project history key.');
      result = Object.fromEntries(Object.entries(item).map(([key, child]) => { total += encoder.encode(key).length; return [key, visit(child, depth + 1, key)]; }));
    }
    ancestors.delete(item);
    if (total > CONVERSATION_LIMITS.total) throw new Error('Project history exceeds 512 MiB. Archive older dialogue snapshots before continuing.');
    return result;
  }
  const result = visit(value, 0);
  if (total > CONVERSATION_LIMITS.total) throw new Error('Project history exceeds 512 MiB. Archive older dialogue snapshots before continuing.');
  return result;
}

export function validateConversationDocument(value, expectedProjectId) {
  const document = clonePortablePayload(value);
  if (!document || Array.isArray(document) || document.schema !== 1) throw new Error('Unsupported project history schema.');
  identifier(document.projectId, 'history project ID');
  if (expectedProjectId && document.projectId !== expectedProjectId) throw new Error('History belongs to a different project.');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) throw new Error('Invalid history revision.');
  for (const [key, limit] of [['threads', CONVERSATION_LIMITS.threads], ['runs', CONVERSATION_LIMITS.threads * CONVERSATION_LIMITS.runs]]) {
    if (!Array.isArray(document[key]) || document[key].length > limit) throw new Error(`Project history supports at most ${limit} ${key}.`);
    const ids = new Set();
    for (const entry of document[key]) {
      if (!entry || Array.isArray(entry) || typeof entry !== 'object') throw new Error(`Invalid history ${key} entry.`);
      const id = identifier(entry.id, `history ${key} ID`);
      if (ids.has(id)) throw new Error(`Duplicate history ${key} ID.`);
      ids.add(id);
      if (key === 'threads' && entry.messages !== undefined && (!Array.isArray(entry.messages) || entry.messages.length > CONVERSATION_LIMITS.messages)) throw new Error('A dialogue supports at most 500 messages.');
    }
  }
  const perThread = new Map();
  for (const run of document.runs) if (typeof run.threadId === 'string') {
    const count = (perThread.get(run.threadId) || 0) + 1;
    if (count > CONVERSATION_LIMITS.runs) throw new Error(`A dialogue supports at most ${CONVERSATION_LIMITS.runs} runs.`);
    perThread.set(run.threadId, count);
  }
  return document;
}

export function validatePortableMetadata(value) {
  if (!value || Array.isArray(value) || value.schema !== 1) throw new Error('Unsupported Studio project metadata.');
  const projectId = identifier(value.projectId, 'portable project ID');
  if (!['landing', 'template'].includes(value.kind)) throw new Error('Invalid portable project kind.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || /[\x00-\x1f\x7f]/.test(value.name)) throw new Error('Invalid portable project name.');
  const result = { schema: 1, projectId, kind: value.kind, name: value.name.trim() };
  for (const key of ['contentRevision', 'metadataRevision', 'createdAt']) {
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Invalid portable ${key}.`);
      result[key] = value[key];
    }
  }
  if (value.sourceTemplateId !== undefined) result.sourceTemplateId = identifier(value.sourceTemplateId, 'source template ID');
  if (value.contentHash !== undefined) {
    if (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error('Invalid portable content hash.');
    result.contentHash = value.contentHash;
  }
  if (value.appliedAiRuns !== undefined) {
    if (!Array.isArray(value.appliedAiRuns) || value.appliedAiRuns.length > 200) throw new Error('Invalid applied AI run history.');
    result.appliedAiRuns = [...new Set(value.appliedAiRuns.map(id => identifier(id, 'applied AI run ID')))];
  }
  return result;
}

export function encodePortablePayload(value) {
  const detached = clonePortablePayload(value);
  return JSON.stringify(detached, (_key, item) => {
    if (!(item instanceof Uint8Array)) return item;
    let binary = '';
    for (let offset = 0; offset < item.length; offset += 8192) binary += String.fromCharCode(...item.subarray(offset, offset + 8192));
    return { [BYTES_TAG]: btoa(binary) };
  });
}

export function decodePortablePayload(text) {
  if (typeof text !== 'string' || encoder.encode(text).length > CONVERSATION_LIMITS.encoded) throw new Error('Portable project data is too large.');
  const value = JSON.parse(text, (_key, item) => {
    if (!item || typeof item !== 'object' || !Object.hasOwn(item, BYTES_TAG)) return item;
    const base64 = item[BYTES_TAG];
    if (Object.keys(item).length !== 1 || typeof base64 !== 'string' || base64.length > Math.ceil(CONVERSATION_LIMITS.blob / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid portable binary data.');
    const binary = atob(base64);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  });
  return clonePortablePayload(value);
}

export function safePath(path) {
  if (typeof path !== 'string' || !path || path.length > 255 || /[\\:\x00-\x20\x7f?#%]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || ['__proto__', 'constructor', 'prototype'].includes(part))) {
    throw new Error(`Unsafe file path: ${String(path).slice(0, 100)}. Use relative paths without hidden folders or spaces.`);
  }
  return path;
}

export function isTemplate(path) { return /\.tpl(?:\.html)?$/i.test(path); }
export function isText(path) { return TEXT_FILE.test(path); }
export function byteSize(value) { return typeof value === 'string' ? encoder.encode(value).length : value.byteLength; }
export function outputPath(path) { return path.replace(/\.tpl(?:\.html)?$/i, '.html'); }

export function validateProject(files, { generated = false } = {}) {
  const entries = Object.entries(files);
  if (!entries.length) throw new Error('This project is empty. Add an index.tpl file.');
  if (entries.length > LIMITS.count) throw new Error(`A project may contain up to ${LIMITS.count} files.`);
  let total = 0;
  const paths = new Set(entries.map(([path]) => path));
  for (const [path, value] of entries) {
    safePath(path);
    if (!(typeof value === 'string' || value instanceof Uint8Array)) throw new Error(`Invalid contents: ${path}`);
    const size = byteSize(value);
    if (size > (typeof value === 'string' && !generated ? LIMITS.text : LIMITS.file)) throw new Error(`File is too large: ${path}`);
    total += size;
    const parts = path.split('/');
    while (parts.length > 1) { parts.pop(); if (paths.has(parts.join('/'))) throw new Error(`A file conflicts with a folder: ${parts.join('/')}`); }
  }
  if (total > LIMITS.total) throw new Error('The expanded project exceeds 32 MiB.');
  return files;
}

export function validateFolders(files, folders = []) {
  const unique = new Set();
  for (const rawPath of folders) {
    const path = safePath(String(rawPath).replace(/\/$/, ''));
    if (unique.has(path)) continue;
    if (Object.hasOwn(files, path)) throw new Error(`A folder conflicts with a file: ${path}`);
    const parts = path.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (Object.hasOwn(files, parts.join('/'))) throw new Error(`A folder conflicts with a file: ${parts.join('/')}`);
    }
    const segments = path.split('/');
    for (let index = 1; index <= segments.length; index++) unique.add(segments.slice(0, index).join('/'));
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

export function projectFolders(files, explicit = []) {
  const folders = new Set(explicit);
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    while (parts.length > 1) { parts.pop(); folders.add(parts.join('/')); }
  }
  return validateFolders(files, folders);
}

// Inspect central-directory metadata before allocating decompression buffers.
// ZIP64, encrypted files and symlinks deliberately are not accepted.
export function inspectZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > LIMITS.archive) throw new Error('Choose a ZIP smaller than 20 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw new Error('This file is not a complete ZIP archive.');
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  const directorySize = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count === 65535 || start === 0xffffffff || start + directorySize !== end) throw new Error('Split archives and ZIP64 archives are unsupported.');
  if (!count || count > LIMITS.count) throw new Error(`A ZIP must contain 1–${LIMITS.count} entries.`);
  let at = start, total = 0;
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new Error('The ZIP directory is invalid.');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (at + 46 + nameLength + extraLength + commentLength > end) throw new Error('The ZIP directory is truncated.');
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const directory = path.endsWith('/');
    if (![VALUES_ENTRY, METADATA_ENTRY, CONVERSATIONS_ENTRY, '.trafficops/'].includes(path)) safePath(directory ? path.slice(0, -1) : path);
    if ([VALUES_ENTRY, METADATA_ENTRY, CONVERSATIONS_ENTRY].includes(path) && directory) throw new Error(`Invalid metadata entry: ${path}`);
    if (entries.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`);
    if ((flags & 1) || ![0, 8].includes(method)) throw new Error(`Encrypted or unsupported ZIP entry: ${path}`);
    if (((view.getUint32(at + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error(`ZIP symlinks are unsupported: ${path}`);
    const entryLimit = path === CONVERSATIONS_ENTRY ? LIMITS.total : path === METADATA_ENTRY ? 64 * 1024 : isText(path) ? LIMITS.text : LIMITS.file;
    if (size > entryLimit || size === 0xffffffff || compressed === 0xffffffff) throw new Error(`ZIP entry is too large: ${path}`);
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) throw new Error(`Invalid local ZIP header: ${path}`);
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > start || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== path || view.getUint16(local + 8, true) !== method) throw new Error(`Inconsistent ZIP entry: ${path}`);
    if (!(flags & 8) && (view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size)) throw new Error(`Inconsistent ZIP size: ${path}`);
    total += size;
    if (total > LIMITS.total) throw new Error('The expanded ZIP exceeds 32 MiB.');
    entries.set(path, { size, directory });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end) throw new Error('Unexpected ZIP directory data.');
  return entries;
}

export function readZip(bytes) {
  return readZipProject(bytes).files;
}

export function readZipProject(bytes) {
  const entries = inspectZip(bytes);
  const unzipped = unzipSync(bytes);
  const files = Object.create(null);
  let settings = {}, metadata, conversations;
  for (const [path, info] of entries) {
    if (info.directory) continue;
    const data = unzipped[path];
    if (!data || data.byteLength !== info.size) throw new Error(`ZIP size mismatch: ${path}`);
    if (path === VALUES_ENTRY) {
      settings = JSON.parse(decoder.decode(data));
      if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('Project values must be a JSON object.');
    } else if (path === METADATA_ENTRY) metadata = validatePortableMetadata(JSON.parse(decoder.decode(data)));
    else if (path === CONVERSATIONS_ENTRY) conversations = validateConversationDocument(decodePortablePayload(decoder.decode(data)));
    else files[path] = isText(path) ? decoder.decode(data) : data;
  }
  if (conversations && (!metadata || conversations.projectId !== metadata.projectId)) throw new Error('Portable history does not match project identity.');
  const portable = { ...(metadata ? { metadata } : {}), ...(conversations ? { conversations } : {}) };
  validateProject(files);
  let folders = [...entries].filter(([path, info]) => info.directory && path !== '.trafficops/').map(([path]) => path.slice(0, -1));
  // A downloaded GitHub/project archive often has a single enclosing folder.
  const names = Object.keys(files), folder = names[0].split('/')[0];
  if (names.every(name => name.startsWith(`${folder}/`))) {
    const stripped = Object.fromEntries(Object.entries(files).map(([name, value]) => [name.slice(folder.length + 1), value]));
    folders = folders.filter(name => name !== folder).map(name => name.startsWith(`${folder}/`) ? name.slice(folder.length + 1) : name);
    return { files: stripped, folders: validateFolders(stripped, folders), settings, ...portable };
  }
  return { files, folders: validateFolders(files, folders), settings, ...portable };
}

export function createZip(files, { generated = false, directories = [], settings, metadata, conversations } = {}) {
  validateProject(files, { generated });
  const folders = validateFolders(files, directories);
  const entries = Object.fromEntries(folders.map(path => [`${path}/`, new Uint8Array()]));
  for (const [name, value] of Object.entries(files)) entries[name] = typeof value === 'string' ? strToU8(value) : value;
  if (!generated && settings && Object.keys(settings).length) {
    const data = strToU8(JSON.stringify(settings, null, 2));
    if (data.length > LIMITS.text) throw new Error('Project values exceed 2 MiB.');
    entries[VALUES_ENTRY] = data;
  }
  if (!generated && metadata) entries[METADATA_ENTRY] = strToU8(JSON.stringify(validatePortableMetadata(metadata)));
  if (!generated && conversations) {
    if (!metadata) throw new Error('Portable history requires project identity.');
    entries[CONVERSATIONS_ENTRY] = strToU8(encodePortablePayload(validateConversationDocument(conversations, metadata.projectId)));
  }
  if (Object.values(entries).reduce((sum, bytes) => sum + bytes.byteLength, 0) > LIMITS.total) throw new Error('The portable project exceeds 32 MiB. Export without history or reduce its size.');
  if (Object.keys(entries).length > LIMITS.count) throw new Error('Too many entries for a project ZIP.');
  return zipSync(entries, { level: 6 });
}

export function renameFile(files, from, to) {
  safePath(to);
  if (from === to) return files;
  if (Object.hasOwn(files, to)) throw new Error(`A file already exists: ${to}`);
  if (!Object.hasOwn(files, from)) throw new Error(`File not found: ${from}`);
  return validateProject(Object.fromEntries(Object.entries(files).map(([name, value]) => [name === from ? to : name, value])));
}
