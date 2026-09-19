import { contentsEqual } from './contents-equal.js';
export function changedProjectFiles(files, baseline = {}) {
  return Object.fromEntries(Object.entries(files).flatMap(([path, value]) => !Object.hasOwn(baseline, path)
    ? [[path, 'added']] : !contentsEqual(value, baseline[path]) ? [[path, 'modified']] : []));
}
