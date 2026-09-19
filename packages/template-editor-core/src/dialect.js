import { safePath } from './project.js';

// Callers supply the registry. Core must never import a language implementation.
export function validateDialectDescriptor(descriptor, knownIds) {
  if (!descriptor || descriptor.schema !== 1 || typeof descriptor.id !== 'string' || !new Set(knownIds).has(descriptor.id)) return false;
  if (!Array.isArray(descriptor.allowedEntrypoints) || descriptor.allowedEntrypoints.some(path => {
    try { return safePath(path) !== path; } catch { return true; }
  })) return false;
  const limits = descriptor.limits;
  return Boolean(limits && ['count', 'file', 'text', 'total', 'archive'].every(name => Number.isSafeInteger(limits[name]) && limits[name] > 0)
    && limits.text <= limits.file && limits.file <= limits.total);
}
