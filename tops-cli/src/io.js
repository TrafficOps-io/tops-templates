import {lstat, readdir, readFile, mkdir, writeFile, realpath, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LIMITS, safePath, TemplateError} from '../../runtime/src/index.js';

const fail = (message) => { throw new TemplateError(message); };
export async function assertNoSymlinks(filename) {
  const absolute = path.resolve(filename), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail(`Symbolic links are not allowed: ${current}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
export async function readProject(input) {
  // Resolve the OS temp-directory alias before enforcing links inside the project.
  const absolute = path.resolve(input);
  const info = await lstat(absolute); if (info.isSymbolicLink()) fail('Template input cannot be a symbolic link');
  if (!info.isFile() && !info.isDirectory()) fail('Template input must be a file or directory');
  const root = await realpath(info.isDirectory() ? absolute : path.dirname(absolute));
  const files = {}; let total = 0;
  const read = async (relative) => {
    safePath(relative); const filename = path.join(root, relative); await assertNoSymlinks(filename);
    const stat = await lstat(filename); if (!stat.isFile()) fail(`Not a regular file: ${relative}`);
    if (stat.size + total > LIMITS.projectBytes) fail('Project exceeds 32 MiB');
    const data = await readFile(filename); total += data.byteLength;
    if (Object.keys(files).length >= LIMITS.files) fail('Project contains too many files');
    files[relative] = /\.tpl(?:\.html)?$/i.test(relative) ? new TextDecoder('utf-8', {fatal:true}).decode(data) : new Uint8Array(data);
  };
  if (info.isDirectory()) {
    const walk = async (directory, prefix = '') => {
      const entries = await readdir(directory, {withFileTypes:true});
      for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || ['node_modules','vendor'].includes(entry.name)) continue;
        const relative = `${prefix}${entry.name}`; safePath(relative);
        if (entry.isSymbolicLink()) fail(`Symbolic links are not allowed: ${relative}`);
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`);
        else if (entry.isFile()) await read(relative);
        else fail(`Unsupported file: ${relative}`);
      }
    };
    await walk(root);
  } else {
    const entry = path.basename(absolute);
    if (!/\.tpl(?:\.html)?$/i.test(entry)) fail('Template files must end in .tpl or .tpl.html');
    // File mode copies only its source graph. Directory mode includes project assets.
    const visit = async (relative) => {
      if (Object.hasOwn(files, relative)) return;
      await read(relative);
      const source = files[relative];
      for (const match of source.matchAll(/^\s*@include\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/gm)) {
        const include = match[1] ?? match[2] ?? match[3]; safePath(include); const child = path.posix.join(path.posix.dirname(relative), include); await visit(child);
      }
    };
    await visit(entry);
  }
  return {files, root, directory:info.isDirectory()};
}
export async function readJson(filename) {
  const info = await lstat(filename); if (!info.isFile() || info.size > 8 * 1024 * 1024) fail('JSON input must be a regular file of at most 8 MiB');
  try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { fail(`Cannot read JSON ${filename}: ${error.message}`); }
}
export async function writeProject(files, output, {force = false, sourceRoot, sourceIsDirectory = false} = {}) {
  const requested = path.resolve(output);
  // Canonicalize the closest existing ancestor; /tmp may itself be an OS alias.
  let ancestor = requested, suffix = [];
  while (true) { try { await lstat(ancestor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); } }
  if ((await lstat(ancestor)).isSymbolicLink()) fail(`Output cannot be a symbolic link: ${ancestor}`);
  const target = path.join(await realpath(ancestor), ...suffix);
  if (sourceIsDirectory && sourceRoot && (target === sourceRoot || target.startsWith(sourceRoot + path.sep))) fail('Output must be outside the template source directory');
  await assertNoSymlinks(target);
  const entries = Object.entries(files);
  if (!entries.length) fail('No generated files');
  // Check every destination before writing anything. --force affects generated files only.
  for (const [relative] of entries) {
    safePath(relative); const destination = path.join(target, relative); await assertNoSymlinks(destination);
    try { const info = await lstat(destination); if (!force) fail(`Output exists: ${destination}. Use --force to replace generated files.`); if (!info.isFile()) fail(`Output is not a regular file: ${destination}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const [relative, content] of entries) {
    const destination = path.join(target, relative); await mkdir(path.dirname(destination), {recursive:true}); await assertNoSymlinks(destination);
    if (!force) await writeFile(destination, content, {flag:'wx'});
    else {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, content, {flag:'wx'}); await rename(temporary, destination); } finally { await rm(temporary, {force:true}); }
    }
  }
  return target;
}
