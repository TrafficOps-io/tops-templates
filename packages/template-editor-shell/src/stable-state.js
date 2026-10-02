import { contentsEqual } from '@trafficops/template-editor-core';

function sameFiles(left, right) {
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every(name => Object.hasOwn(right, name) && contentsEqual(left[name], right[name]));
}
// JSON-like values; object key order is not a difference.
function sameValue(left, right) {
  if (left === right) return true;
  if (left instanceof Uint8Array || right instanceof Uint8Array) return left instanceof Uint8Array && right instanceof Uint8Array && contentsEqual(left, right);
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

/** The state a save returned, with the previous `files`, `folders` and `translations` objects kept when their contents
 *  are unchanged. Effects keyed on those references (analysis, live preview) then do not re-run after an autosave. */
export function stableSavedState(previous, saved) {
  if (!previous || !saved) return saved;
  return {
    ...saved,
    files: previous.files && saved.files && sameFiles(previous.files, saved.files) ? previous.files : saved.files,
    folders: Array.isArray(previous.folders) && Array.isArray(saved.folders) && sameValue(previous.folders, saved.folders) ? previous.folders : saved.folders,
    translations: sameValue(previous.translations, saved.translations) ? previous.translations : saved.translations,
  };
}
