import { changedProjectFiles } from '@trafficops/template-editor-core';

/** Include removed paths: the editor's unsaved-file marker only tracks present files. */
export function conversationChangedFiles(base = {}, proposed = {}) {
  const changes = changedProjectFiles(proposed, base);
  for (const path of Object.keys(base)) if (!Object.hasOwn(proposed, path)) changes[path] = 'deleted';
  return changes;
}

export function conversationReferenceLabel(reference) {
  if (typeof reference === 'string') return reference;
  return reference?.path || (reference?.kind === 'values' ? 'Content values' : reference?.kind === 'files' || reference?.kind === 'file' ? 'Project files' : 'Project');
}
