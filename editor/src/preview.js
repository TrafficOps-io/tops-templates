const MIME = { css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', mp4: 'video/mp4', mp3: 'audio/mpeg' };
export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PREVIEW_LIMIT = 32 * 1024 * 1024;

export function resolveAsset(path, from) {
  const value = path.trim();
  if (!value || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value) || /[\\\x00-\x1f]/.test(value)) return null;
  const parts = value.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of value.split(/[?#]/)[0].split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

// Reserve encoded sizes BEFORE substitution/allocation: repeated CSS imports or
// repeated large images must not multiply a bounded project into an unbounded DOM.
export function createAssetResolver(files, { limit = PREVIEW_LIMIT } = {}) {
  const urls = new Map(), pending = new Set();
  let remaining = limit;
  const reserve = length => {
    remaining -= length;
    if (remaining < 0) throw new Error('Preview exceeds its 32 MiB budget. Reduce repeated assets or CSS imports; you can still download generated pages.');
  };
  const objectURL = path => {
    if (!Object.hasOwn(files, path) || pending.has(path)) return null;
    if (urls.has(path)) return urls.get(path);
    if (pending.size >= 12) throw new Error('Preview CSS imports are nested too deeply (maximum 12). Flatten the stylesheets or download the generated pages.');
    pending.add(path);
    let value = files[path];
    const extension = path.split('.').pop().toLowerCase();
    if (extension === 'css' && typeof value === 'string') value = rewriteCSS(value, path);
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const type = MIME[extension] || 'application/octet-stream';
    reserve(Math.ceil(bytes.length / 3) * 4 + type.length + 13);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    const url = `data:${type};base64,${btoa(binary)}`;
    urls.set(path, url); pending.delete(path);
    return url;
  };
  const asset = (value, from) => {
    let url;
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(value)) url = value;
    else { const path = resolveAsset(value, from); url = path ? objectURL(path) : null; }
    if (url) reserve(url.length);
    return url;
  };
  const rewriteCSS = (value, from) => {
    reserve(value.length);
    return value
      .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_, _quote, path) => `url("${asset(path, from) || 'data:,'}")`)
      .replace(/@import\s+(["'])(.*?)\1/gi, (_, _quote, path) => `@import "${asset(path, from) || 'data:,'}"`);
  };
  return { asset, rewriteCSS, reserve, dispose: () => urls.clear() };
}

// Only the preview uses in-memory data URLs. Generated files retain their paths.
// Data URLs work inside an opaque-origin iframe; same-origin blob URLs do not.
export function buildPreview(files, page) {
  const resolver = createAssetResolver(files);
  const { asset, rewriteCSS, reserve } = resolver;
  try {
    const source = String(files[page] || '');
    reserve(source.length * 2);
    const document = new DOMParser().parseFromString(source, 'text/html');
    document.querySelectorAll('script, base, iframe, frame, object, embed, meta[http-equiv], link:not([rel="stylesheet"])').forEach(node => node.remove());
    document.querySelectorAll('*').forEach(node => {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || ['srcdoc', 'ping', 'action', 'formaction', 'target'].includes(attr.name)) node.removeAttribute(attr.name);
      }
      if (node.hasAttribute('style')) node.setAttribute('style', rewriteCSS(node.getAttribute('style'), page));
      for (const key of ['src', 'poster', 'background']) {
        if (node.hasAttribute(key)) node.setAttribute(key, asset(node.getAttribute(key), page) || 'data:,');
      }
      node.removeAttribute('srcset');
      if (node.tagName === 'LINK') {
        const url = asset(node.getAttribute('href') || '', page);
        if (url) node.setAttribute('href', url); else node.remove();
      } else if (node.hasAttribute('href')) node.removeAttribute('href');
    });
    document.querySelectorAll('style').forEach(node => { node.textContent = rewriteCSS(node.textContent, page); });
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy'; policy.content = PREVIEW_CSP;
    document.head.prepend(policy);
    return { html: `<!doctype html>\n${document.documentElement.outerHTML}`, dispose: resolver.dispose };
  } catch (error) { resolver.dispose(); throw error; }
}
