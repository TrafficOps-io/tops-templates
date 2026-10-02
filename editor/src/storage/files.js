import { ConflictError, contentsEqual, isText, LIMITS, safePath, validateFolders, validateProject } from '@trafficops/template-editor-core';
import { directoryAt, readFile, removePath, writeFile } from './write.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
const conflict = path => new ConflictError(`The file changed outside Studio: ${path}. Reload the folder before saving.`);
const snapshot = project => ({ files: { ...project.files }, folders: [...project.folders] });

/** The editable tree of a project folder: { files, folders }. Hidden entries (".trafficops", ".DS_Store", …) are skipped. */
export async function readProjectTree(root) {
  const files = Object.create(null), folders = [];
  let total = 0, entries = 0;
  async function visit(directory, prefix = '') {
    for await (const entry of directory.values()) {
      if (entry.name.startsWith('.')) continue;
      const path = safePath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (++entries > LIMITS.count) throw new Error(`A project may contain up to ${LIMITS.count} files and folders.`);
      if (entry.kind === 'directory') { folders.push(path); await visit(entry, path); continue; }
      if (entry.kind !== 'file') throw new Error(`Unsupported project entry: ${path}`);
      const file = await entry.getFile();
      if (file.size > LIMITS.file || (isText(path) && file.size > LIMITS.text)) throw new Error(`File is too large: ${path}`);
      total += file.size;
      if (total > LIMITS.total) throw new Error('The project exceeds 32 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      try { files[path] = isText(path) ? decoder.decode(bytes) : bytes; } catch { throw new Error(`Text file is not valid UTF-8: ${path}`); }
    }
  }
  await visit(root);
  if (Object.keys(files).length) validateProject(files);
  return { files, folders: validateFolders(files, folders) };
}

export function projectSnapshotEqual(left, right) {
  const leftNames = Object.keys(left.files), rightNames = Object.keys(right.files);
  if (leftNames.length !== rightNames.length || left.folders.length !== right.folders.length) return false;
  if (leftNames.some(name => !Object.hasOwn(right.files, name) || !contentsEqual(left.files[name], right.files[name]))) return false;
  const leftFolders = [...left.folders].sort(), rightFolders = [...right.folders].sort();
  return leftFolders.every((name, index) => name === rightFolders[index]);
}

/** Writes the difference previous → next. Every touched path is checked against `previous` first, so an external
 *  change throws ConflictError before anything is written. Unknown files are kept; only empty folders are removed. */
export async function syncProjectTree(root, previousProject, nextProject) {
  const previous = snapshot(previousProject), next = snapshot(nextProject);
  if (Object.keys(next.files).length) validateProject(next.files);
  next.folders = validateFolders(next.files, next.folders);
  const changed = Object.keys(next.files).filter(path => !Object.hasOwn(previous.files, path) || !contentsEqual(previous.files[path], next.files[path]));
  const removed = Object.keys(previous.files).filter(path => !Object.hasOwn(next.files, path));

  for (const path of changed) {
    const disk = await readFile(root, path);
    if (Object.hasOwn(previous.files, path) ? disk === null || !contentsEqual(disk, previous.files[path]) : disk !== null) throw conflict(path);
  }
  for (const path of removed) {
    const disk = await readFile(root, path);
    if (disk !== null && !contentsEqual(disk, previous.files[path])) throw conflict(path);
  }

  for (const path of next.folders) await directoryAt(root, path, { create: true });
  for (const path of changed) await writeFile(root, path, next.files[path]);
  for (const path of removed) await removePath(root, path);
  const kept = new Set(next.folders);
  const removedFolders = previous.folders.filter(path => !kept.has(path)).sort((a, b) => b.split('/').length - a.split('/').length);
  for (const path of removedFolders) {
    try { await removePath(root, path); } catch (error) { if (error?.name !== 'InvalidModificationError') throw error; }
  }
  return next;
}
