import { contentsEqual, validateConversationDocument } from '@trafficops/template-editor-core';

/** A portable backup adds missing history; it never replaces a live local run. */
export function mergePortableHistory(local, imported) {
  if (!imported) return local;
  if (local.projectId !== imported.projectId) throw new Error('Dialogue history belongs to another project.');
  const threads = new Map(local.threads.map(thread => [thread.id, structuredClone(thread)]));
  for (const incoming of imported.threads) {
    const existing = threads.get(incoming.id);
    if (!existing) { threads.set(incoming.id, structuredClone(incoming)); continue; }
    const messages = new Map((existing.messages || []).map(message => [message.id, message]));
    for (const message of incoming.messages || []) if (!messages.has(message.id)) messages.set(message.id, structuredClone(message));
    existing.messages = [...messages.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  const runs = new Map(local.runs.map(run => [run.id, structuredClone(run)]));
  for (const run of imported.runs) if (!runs.has(run.id)) runs.set(run.id, structuredClone(run));
  return validateConversationDocument({ ...local, threads: [...threads.values()], runs: [...runs.values()] }, local.projectId);
}

export function transferFileChanges(previous, next) {
  return [...new Set([...Object.keys(previous.files), ...Object.keys(next.files)])].sort().flatMap(path => {
    const before = Object.hasOwn(previous.files, path), after = Object.hasOwn(next.files, path);
    if (before && after && contentsEqual(previous.files[path], next.files[path])) return [];
    return [{ path, status: !before ? 'Added' : !after ? 'Deleted' : 'Changed' }];
  });
}

export function sameProjectSnapshot(previous, next) {
  return !transferFileChanges(previous, next).length && JSON.stringify([...(previous.folders || [])].sort()) === JSON.stringify([...(next.folders || [])].sort()) && JSON.stringify(previous.settings || {}) === JSON.stringify(next.settings || {});
}
