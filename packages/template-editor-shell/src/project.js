export * from '@trafficops/template-editor-core/project';
import { projectFolders, renameFile, safePath, validateFolders, validateProject } from '@trafficops/template-editor-core/project';
import { moveEntry } from '@trafficops/template-editor-core';

const pageOutput = path => path.replace(/\.tpl(?:\.(?:html|php))?$/i, '.html');

// Treat paths as entries, not string prefixes: deleting assets must not touch assets-old.
export function removeProjectEntry(state, entry, active) {
  const path = safePath(entry.path);
  if (!['file', 'folder'].includes(entry.type)) throw new Error('Choose a file or folder to delete.');
  const matches = name => entry.type === 'folder' ? name.startsWith(`${path}/`) : name === path;
  if (entry.type === 'folder' ? !projectFolders(state.files, state.folders).includes(path) : !Object.hasOwn(state.files, path)) throw new Error('This file or folder no longer exists.');
  const removed = Object.keys(state.files).filter(matches);
  const files = validateProject(Object.fromEntries(Object.entries(state.files).filter(([name]) => !matches(name))));
  const folders = validateFolders(files, (state.folders || []).filter(name => entry.type !== 'folder' || (name !== path && !matches(name))));
  const removedEntry = removed.some(name => name === state.entrypoint || pageOutput(name) === state.entrypoint);
  return {
    files, folders, entrypoint: removedEntry ? null : state.entrypoint,
    active: Object.hasOwn(files, active) ? active : Object.keys(files).find(name => /\.(?:tpl(?:\.(?:html|php))?|html?)$/i.test(name)) || Object.keys(files)[0],
  };
}

export function renameProjectFile(state, from, to) {
  const files = renameFile(state.files, from, to);
  validateFolders(files, state.folders);
  return { files, entrypoint: pageOutput(from) === state.entrypoint ? (/\.html?$/i.test(pageOutput(to)) ? pageOutput(to) : null) : state.entrypoint };
}

export function moveProjectEntry(state, entry, destination, active) {
  safePath(entry.path);
  const next = moveEntry(state.files, state.folders || [], entry, destination);
  const to = destination ? `${destination}/${entry.path.split('/').pop()}` : entry.path.split('/').pop();
  const remap = path => typeof path === 'string' && (path === entry.path || path.startsWith(`${entry.path}/`)) ? to + path.slice(entry.path.length) : path;
  return {
    ...next, active: remap(active),
    entrypoint: entry.type === 'folder' ? remap(state.entrypoint) : pageOutput(entry.path) === state.entrypoint ? pageOutput(to) : state.entrypoint,
  };
}

export function applyProjectDraft(state, files, values, locale, { mode = 'edit' } = {}) {
  const paths = Object.keys(files);
  const folders = mode === 'create' ? [] : (state.folders || []).filter(folder => !paths.some(path => path === folder || folder.startsWith(`${path}/`)));
  return {
    files, folders: projectFolders(files, folders),
    entrypoint: mode !== 'create' && paths.some(path => pageOutput(path) === state.entrypoint) ? state.entrypoint : null,
    translations: { ...state.translations, [locale]: values },
  };
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
