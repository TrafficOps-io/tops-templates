import { prepareJavaScript, PROJECT_ORIGIN } from './module-source.js';
import { runProjectPreview } from './runtime.js';

export const INTERACTIVE_SANDBOX = 'allow-scripts allow-forms';
export const INTERACTIVE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data: https:; connect-src blob: data: https:; img-src blob: data: https:; style-src 'unsafe-inline' blob: data: https:; font-src blob: data: https:; media-src blob: data: https:; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action https:";
const MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', wasm: 'application/wasm' };
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Build a complete local snapshot. No settings, credentials or parent RPC port are included. */
export function buildInteractivePreview(files, page) {
  if (!Object.hasOwn(files, page) || !/\.html?$/i.test(page)) throw new Error(`Preview page is missing: ${page}`);
  const runtimeKey = `__trafficops_preview_${crypto.randomUUID().replaceAll('-', '')}`;
  const readyToken = crypto.randomUUID();
  const entries = {}, pages = {}, scripts = {}, dependencies = new Set();
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    const text = typeof content === 'string';
    const data = text ? new TextEncoder().encode(content) : content;
    bytes += data.byteLength;
    if (bytes > 32 * 1024 * 1024) throw new Error('Interactive preview exceeds its 32 MiB project budget.');
    let encoded = content;
    if (!text) {
      let binary = '';
      for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.subarray(index, index + 8192));
      encoded = btoa(binary);
    }
    entries[path] = { data: encoded, binary: !text, type: MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream' };
    if (text && /\.m?js$/i.test(path)) scripts[path] = prepareJavaScript(content, path, runtimeKey, dependencies);
    if (text && /\.html?$/i.test(path)) {
      const document = new DOMParser().parseFromString(content, 'text/html');
      document.querySelectorAll('script:not([src])').forEach(script => {
        const type = (script.getAttribute('type') || '').trim().toLowerCase();
        if (!type || ['module', 'text/javascript', 'application/javascript'].includes(type)) script.textContent = prepareJavaScript(script.textContent, path, runtimeKey, dependencies);
      });
      document.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.setAttribute(attribute.name, prepareJavaScript(attribute.value, path, runtimeKey, dependencies));
      });
      pages[path] = `<!doctype html>\n${document.documentElement.outerHTML}`;
    }
  }
  const snapshot = { entries, pages, scripts, dependencies: [...dependencies], runtimeKey, readyToken, origin: PROJECT_ORIGIN, policy: INTERACTIVE_CSP };
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_CSP}"><meta name="referrer" content="no-referrer"><script>(${runProjectPreview.toString()})(${safeJson(snapshot)},${safeJson(page)});</script></head><body></body></html>`;
  return { html, sandbox: INTERACTIVE_SANDBOX, readyToken, dispose() {} };
}
