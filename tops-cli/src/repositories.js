import {lstat, realpath, readdir, readFile, writeFile, mkdir, mkdtemp, rename, rm, copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {unzipSync, zipSync} from 'fflate';
import {createZip, readZipProject, safePath, isText, LIMITS} from '../../packages/template-editor-core/src/project.js';
import {parseProject, generateProject} from '../../runtime/src/index.js';
import {parseRepositoryIndex, INDEX_LIMIT} from '../../runtime/src/repository-index.js';
import {assertNoSymlinks, readProject} from './io.js';

const BASE = 'https://repository.example/index.json';
const VALUES = '.trafficops/values.json';
const json = value => JSON.stringify(value, null, 2) + '\n';
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
async function stat(filename) { try { return await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

// Resolve the operating system's temporary-directory alias, but reject user-created links.
async function location(input) {
  let absolute = path.resolve(input);
  for (const alias of [...new Set([os.tmpdir(), ...(process.platform === 'darwin' ? ['/tmp', '/var'] : [])])].sort((a, b) => b.length - a.length)) {
    if (within(absolute, alias)) { absolute = path.join(await realpath(alias), path.relative(alias, absolute)); break; }
  }
  await assertNoSymlinks(absolute);
  return absolute;
}
async function boundedFile(filename, limit) {
  await assertNoSymlinks(filename);
  const info = await lstat(filename);
  if (!info.isFile()) fail(`Not a regular file: ${filename}`);
  if (info.size > limit) fail(`File exceeds ${limit / 1024 / 1024} MiB: ${filename}`);
  const contents = await readFile(filename);
  if (contents.byteLength > limit) fail(`File exceeds ${limit / 1024 / 1024} MiB: ${filename}`);
  return contents;
}
async function valuesFile(filename) {
  let values;
  try { values = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await boundedFile(filename, LIMITS.text))); }
  catch (error) { fail(`Cannot read template values: ${error.message}`); }
  if (!object(values)) fail('Template values must be a JSON object.');
  return values;
}
function validateManifest(manifest) {
  // Source manifests omit the generated archive/preview/checksum fields.
  const parsed = parseRepositoryIndex({...manifest, templates:manifest.templates?.map(entry => ({...entry, archive:'template.zip'}))}, BASE);
  const ids = new Set();
  for (const entry of manifest.templates) {
    safePath(entry.id);
    if (ids.has(entry.id.toLowerCase())) fail(`Duplicate template id (case-insensitive): ${entry.id}`);
    ids.add(entry.id.toLowerCase());
    if (entry.thumbnail && !/^https?:\/\//i.test(entry.thumbnail)) safePath(entry.thumbnail);
  }
  if (Buffer.byteLength(json(manifest)) > INDEX_LIMIT) fail('Repository manifest exceeds 1 MiB.');
  return parsed;
}
async function loadRepository(directory) {
  const root = await location(directory);
  if (!(await lstat(root)).isDirectory()) fail('Repository must be a directory.');
  let manifest;
  try { manifest = JSON.parse(await boundedFile(path.join(root, 'repository.json'), INDEX_LIMIT)); }
  catch (error) { fail(`Cannot read repository.json: ${error.message}`); }
  validateManifest(manifest);
  return {root, manifest};
}
async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, json(value), {flag:'wx'}); await rename(temporary, filename); }
  finally { await rm(temporary, {force:true}); }
}

export async function initRepository(directory, options = {}) {
  const root = await location(directory);
  const manifest = {schemaVersion:1, repository:{name:options.name ?? path.basename(root)}, templates:[]};
  for (const key of ['description', 'author', 'homepage']) if (options[key] !== undefined) manifest.repository[key] = options[key];
  validateManifest(manifest);
  if (await stat(path.join(root, 'repository.json'))) fail('repository.json already exists.');
  const templates = path.join(root, 'templates');
  await assertNoSymlinks(templates);
  if ((await stat(templates)) && !(await lstat(templates)).isDirectory()) fail('templates must be a directory.');
  await mkdir(templates, {recursive:true});
  await writeFile(path.join(root, 'repository.json'), json(manifest), {flag:'wx'});
  return {root, manifest};
}

