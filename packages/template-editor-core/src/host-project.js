import { isText, safePath, validateProject, validateFolders } from './project.js';

export function decodeProject(files) {
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [path, Object.hasOwn(value, 'text') ? value.text : Uint8Array.from(atob(value.base64), c => c.charCodeAt(0))]));
}
export function encodeProject(files) {
  return Object.fromEntries(Object.entries(files).map(([path, value]) => {
    if (typeof value === 'string') return [path, { text: value }];
    let binary = '';
    for (let i = 0; i < value.length; i += 32768) binary += String.fromCharCode(...value.subarray(i, i + 32768));
    return [path, { base64: btoa(binary) }];
  }));
}
export function moveEntry(files, folders, entry, destination) {
  const from = entry.path, target = destination ? `${destination}/${from.split('/').pop()}` : from.split('/').pop();
  if (target === from) return { files, folders };
  safePath(target);
  if (target.startsWith(`${from}/`)) throw new Error('A folder cannot be moved inside itself.');
  const mapping = path => path === from || path.startsWith(`${from}/`) ? target + path.slice(from.length) : path;
  const next = {};
  for (const [path, value] of Object.entries(files)) {
    const renamed = mapping(path);
    if (Object.hasOwn(next, renamed) || (renamed !== path && Object.hasOwn(files, renamed))) throw new Error(`A file already exists: ${renamed}`);
    next[renamed] = value;
  }
  const nextFolders = folders.map(mapping);
  validateProject(next); validateFolders(next, nextFolders);
  return { files: next, folders: nextFolders };
}
export function inputValues(definition, saved = {}) {
  const fields = definition?.sections?.flatMap(section => section.fields) || [];
  const fallback = field => field.type === 'group' ? merge(field.fields || [], {})
    : field.type === 'repeater' ? Array.from({ length: field.min_items || 0 }, () => merge(field.fields || [], {}))
    : field.type === 'checkbox' ? false : field.type === 'color' ? '#000000'
    : ['number', 'range'].includes(field.type) ? field.min ?? Math.min(0, field.max ?? 0)
    : field.type === 'select' ? Object.keys(field.options || {})[0] ?? '' : '';
  const merge = (fields, saved) => {
    const result = { ...saved };
    for (const field of fields) {
      let value = Object.hasOwn(saved, field.name) ? saved[field.name] : structuredClone(field.default ?? fallback(field));
      if (field.type === 'group' && value && typeof value === 'object' && !Array.isArray(value)) value = merge(field.fields || [], value);
      if (field.type === 'repeater' && Array.isArray(value)) value = value.map(row => row && typeof row === 'object' && !Array.isArray(row) ? merge(field.fields || [], row) : row);
      result[field.name] = value;
    }
    return result;
  };
  return merge(fields, saved);
}
export async function readUploads(list, folder, files) {
  const next = { ...files };
  for (const file of list) {
    const path = safePath(folder ? `${folder}/${file.name}` : file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    next[path] = isText(path) ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytes;
  }
  return validateProject(next);
}
