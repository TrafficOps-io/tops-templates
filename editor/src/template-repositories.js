import { LIMITS } from '@trafficops/template-editor-core';
import { readArchive } from './hosts/read-archive.js';
import { INDEX_LIMIT, repositoryUrl, parseRepositoryIndex } from '../../runtime/src/repository-index.js';

export { INDEX_LIMIT, repositoryUrl, parseRepositoryIndex };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export const REPOSITORIES_KEY = 'trafficops-template-repositories-v1';
export const DEFAULT_REPOSITORY_PATH = '/template-repositories/trafficops/index.json';
export const DEMO_REPOSITORY_PATH = '/template-repositories/demo/index.json';
export const DEFAULT_REPOSITORIES = Object.freeze([
  { id: 'trafficops', name: 'TrafficOps starters', path: DEFAULT_REPOSITORY_PATH },
  { id: 'trafficops-demo', name: 'TrafficOps Demo', path: DEMO_REPOSITORY_PATH },
]);
async function readBounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(`Download exceeds ${limit / 1024 / 1024} MiB.`); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error(`Download exceeds ${limit / 1024 / 1024} MiB.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function downloadRepositoryFile(url, { limit = INDEX_LIMIT, signal, fetcher = fetch, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('The repository request timed out. Try again.')), timeout);
  try {
    const response = await fetcher(repositoryUrl(url), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' });
    if (!response.ok) throw new Error(`Repository request failed (HTTP ${response.status}). Check the URL and try again.`);
    return { bytes: await readBounded(response, limit), url: repositoryUrl(response.url || url) };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TypeError) throw new Error('Could not reach the repository. Check your connection and the host’s CORS settings.', { cause: error });
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function fetchRepositoryIndex(url, options) {
  const result = await downloadRepositoryFile(url, options);
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)); }
  catch { throw new Error('The repository URL must return a UTF-8 JSON index, not an HTML page.'); }
  return { ...parseRepositoryIndex(input, result.url), index: input, resolvedUrl: result.url };
}

export function repositoryTemplates(record) {
  return (record.catalog?.templates || []).map(template => ({ ...template, templateId: template.id,
    id: `repository:${record.id}:${template.id}`, repositoryId: record.id, repositoryName: record.catalog.repository.name,
    repositoryUrl: record.url, kind: 'template', builtin: record.builtin === true,
  }));
}

/** Cached ZIPs are keyed by every field identifying a release, never just the template id. */
export async function loadRepositoryTemplate(template, { signal, fetcher = fetch, cacheStorage = globalThis.caches, offline = globalThis.navigator?.onLine === false } = {}) {
  let cache;
  try { cache = await cacheStorage?.open(`trafficops-template-repository-${template.repositoryId}`); } catch { /* Private storage may block Cache API. */ }
  const key = new URL(template.archive);
  key.searchParams.append('__studio_release', JSON.stringify([template.templateId, template.version, template.sha256]));
  let bytes, fromCache = false;
  const cached = offline && await cache?.match(key.href);
  if (cached) { bytes = await readBounded(cached, LIMITS.archive); fromCache = true; }
  else {
    try { ({ bytes } = await downloadRepositoryFile(template.archive, { limit: LIMITS.archive, timeout: 60000, signal, fetcher })); }
    catch (error) {
      // Only a network failure can fall back. HTTP errors, oversized downloads and cancellation remain visible.
      const fallback = error.cause instanceof TypeError && await cache?.match(key.href);
      if (!fallback) throw error;
      bytes = await readBounded(fallback, LIMITS.archive); fromCache = true;
    }
  }
  if (template.sha256) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== template.sha256) throw new Error('The template ZIP does not match its SHA-256. Refresh the repository or contact its author.');
  }
  const archive = await readArchive(bytes.slice(), { signal });
  if (!Object.keys(archive.files).length) throw new Error('The template ZIP contains no project files.');
  if (!fromCache && cache) {
    try {
      await cache.put(key.href, new Response(bytes));
      const entries = await cache.keys();
      for (const entry of entries.slice(0, Math.max(0, entries.length - 20))) await cache.delete(entry);
    } catch { /* Cache quota never prevents creating a project. */ }
  }
  // Identity, AI briefs and conversations in a source export do not belong to a new template copy.
  return { ...template, files: archive.files, folders: archive.folders || [], settings: archive.settings || {} };
}

export function readRepositories(storage, base) {
  const fallback = DEFAULT_REPOSITORIES.map(({ id, path }) => ({ id, url: repositoryUrl(path, base), enabled: true, builtin: true }));
  const raw = storage.getItem(REPOSITORIES_KEY);
  if (!raw) return fallback;
  const saved = JSON.parse(raw);
  if (saved.schemaVersion !== 1 || !Array.isArray(saved.repositories) || saved.repositories.length > 50) throw new Error('Saved repositories are invalid.');
  if (saved.knownDefaults !== undefined && (!Array.isArray(saved.knownDefaults) || saved.knownDefaults.length > 50 || saved.knownDefaults.some(id => typeof id !== 'string'))) throw new Error('Saved default repositories are invalid.');
  // Older preferences have already offered the original starter repo. Offer each newly bundled
  // repository once, then remember that choice even if the user disables or removes it.
  const knownDefaults = saved.knownDefaults || ['trafficops'];
  const ids = new Set(), urls = new Set();
  const repositories = saved.repositories.map(entry => {
    if (!object(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{1,50}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Saved repository id is invalid.');
    const url = repositoryUrl(entry.url);
    if (urls.has(url)) throw new Error('Saved repository URLs are duplicated.');
    ids.add(entry.id); urls.add(url);
    const catalog = entry.index ? parseRepositoryIndex(entry.index, entry.resolvedUrl || url) : undefined;
    return { id: entry.id, url, enabled: entry.enabled !== false, builtin: fallback.some(record => record.url === url),
      index: entry.index, resolvedUrl: entry.resolvedUrl, updatedAt: entry.updatedAt, catalog };
  });
  for (const entry of fallback) {
    if (repositories.length >= 50 || knownDefaults.includes(entry.id) || urls.has(entry.url)) continue;
    repositories.push({ ...entry, id: ids.has(entry.id) ? crypto.randomUUID() : entry.id });
  }
  return repositories;
}

export function saveRepositories(storage, repositories) {
  storage.setItem(REPOSITORIES_KEY, JSON.stringify({ schemaVersion: 1, knownDefaults: DEFAULT_REPOSITORIES.map(entry => entry.id), repositories: repositories.map(({ catalog, loading, error, ...entry }) => entry) }));
}
