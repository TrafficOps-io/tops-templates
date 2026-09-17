import { strToU8, unzipSync, zipSync } from 'fflate';

export const LIMITS = Object.freeze({ archive: 20 * 1024 * 1024, total: 32 * 1024 * 1024, file: 8 * 1024 * 1024, text: 2 * 1024 * 1024, count: 500 });
const TEXT_FILE = /\.(?:tpl(?:\.html)?|html?|css|js|mjs|json|md|txt|svg|xml|yaml|yml|csv|map)$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

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
    safePath(directory ? path.slice(0, -1) : path);
    if (entries.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`);
    if ((flags & 1) || ![0, 8].includes(method)) throw new Error(`Encrypted or unsupported ZIP entry: ${path}`);
    if (((view.getUint32(at + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error(`ZIP symlinks are unsupported: ${path}`);
    if (size > LIMITS.file || (isText(path) && size > LIMITS.text) || size === 0xffffffff || compressed === 0xffffffff) throw new Error(`ZIP entry is too large: ${path}`);
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
  const entries = inspectZip(bytes);
  const unzipped = unzipSync(bytes);
  const files = Object.create(null);
  for (const [path, info] of entries) {
    if (info.directory) continue;
    const data = unzipped[path];
    if (!data || data.byteLength !== info.size) throw new Error(`ZIP size mismatch: ${path}`);
    files[path] = isText(path) ? decoder.decode(data) : data;
  }
  validateProject(files);
  // A downloaded GitHub/project archive often has a single enclosing folder.
  const names = Object.keys(files), folder = names[0].split('/')[0];
  if (names.every(name => name.startsWith(`${folder}/`))) {
    return Object.fromEntries(Object.entries(files).map(([name, value]) => [name.slice(folder.length + 1), value]));
  }
  return files;
}

export function createZip(files, { generated = false } = {}) {
  validateProject(files, { generated });
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])), { level: 6 });
}

export function renameFile(files, from, to) {
  safePath(to);
  if (from === to) return files;
  if (Object.hasOwn(files, to)) throw new Error(`A file already exists: ${to}`);
  if (!Object.hasOwn(files, from)) throw new Error(`File not found: ${from}`);
  return validateProject(Object.fromEntries(Object.entries(files).map(([name, value]) => [name === from ? to : name, value])));
}

export function languageFor(path) {
  if (/\.tpl(?:\.html)?$/i.test(path)) return 'trafficops-tpl';
  if (/\.html?$/i.test(path)) return 'html';
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ css: 'css', js: 'javascript', mjs: 'javascript', json: 'json', md: 'markdown', svg: 'xml', xml: 'xml', yaml: 'yaml', yml: 'yaml' })[extension] || 'plaintext';
}

export function downloadFile(name, value, mime = 'application/zip') {
  const url = URL.createObjectURL(new Blob([value], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
