import { createRoot } from 'react-dom/client';
import EditorShell from '@trafficops/template-editor-shell';
import { createHttpHost } from '../embedded/src/HttpHost.js';
import '../embedded/src/embed.css';

export function HostedEditor({ host }) {
  return <EditorShell host={host} className="hosted-editor" showExportFooter={false} />;
}

// Styles finish loading before React mounts, including on a cold Shadow DOM load.
export function mountEditor(element, options) {
  const shadow = element.shadowRoot || element.attachShadow({ mode: 'open' });
  const controller = new AbortController();
  let root, host, sheet, link, disposed = false;
  const container = document.createElement('div');
  const cssUrl = new URL('./editor.css', import.meta.url); cssUrl.search = new URL(import.meta.url).search;
  async function styles() {
    if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet.prototype.replace === 'function') {
      const response = await fetch(cssUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('The editor stylesheet could not be loaded.');
      const css = (await response.text()).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (match, quote, url) => /^(?:data:|https?:|#)/.test(url) ? match : `url("${new URL(url, cssUrl).href}")`);
      sheet = new CSSStyleSheet(); await sheet.replace(css);
      if (!disposed) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
    } else {
      await new Promise((resolve, reject) => {
        link = document.createElement('link'); link.rel = 'stylesheet'; link.href = cssUrl.href;
        link.onload = resolve; link.onerror = () => reject(new Error('The editor stylesheet could not be loaded.')); shadow.append(link);
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      });
    }
  }
  (async () => {
    await styles();
    if (disposed) return;
    host = await createHttpHost({ ...options, signal: controller.signal });
    if (disposed) { await host.dispose?.(); return; }
    shadow.append(container); root = createRoot(container); root.render(<HostedEditor host={host} />);
  })().catch(error => {
    if (disposed) return;
    container.setAttribute('role', 'alert'); container.textContent = error.message; shadow.append(container);
  });
  return () => {
    disposed = true; controller.abort(); root?.unmount(); container.remove(); link?.remove();
    if (sheet) shadow.adoptedStyleSheets = shadow.adoptedStyleSheets.filter(value => value !== sheet);
    host?.dispose?.();
  };
}
