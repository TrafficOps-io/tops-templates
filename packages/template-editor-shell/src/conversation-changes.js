import { contentsEqual, projectFolders, safePath, validateProject } from '@trafficops/template-editor-core';

const own = (value, key) => value != null && Object.hasOwn(value, key);
const clone = value => value === undefined ? undefined : structuredClone(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);
const equal = (left, right) => left instanceof Uint8Array && right instanceof Uint8Array ? contentsEqual(left, right)
  : left === right || record(left) && record(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => own(right, key) && equal(left[key], right[key]))
  || Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1');
const parts = path => path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);

// Analyzer-filled defaults are effective values, not edits. Keep the raw saved
// shape for unchanged defaults; changed repeater arrays remain atomic.
export function retainRawDraftValues(raw = {}, effective = {}, proposed = {}) {
  function retain(rawExists, before, visible, after) {
    if (equal(visible, after)) return rawExists ? { exists: true, value: clone(before) } : { exists: false };
    if (record(visible) && record(after)) {
      const value = {};
      for (const key of Object.keys(after)) {
        if (unsafe.has(key)) throw new Error('Unsafe content field name.');
        const next = retain(own(before, key), before?.[key], visible[key], after[key]);
        if (next.exists) value[key] = next.value;
      }
      return { exists: rawExists || Object.keys(value).length > 0, value };
    }
    return { exists: true, value: clone(after) };
  }
  return retain(true, raw, effective, proposed).value;
}

// Hashes identify reference versions. Write conflicts always compare actual
// bytes/values as well, so a hash collision can never authorize an overwrite.
export function conversationContentHash(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `${bytes.length}:${hash.toString(16).padStart(8, '0')}`;
}

function at(root, path) {
  let value = root;
  for (const key of parts(path)) {
    if (!own(value, key)) return { exists: false };
    value = value[key];
  }
  return { exists: true, value };
}
function set(root, path, operation) {
  const keys = parts(path);
  if (keys.some(key => unsafe.has(key))) throw new Error('Unsafe content field path.');
  let parent = root;
  for (const key of keys.slice(0, -1)) {
    if (!own(parent, key)) parent[key] = {};
    if (!record(parent[key])) return false;
    parent = parent[key];
  }
  if (operation.afterExists) parent[keys.at(-1)] = clone(operation.after);
  else delete parent[keys.at(-1)];
  return true;
}
function valueOperations(before, after, prefix = '') {
  const operations = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (unsafe.has(key)) throw new Error('Unsafe content field name.');
    const path = `${prefix}/${escape(key)}`, beforeExists = own(before, key), afterExists = own(after, key);
    if (beforeExists && afterExists && equal(before[key], after[key])) continue;
    if (beforeExists && afterExists && record(before[key]) && record(after[key])) operations.push(...valueOperations(before[key], after[key], path));
    else operations.push({ kind: 'value', path, beforeExists, afterExists,
      ...(beforeExists ? { before: clone(before[key]) } : {}), ...(afterExists ? { after: clone(after[key]) } : {}) });
  }
  return operations;
}

export function createChangeSet({ base, proposal, locale = base?.locale, readSet = proposal?.readSet || [] }) {
  if (!base?.files || !proposal?.files || !locale) throw new Error('The draft is missing its project baseline or language.');
  validateProject(base.files); validateProject(proposal.files);
  const operations = [];
  for (const path of new Set([...Object.keys(base.files), ...Object.keys(proposal.files)])) {
    safePath(path);
    const beforeExists = own(base.files, path), afterExists = own(proposal.files, path);
    if (beforeExists && afterExists && equal(base.files[path], proposal.files[path])) continue;
    operations.push({ kind: 'file', path, beforeExists, afterExists,
      ...(beforeExists ? { before: clone(base.files[path]) } : {}), ...(afterExists ? { after: clone(proposal.files[path]) } : {}) });
  }
  operations.push(...valueOperations(base.translations?.[locale] || base.values || {}, proposal.values ?? proposal.translations?.[locale] ?? {}));
  if (proposal.folders) {
    const before = new Set(base.folders || []), after = new Set(proposal.folders);
    for (const path of new Set([...before, ...after])) if (before.has(path) !== after.has(path)) operations.push({ kind: 'folder', path: safePath(path), beforeExists: before.has(path), afterExists: after.has(path) });
  }
  return { schema: 1, baseRevision: base.revision, locale, operations, readSet: clone(readSet) };
}

export function mergeChangeSet({ base, proposal, current, locale = base?.locale, readSet, allowStaleContext = false }) {
  const changeset = createChangeSet({ base, proposal, locale, ...(readSet ? { readSet } : {}) });
  const next = clone(current), conflicts = [], folders = new Set(current.folders || []);
  next.files = clone(current.files);
  next.translations = { ...clone(current.translations || {}), [locale]: clone(current.translations?.[locale] || {}) };
  for (const operation of changeset.operations) {
    const latest = operation.kind === 'file' ? { exists: own(next.files, operation.path), value: next.files[operation.path] }
      : operation.kind === 'value' ? at(next.translations[locale], operation.path) : { exists: folders.has(operation.path) };
    const matches = (exists, value) => latest.exists === exists && (!exists || operation.kind === 'folder' || equal(latest.value, value));
    if (matches(operation.afterExists, operation.after)) continue;
    if (!matches(operation.beforeExists, operation.before)) {
      conflicts.push({ kind: operation.kind, path: operation.path, base: clone(operation.before), current: clone(latest.value), proposal: clone(operation.after), message: 'This entry changed after the assistant started. Review it before applying.' });
      continue;
    }
    if (operation.kind === 'file') {
      if (operation.afterExists) next.files[operation.path] = clone(operation.after); else delete next.files[operation.path];
    } else if (operation.kind === 'folder') {
      if (operation.afterExists) folders.add(operation.path); else folders.delete(operation.path);
    } else if (!set(next.translations[locale], operation.path, operation)) {
      conflicts.push({ kind: 'value', path: operation.path, message: 'The parent field changed its structure after the assistant started.' });
    }
  }
  const staleReadSet = changeset.readSet.filter(reference => {
    const value = reference.kind === 'value' ? at(current.translations?.[locale] || {}, reference.path).value
      : reference.kind === 'values' ? current.translations?.[locale] || {} : current.files[reference.path];
    return value === undefined || conversationContentHash(value) !== reference.hash;
  }).map(({ kind, path }) => ({ kind, path }));
  try {
    validateProject(next.files);
    next.folders = projectFolders(next.files, [...folders]);
  } catch (error) { conflicts.push({ kind: 'file', path: '', message: error.message }); }
  if (next.entrypoint && !Object.keys(next.files).some(path => path === next.entrypoint || path.replace(/\.tpl(?:\.(?:html|php))?$/i, '.html') === next.entrypoint)) next.entrypoint = null;
  return { state: conflicts.length ? null : next, candidate: next, changeset, conflicts, staleReadSet, requiresContextReview: Boolean(staleReadSet.length && !allowStaleContext) };
}
