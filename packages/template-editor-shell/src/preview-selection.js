import { contentsEqual } from '@trafficops/template-editor-core';

export function sameProjectFiles(left, right) {
  if (!left || !right) return false;
  const paths = Object.keys(left);
  return paths.length === Object.keys(right).length && paths.every(path => Object.hasOwn(right, path) && contentsEqual(left[path], right[path]));
}

export function previewSelectionMatches(frame, { files, values, locale }) {
  const snapshot = frame?.sourceSnapshot;
  return Boolean(frame?.selection && snapshot && snapshot.locale === locale && sameProjectFiles(snapshot.files, files)
    && JSON.stringify(snapshot.values) === JSON.stringify(values));
}

export function selectedPreviewBlocks(frame, ids, page) {
  const known = frame?.selection?.blockInstances || [];
  const byId = new Map(known.filter(block => block.page === page).map(block => [block.id, block]));
  const selected = new Set(ids.filter(id => byId.has(id)));
  // An ancestor already includes its descendants. Keep independent instances,
  // even when they are emitted by the same reusable source block.
  return [...selected].filter(id => {
    let parent = byId.get(id)?.parentId;
    const seen = new Set();
    while (parent && !seen.has(parent)) { if (selected.has(parent)) return false; seen.add(parent); parent = byId.get(parent)?.parentId; }
    return true;
  }).map(id => {
    const block = byId.get(id), ancestorIds = [], seen = new Set();
    let parent = block.parentId;
    while (parent && !seen.has(parent)) { seen.add(parent); ancestorIds.push(parent); parent = byId.get(parent)?.parentId; }
    return { ...block, ancestorIds };
  });
}

export function blockScopeBaseMatches(scope, { files, rawValues }) {
  return sameProjectFiles(scope?.baselineFiles, files)
    && JSON.stringify(scope?.baselineRawValues) === JSON.stringify(rawValues || {});
}

export function previewSectionOptions(frame, page) {
  const blocks = (frame?.selection?.blockInstances || []).filter(block => page === undefined || block.page === page);
  const counts = new Map(), occurrences = new Map(), byId = new Map(blocks.map(block => [block.id, block]));
  const sources = new Map((frame?.selection?.blockSources || []).map(source => [source.id, source]));
  const keyOf = block => JSON.stringify([block.page, block.label]);
  for (const block of blocks) counts.set(keyOf(block), (counts.get(keyOf(block)) || 0) + 1);
  return blocks.map(block => {
    const key = keyOf(block), occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    const source = sources.get(block.sourceId);
    const parent = byId.get(block.parentId);
    return { ...block, kind: 'section', path: source?.path, locale: frame.sourceSnapshot?.locale,
      label: counts.get(key) > 1 ? `${block.label} (${occurrence}/${counts.get(key)})` : block.label,
      description: [parent?.label, source?.path, block.page].filter(Boolean).join(' · ') };
  });
}
