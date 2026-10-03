// Portable repository index contract shared by Studio and the publishing CLI.
export const INDEX_LIMIT = 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, label, { optional = false, max = 2000 } = {}) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

export function repositoryUrl(value, base) {
  const input = text(value, 'URL', { max: 4096 });
  let url;
  try { url = new URL(input, base); } catch { throw new Error('Enter a complete HTTP or HTTPS index URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Repository URLs must use HTTP or HTTPS without embedded credentials.');
  url.hash = '';
  return url.href;
}

/** Validate the entire index before replacing the last good catalog. Unknown fields are ignored. */
export function parseRepositoryIndex(input, base) {
  const url = repositoryUrl(base);
  if (!object(input) || input.schemaVersion !== 1) throw new Error('Unsupported repository index. Expected schemaVersion: 1.');
  if (!object(input.repository)) throw new Error('The index needs repository metadata.');
  const meta = input.repository;
  const repository = {
    name: text(meta.name, 'repository name', { max: 160 }),
    description: text(meta.description, 'repository description', { optional: true }),
    author: text(meta.author, 'repository author', { optional: true, max: 160 }),
    homepage: meta.homepage === undefined ? '' : repositoryUrl(meta.homepage, url),
  };
  if (!Array.isArray(input.templates) || input.templates.length > 500) throw new Error('The index must contain a templates array with at most 500 entries.');
  const ids = new Set();
  const templates = input.templates.map(entry => {
    if (!object(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(entry.id)) throw new Error('Each template needs a unique id (1–80 letters, numbers, dots, underscores or hyphens).');
    if (ids.has(entry.id)) throw new Error(`Duplicate template id: ${entry.id}.`);
    ids.add(entry.id);
    if (entry.sha256 !== undefined && (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256))) throw new Error(`Invalid SHA-256 for ${entry.id}.`);
    return {
      id: entry.id,
      name: text(entry.name, 'template name', { max: 160 }),
      description: text(entry.description, 'template description', { optional: true }),
      version: text(entry.version, 'template version', { optional: true, max: 80 }),
      archive: repositoryUrl(entry.archive, url),
      preview: entry.preview === undefined ? '' : repositoryUrl(entry.preview, url),
      thumbnail: entry.thumbnail === undefined ? '' : repositoryUrl(entry.thumbnail, url),
      sha256: entry.sha256?.toLowerCase() || '',
    };
  });
  return { repository, templates };
}