async function sourceProject(input) {
  const absolute = await location(input), info = await lstat(absolute);
  const root = info.isDirectory() ? absolute : path.dirname(absolute);
  const files = Object.create(null), folders = [];
  let total = 0, count = 0;
  if (info.isDirectory()) {
    const walk = async (directory, prefix = '') => {
      for (const entry of (await readdir(directory, {withFileTypes:true})).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix + entry.name;
        if (entry.isSymbolicLink()) fail(`Symbolic links are not allowed: ${relative}`);
        if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name)) continue;
        safePath(relative);
        if (++count > LIMITS.count) fail('A template may contain at most 500 files and folders.');
        if (entry.isDirectory()) { folders.push(relative); await walk(path.join(directory, entry.name), `${relative}/`); }
        else if (entry.isFile()) {
          const data = await boundedFile(path.join(directory, entry.name), isText(relative) ? LIMITS.text : LIMITS.file);
          total += data.byteLength;
          if (total > LIMITS.total) fail('Template exceeds 32 MiB.');
          files[relative] = isText(relative) ? new TextDecoder('utf-8', {fatal:true}).decode(data) : new Uint8Array(data);
        } else fail(`Unsupported template file: ${relative}`);
      }
    };
    await walk(root);
  } else if (info.isFile()) {
    const loaded = await readProject(absolute);
    Object.assign(files, loaded.files);
  } else fail('Template input must be a project directory or .tpl file.');
  const sidecar = path.join(root, VALUES);
  await assertNoSymlinks(sidecar);
  const settings = await stat(sidecar) ? await valuesFile(sidecar) : {};
  return {root, files, folders, settings, directory:info.isDirectory()};
}
function archiveProject(project) {
  const archive = zipSync(unzipSync(createZip(project.files, {directories:project.folders, settings:project.settings})), {level:6, mtime:new Date('2000-01-01T00:00:00Z')});
  // Reopening applies exactly the archive limits and decoding that Studio uses.
  const reopened = readZipProject(archive);
  const {definition} = parseProject(reopened.files);
  const generated = generateProject(reopened.files, reopened.settings);
  return {archive, reopened, generated, entrypoint:definition.entrypoint};
}
function slug(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'template';
}

