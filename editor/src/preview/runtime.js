// This function is serialized into an opaque sandbox. Keep it self-contained:
// it receives only generated project bytes and cannot call back into Studio.
export function runProjectPreview(snapshot, selectedPage) {
  // Serialized separately into the authored document's first script, so capture
  // handlers are installed before landing scripts register their own handlers.
  function installSelectionBridge(config, page) {
    const allowed = new Map((config.pages[page] || []).map(block => [block.id, block]));
    // Navigated opaque blob documents may not expose secure-context randomUUID.
    const documentToken = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
    let enabled = false, selected = new Set(), hovered = null, overlay = null, layer = null, scheduled = false;
    const report = (type = 'trafficops-preview-selection-change') => parent.postMessage({ type, version: 1, token: config.token, documentToken, page, selectedIds: [...selected], hoverAncestorIds: hovered ? allowed.get(hovered)?.ancestorIds || [] : [] }, '*');
    const instance = target => {
      for (let node = target instanceof Element ? target : target?.parentElement; node; node = node.parentElement) {
        const id = node.getAttribute('data-tops-block-instance');
        if (id && allowed.has(id)) return id;
      }
      return null;
    };
    function draw() {
      scheduled = false;
      if (!enabled || !document.body) { overlay?.remove(); overlay = null; layer = null; return; }
      if (!overlay?.isConnected) {
        overlay = document.createElement('div');
        overlay.setAttribute('data-tops-selection-overlay', '');
        overlay.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
        const shadow = overlay.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = ':host{pointer-events:none!important}.box{position:fixed;box-sizing:border-box;border:2px solid #635bff;background:rgba(99,91,255,.06);pointer-events:none}.box.hover{border-style:dashed;background:rgba(99,91,255,.02)}.label{position:absolute;left:-2px;top:0;transform:translateY(-100%);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#635bff;color:white;font:12px/1.4 system-ui,sans-serif;padding:2px 5px;border-radius:3px 3px 0 0}.box.near-top .label{transform:none}';
        layer = document.createElement('div'); shadow.append(style, layer); document.body.append(overlay);
      }
      layer.replaceChildren();
      for (const node of document.querySelectorAll('[data-tops-block-instance]')) {
        const id = node.getAttribute('data-tops-block-instance');
        if (!allowed.has(id) || !selected.has(id) && id !== hovered) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
        const box = document.createElement('div');
        box.className = `box${selected.has(id) ? '' : ' hover'}${rect.top < 24 ? ' near-top' : ''}`;
        box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
        const label = document.createElement('span'); label.className = 'label'; label.textContent = allowed.get(id).label;
        box.append(label); layer.append(box);
      }
    }
    const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } };
    addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || message?.type !== 'trafficops-preview-selection-control' || message.version !== 1 || message.token !== config.token || message.documentToken !== documentToken || typeof message.enabled !== 'boolean' || !Array.isArray(message.selectedIds)) return;
      enabled = message.enabled; selected = new Set(message.selectedIds.filter(id => typeof id === 'string' && allowed.has(id)));
      if (!enabled) hovered = null;
      schedule();
    });
    const suppress = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    addEventListener('click', event => {
      if (!enabled) return;
      suppress(event);
      if (event.button !== 0) return;
      const id = instance(event.target);
      if (!id) return;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      report(); schedule();
    }, true);
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'submit']) addEventListener(name, event => {
      if (!enabled) return;
      // Touch scrolling remains available while form/control handlers are suppressed.
      if (event.pointerType === 'touch' && name.startsWith('pointer')) event.stopImmediatePropagation(); else suppress(event);
    }, true);
    addEventListener('keydown', event => { if (enabled && ['Enter', ' '].includes(event.key)) suppress(event); }, true);
    addEventListener('pointermove', event => {
      if (!enabled) return;
      const next = instance(event.target);
      // Hover only redraws the local overlay. Reporting the iframe's previous selection here
      // can overwrite a newer selection made by the parent's section picker.
      if (hovered !== next) { hovered = next; schedule(); }
    }, true);
    addEventListener('mouseout', event => { if (enabled && !event.relatedTarget) { hovered = null; schedule(); } }, true);
    addEventListener('scroll', schedule, true); addEventListener('resize', schedule);
    const loaded = () => {
      const observer = new MutationObserver(records => {
        if (enabled && records.some(record => record.target !== overlay && !overlay?.contains(record.target))) schedule();
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      report('trafficops-preview-selection-ready'); schedule();
    };
    if (document.readyState === 'complete') loaded(); else addEventListener('load', loaded, { once: true });
  }
  const { entries, pages, scripts, origin, runtimeKey, policy } = snapshot;
  const base = new URL(selectedPage, `${origin}/`), urls = new Map(), reverse = new Map(), pending = new Set();
  const nativeFetch = globalThis.fetch.bind(globalThis);
  // Keep import attributes native instead of letting the Studio bundler rewrite
  // this serialized function to helpers outside the isolated frame.
  const nativeImport = new Function('url', 'options', 'return import(url, options)');
  const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const bytes = entry => entry.binary ? Uint8Array.from(atob(entry.data), character => character.charCodeAt(0)) : entry.data;
  const pathOf = url => { try { return url.origin === origin ? decodeURIComponent(url.pathname.slice(1)) : null; } catch { return null; } };
  const logicalUrl = (value, from = base.href) => new URL(reverse.get(String(value)) || String(value), from);
  const sourceDocument = new DOMParser().parseFromString(pages[pathOf(base)], 'text/html');
  const authorImports = {}, authorScopes = {};
  sourceDocument.querySelectorAll('script[type="importmap"]').forEach(script => {
    try {
      const map = JSON.parse(script.textContent);
      Object.assign(authorImports, map.imports || {});
      for (const [scope, imports] of Object.entries(map.scopes || {})) authorScopes[new URL(scope, base).href] = imports;
    } catch { /* The browser reports invalid authored JavaScript separately. */ }
    script.remove();
  });
  function mappedImport(value, mapping) {
    const normalized = /^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(value) ? logicalUrl(value).href : value;
    for (const [key, target] of Object.entries(mapping)) {
      const normalizedKey = /^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(key) ? logicalUrl(key).href : key;
      if (normalizedKey === normalized) return new URL(target, base).href;
    }
    const prefixes = Object.keys(mapping).filter(key => key.endsWith('/')).sort((a, b) => b.length - a.length);
    for (const key of prefixes) {
      const normalizedKey = /^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(key) ? logicalUrl(key).href : key;
      if (normalized.startsWith(normalizedKey)) return new URL(mapping[key] + normalized.slice(normalizedKey.length), base).href;
    }
    return null;
  }
  function resolveImport(value, from = base.href) {
    value = String(value);
    if (/^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(value)) value = logicalUrl(value, from).href;
    for (const scope of Object.keys(authorScopes).filter(scope => from.startsWith(scope)).sort((a, b) => b.length - a.length)) {
      const mapped = mappedImport(value, authorScopes[scope]); if (mapped) return mapped;
    }
    const mapped = mappedImport(value, authorImports); if (mapped) return mapped;
    if (!/^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(value)) throw new TypeError(`Unmapped module specifier: ${value}`);
    return logicalUrl(value, from).href;
  }
  function blob(contents, type, logical) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    if (logical) reverse.set(url, logical);
    return url;
  }
  function asset(value, from = base.href) {
    if (!value || /^(?:data:|blob:|#)/i.test(value)) return value;
    const url = logicalUrl(value, from), path = pathOf(url);
    if (path === null) return url.protocol === 'https:' ? url.href : 'data:,';
    const entry = entries[path];
    if (!entry) return 'data:,';
    if (urls.has(path)) return urls.get(path) + url.hash;
    if (pending.has(path)) return 'data:,';
    pending.add(path);
    let content = Object.hasOwn(scripts, path) ? scripts[path] : bytes(entry);
    if (entry.type === 'text/css') content = rewriteCss(String(content), url.href);
    const result = blob(content, entry.type, url.href);
    urls.set(path, result); pending.delete(path);
    return result + url.hash;
  }
  function rewriteCss(css, from = base.href) {
    return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_, quote, value) => `url(${JSON.stringify(asset(value, from))})`)
      .replace(/@import\s+(["'])(.*?)\1/gi, (_, quote, value) => `@import ${JSON.stringify(asset(value, from))}`);
  }
  function documentUrl(target) {
    const url = logicalUrl(target), path = pathOf(url);
    if (!Object.hasOwn(pages, path)) return null;
    const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><script>(${runProjectPreview.toString()})(${safeJson(snapshot)},${safeJson(url.pathname.slice(1) + url.search + url.hash)});<\/script></head><body></body></html>`;
    return blob(html, 'text/html', url.href) + url.hash;
  }
  function navigate(target, replace = false) {
    const url = logicalUrl(target), path = pathOf(url);
    if (path === pathOf(base) && url.search === base.search && url.hash) {
      base.hash = url.hash;
      document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
      return;
    }
    const destination = documentUrl(url.href) || (url.protocol === 'https:' ? url.href : null);
    if (!destination) throw new Error(`Preview page is missing: ${target}`);
    if (replace) location.replace(destination); else location.assign(destination);
  }
  const projectLocation = {
    assign: value => navigate(value), replace: value => navigate(value, true), reload: () => navigate(base.href, true),
    toString: () => base.href,
  };
  for (const property of ['href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) Object.defineProperty(projectLocation, property, {
    enumerable: true, get: () => base[property], set: value => {
      if (property === 'href') { navigate(value); return; }
      const next = new URL(base); next[property] = value; navigate(next.href);
    },
  });
  Object.defineProperty(projectLocation, 'origin', { get: () => origin });
  const runtime = Object.freeze({
    resolve: resolveImport,
    async import(value, from, options) {
      const url = resolveImport(value, from);
      return nativeImport(asset(url), options);
    },
    navigate,
    get location() { return projectLocation; }, set location(value) { navigate(value); },
  });
  Object.defineProperty(globalThis, runtimeKey, { value: runtime });
  globalThis.fetch = async (input, options = {}) => {
    const request = input instanceof NativeRequest ? input : null;
    const url = logicalUrl(request ? request.url : input);
    const path = pathOf(url);
    if (path === null) return nativeFetch(request || url.href, { credentials: 'omit', ...options });
    const signal = options.signal || request?.signal;
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const method = (options.method || request?.method || 'GET').toUpperCase();
    const entry = entries[path];
    const response = !['GET', 'HEAD'].includes(method) ? new Response('Local preview resources are read-only.', { status: 405 })
      : !entry ? new Response('Project file not found.', { status: 404 })
        : new Response(method === 'HEAD' ? null : bytes(entry), { headers: { 'Content-Type': entry.type } });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  };
  sourceDocument.querySelectorAll('base, iframe, frame, object, embed, meta[http-equiv]').forEach(node => node.remove());
  sourceDocument.querySelectorAll('*').forEach(node => {
    for (const name of ['src', 'poster', 'background']) if (node.hasAttribute(name)) node.setAttribute(name, asset(node.getAttribute(name)));
    if (node.hasAttribute('srcset')) node.setAttribute('srcset', node.getAttribute('srcset').split(',').map(part => { const [url, ...descriptor] = part.trim().split(/\s+/); return [asset(url), ...descriptor].join(' '); }).join(', '));
    if (node.hasAttribute('style')) node.setAttribute('style', rewriteCss(node.getAttribute('style')));
    if (node.tagName === 'LINK' && node.hasAttribute('href')) node.setAttribute('href', asset(node.getAttribute('href')));
    if ((node.tagName === 'A' || node.tagName === 'AREA') && node.hasAttribute('href')) node.setAttribute('href', logicalUrl(node.getAttribute('href')).href);
    if (node.tagName === 'FORM') {
      if (node.hasAttribute('action')) node.setAttribute('action', logicalUrl(node.getAttribute('action')).href);
      node.setAttribute('target', '_self');
    }
  });
  sourceDocument.querySelectorAll('style').forEach(node => { node.textContent = rewriteCss(node.textContent); });
  const imports = {}, scopes = {};
  for (const path of Object.keys(entries)) if (!/\.html?$/i.test(path)) imports[new URL(path, `${origin}/`).href] = asset(new URL(path, `${origin}/`).href);
  for (const [specifier, value] of Object.entries(authorImports)) if (!specifier.endsWith('/')) imports[specifier] = asset(new URL(value, base).href);
  for (const dependency of snapshot.dependencies) {
    try { imports[dependency] = asset(resolveImport(dependency)); } catch { /* Unmapped imports produce the browser's normal module error. */ }
  }
  if (Object.keys(authorScopes).length) for (const path of Object.keys(scripts)) {
    const logical = new URL(path, `${origin}/`).href, scoped = {};
    for (const dependency of snapshot.dependencies) {
      try { scoped[dependency] = asset(resolveImport(dependency, logical)); } catch { /* Native module errors remain visible in DevTools. */ }
    }
    scopes[asset(logical)] = scoped;
  }
  const map = sourceDocument.createElement('script'); map.type = 'importmap'; map.textContent = safeJson({ imports, scopes });
  sourceDocument.head.prepend(map);
  const csp = sourceDocument.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy'; csp.content = policy;
  sourceDocument.head.prepend(csp);
  if (snapshot.selection) {
    const bridge = sourceDocument.createElement('script');
    bridge.textContent = `(${installSelectionBridge.toString()})(${safeJson(snapshot.selection)},${safeJson(pathOf(base))});`;
    // Keep CSP before executable content, and the bridge before author scripts.
    csp.after(bridge);
  }
  // These adapters resolve project paths, not permissions. The iframe sandbox
  // and CSP still enforce isolation if author code replaces any adapter.
  const nativeSetAttribute = Element.prototype.setAttribute;
  function attributeValue(node, name, value) {
    if (['src', 'poster', 'background'].includes(name) || name === 'href' && node.tagName === 'LINK') return asset(String(value));
    if (name === 'style') return rewriteCss(String(value));
    if (['href', 'action', 'formaction'].includes(name) && !/^javascript:/i.test(String(value))) return logicalUrl(value).href;
    return value;
  }
  Element.prototype.setAttribute = function(name, value) { return nativeSetAttribute.call(this, name, attributeValue(this, String(name).toLowerCase(), value)); };
  for (const [className, properties] of Object.entries({ HTMLImageElement: ['src'], HTMLScriptElement: ['src'], HTMLLinkElement: ['href'], HTMLMediaElement: ['src'], HTMLSourceElement: ['src'], HTMLVideoElement: ['poster'], HTMLAnchorElement: ['href'], HTMLFormElement: ['action'], HTMLInputElement: ['src', 'formAction'], HTMLButtonElement: ['formAction'] })) {
    const prototype = globalThis[className]?.prototype;
    if (!prototype) continue;
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor?.set) Object.defineProperty(prototype, property, { ...descriptor, set(value) { descriptor.set.call(this, attributeValue(this, property.toLowerCase(), value)); } });
    }
  }
  const NativeRequest = globalThis.Request;
  globalThis.Request = class extends NativeRequest { constructor(input, options) { super(typeof input === 'string' || input instanceof URL ? logicalUrl(input).href : input, options); } };
  for (const property of ['URL', 'documentURI', 'baseURI']) Object.defineProperty(document, property, { get: () => base.href, configurable: true });
  document.open(); document.write(`<!doctype html>\n${sourceDocument.documentElement.outerHTML}`); document.close();
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    parent.postMessage({ type: 'trafficops-preview-ready', token: snapshot.readyToken }, '*');
  }));
  if (document.readyState === 'complete') ready(); else addEventListener('load', ready, { once: true });
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href],area[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || anchor.hasAttribute('download')) return;
    const url = logicalUrl(anchor.getAttribute('href'));
    if (pathOf(url) === null) return;
    event.preventDefault(); navigate(url.href);
  });
  document.addEventListener('submit', event => {
    if (event.defaultPrevented) return;
    const form = event.target, action = event.submitter?.getAttribute('formaction') || form.getAttribute('action') || base.href;
    const url = logicalUrl(action);
    if (pathOf(url) === null) return;
    event.preventDefault();
    if ((form.method || 'get').toLowerCase() !== 'get') { console.error('A local preview cannot process a server-side form POST.'); return; }
    for (const [key, value] of new FormData(form, event.submitter)) if (typeof value === 'string') url.searchParams.append(key, value);
    navigate(url.href);
  });
  if (base.hash) addEventListener('load', () => document.getElementById(decodeURIComponent(base.hash.slice(1)))?.scrollIntoView(), { once: true });
}
