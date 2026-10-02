import { ValidationError } from '@trafficops/template-editor-core';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FULL = 'Browser storage is full — export the project as ZIP and free some space.';
const parts = path => String(path || '').split('/').filter(Boolean);
const missing = error => error?.name === 'NotFoundError';

// Both return null when the path is absent (unless create is set); '' is the root.
export async function directoryAt(root, path, { create = false } = {}) {
  let directory = root;
  try { for (const name of parts(path)) directory = await directory.getDirectoryHandle(name, { create }); } catch (error) { if (missing(error)) return null; throw error; }
  return directory;
}

export async function fileAt(root, path, { create = false } = {}) {
  const names = parts(path), name = names.pop();
  const directory = await directoryAt(root, names.join('/'), { create });
  if (!directory) return null;
  try { return await directory.getFileHandle(name, { create }); } catch (error) { if (missing(error)) return null; throw error; }
}

async function fileOf(root, path) {
  const handle = await fileAt(root, path);
  try { return handle ? await handle.getFile() : null; } catch (error) { if (missing(error)) return null; throw error; }
}

export async function readFile(root, path) {
  const file = await fileOf(root, path);
  return file ? new Uint8Array(await file.arrayBuffer()) : null;
}

export async function readText(root, path) {
  const bytes = await readFile(root, path);
  return bytes ? decoder.decode(bytes) : null;
}

export async function readJson(root, path) {
  const text = await readText(root, path);
  if (text === null) return null;
  try { return JSON.parse(text); } catch (error) { throw new ValidationError(`${path} is not valid JSON: ${error.message}`); }
}

export async function writeFile(root, path, data) {
  const handle = await fileAt(root, path, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(typeof data === 'string' ? encoder.encode(data) : data);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    if (error?.name === 'QuotaExceededError') throw new Error(FULL, { cause: error });
    throw error;
  }
}

export async function removePath(root, path, { recursive = false } = {}) {
  const names = parts(path), name = names.pop();
  const directory = await directoryAt(root, names.join('/'));
  if (!directory) return;
  try { await directory.removeEntry(name, { recursive }); } catch (error) { if (!missing(error)) throw error; }
}

export async function lastModified(root, path) {
  const file = await fileOf(root, path);
  return file ? file.lastModified : null;
}

export async function listDirectory(root, path) {
  const directory = await directoryAt(root, path);
  if (!directory) return [];
  const list = [];
  for await (const [name, handle] of directory.entries()) list.push({ name, kind: handle.kind });
  return list;
}