export async function addTemplate(directory, options = {}) {
  const {root, manifest} = await loadRepository(directory);
  if (!options.path) fail('Template path is required.');
  const source = await location(options.path);
  const sourceInfo = await lstat(source);
  if (sourceInfo.isDirectory() && within(root, source)) fail('The source template must not contain the repository.');
  const name = options.name ?? path.basename(source).replace(/\.tpl(?:\.html)?$/i, '');
  const entry = {id:options.id ?? slug(name), name, version:options.version ?? '1.0.0'};
  if (options.description !== undefined) entry.description = options.description;
  const updated = {...manifest, templates:[...manifest.templates, entry]};
  validateManifest(updated);
  if (manifest.templates.some(item => item.id.toLowerCase() === entry.id.toLowerCase())) fail(`Template ID already exists: ${entry.id}`);
  const target = path.join(root, 'templates', entry.id);
  await assertNoSymlinks(target);
  if (await stat(target)) fail(`Template directory already exists: ${target}`);
  const project = await sourceProject(source);
  if (options.data !== undefined) {
    const overrides = typeof options.data === 'string' ? await valuesFile(await location(options.data)) : options.data;
    if (!object(overrides)) fail('Template values must be a JSON object.');
    project.settings = {...project.settings, ...overrides};
  }
  archiveProject(project);
  let thumbnail;
  if (options.thumbnail !== undefined) {
    if (/^https?:\/\//i.test(options.thumbnail)) entry.thumbnail = options.thumbnail;
    else {
      const filename = await location(options.thumbnail), extension = path.extname(filename).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'].includes(extension)) fail('Thumbnail must be a PNG, JPEG, WebP, GIF, SVG or AVIF image.');
      thumbnail = await boundedFile(filename, LIMITS.file);
      entry.thumbnail = `thumbnails/${entry.id}${extension}`;
      const destination = path.join(root, entry.thumbnail);
      await assertNoSymlinks(destination);
      if (await stat(destination)) fail(`Thumbnail already exists: ${destination}`);
    }
  }
  validateManifest(updated);
  // Build the complete snapshot before attaching its entry to the source manifest.
  await mkdir(path.dirname(target), {recursive:true});
  const staging = await mkdtemp(path.join(path.dirname(target), '.adding-'));
  let installed = false, thumbnailInstalled = false;
  try {
    for (const folder of project.folders) await mkdir(path.join(staging, folder), {recursive:true});
    for (const [relative, contents] of Object.entries(project.files)) {
      await mkdir(path.dirname(path.join(staging, relative)), {recursive:true});
      await writeFile(path.join(staging, relative), contents, {flag:'wx'});
    }
    if (Object.keys(project.settings).length) {
      await mkdir(path.join(staging, '.trafficops'), {recursive:true});
      await writeFile(path.join(staging, VALUES), json(project.settings), {flag:'wx'});
    }
    // Concurrent authoring should never silently replace a newly registered template.
    if (await stat(target)) fail(`Template directory already exists: ${target}`);
    await rename(staging, target); installed = true;
    if (thumbnail) {
      await mkdir(path.dirname(path.join(root, entry.thumbnail)), {recursive:true});
      await writeFile(path.join(root, entry.thumbnail), thumbnail, {flag:'wx'}); thumbnailInstalled = true;
    }
    await atomicJson(path.join(root, 'repository.json'), updated);
  } catch (error) {
    if (installed) await rm(target, {recursive:true, force:true});
    if (thumbnailInstalled) await rm(path.join(root, entry.thumbnail), {force:true});
    throw error;
  } finally { await rm(staging, {recursive:true, force:true}); }
  return {root, entry};
}

async function preflightOutput(output, filenames, force) {
  await assertNoSymlinks(output);
  const info = await stat(output);
  if (info && !info.isDirectory()) fail('Repository output must be a directory.');
  if (info && !force) fail('Output already exists. Use --force to replace generated repository files.');
  for (const relative of filenames) {
    safePath(relative);
    const destination = path.join(output, relative);
    await assertNoSymlinks(destination);
    const existing = await stat(destination);
    if (existing && !existing.isFile()) fail(`Output is not a regular file: ${destination}`);
    if (existing && !force) fail(`Output exists: ${destination}. Use --force to replace generated files.`);
    let parent = path.dirname(destination);
    while (parent !== path.dirname(parent)) {
      const info = await stat(parent);
      if (info && !info.isDirectory()) fail(`Output parent is not a directory: ${parent}`);
      if (parent === output) break;
      parent = path.dirname(parent);
    }
  }
}

export async function bundleRepository(directory, {output, force = false} = {}) {
  const {root, manifest} = await loadRepository(directory);
  const destination = await location(output ?? path.join(root, 'dist'));
  if (within(root, destination) || within(destination, path.join(root, 'templates'))) fail('Output must not overlap repository sources.');
  for (const entry of manifest.templates) {
    const template = path.join(root, 'templates', entry.id);
    if (within(destination, template) || within(template, destination)) fail('Output must not overlap template sources.');
    if (entry.thumbnail && !/^https?:\/\//i.test(entry.thumbnail)) {
      const thumbnail = path.join(root, entry.thumbnail);
      if (within(thumbnail, destination) || within(destination, thumbnail)) fail('Output must not overlap source thumbnails.');
    }
  }
  // Reject the common accidental overwrite before the potentially expensive build.
  await preflightOutput(destination, [], force);
  const staging = await mkdtemp(path.join(os.tmpdir(), 'tops-repository-'));
  const filenames = new Set(), portableNames = new Set(), portableFolders = new Set(), spellings = new Map(), index = {...manifest, templates:[]};
  const stage = async (relative, contents) => {
    safePath(relative);
    if (portableNames.has(relative.toLowerCase()) || portableFolders.has(relative.toLowerCase())) fail(`Generated repository file collision: ${relative}`);
    const parts = relative.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/'), key = prefix.toLowerCase();
      if ((spellings.has(key) && spellings.get(key) !== prefix) || length < parts.length && portableNames.has(key)) fail(`Generated repository path collision: ${relative}`);
      spellings.set(key, prefix);
      if (length < parts.length) portableFolders.add(key);
    }
    filenames.add(relative);
    portableNames.add(relative.toLowerCase());
    const filename = path.join(staging, relative);
    await mkdir(path.dirname(filename), {recursive:true}); await writeFile(filename, contents, {flag:'wx'});
  };
  try {
    for (const entry of manifest.templates) {
      const project = await sourceProject(path.join(root, 'templates', entry.id));
      const {archive, generated, entrypoint} = archiveProject(project);
      const archivePath = `${entry.id}.zip`, preview = `previews/${entry.id}/${entrypoint}`;
      await stage(archivePath, archive);
      for (const [relative, contents] of Object.entries(generated)) await stage(`previews/${entry.id}/${relative}`, contents);
      if (entry.thumbnail && !/^https?:\/\//i.test(entry.thumbnail)) {
        const data = await boundedFile(path.join(root, entry.thumbnail), LIMITS.file);
        if (!filenames.has(entry.thumbnail)) await stage(entry.thumbnail, data);
        else if (!Buffer.from(await readFile(path.join(staging, entry.thumbnail))).equals(data)) fail(`Thumbnail conflicts with a generated file: ${entry.thumbnail}`);
      }
      index.templates.push({...entry, archive:archivePath, preview, sha256:createHash('sha256').update(archive).digest('hex')});
    }
    parseRepositoryIndex(index, BASE);
    if (Buffer.byteLength(json(index)) > INDEX_LIMIT) fail('Generated repository index exceeds 1 MiB.');
    await stage('_headers', '/*\n  Access-Control-Allow-Origin: *\n\n/index.json\n  Cache-Control: no-cache\n');
    // The index is written last so it never advertises an unvalidated, unbuilt template.
    await stage('index.json', json(index));
    await preflightOutput(destination, filenames, force);
    for (const relative of filenames) {
      const target = path.join(destination, relative);
      await mkdir(path.dirname(target), {recursive:true});
      if (!force) await copyFile(path.join(staging, relative), target, constants.COPYFILE_EXCL);
      else {
        const temporary = `${target}.${randomUUID()}.tmp`;
        try { await copyFile(path.join(staging, relative), temporary, constants.COPYFILE_EXCL); await rename(temporary, target); }
        finally { await rm(temporary, {force:true}); }
      }
    }
  } finally { await rm(staging, {recursive:true, force:true}); }
  return {output:destination, index};
}
