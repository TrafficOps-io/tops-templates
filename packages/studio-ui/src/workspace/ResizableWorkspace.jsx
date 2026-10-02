import { useEffect, useRef, useState } from 'react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import { activeElement, inertOutside } from './focus.js';

const defaultPanels = { sidebar: '.file-sidebar', author: '.author-panel', toolbar: '.studio-toolbar', previewCollapsed: 'preview-collapsed' };
const defaultMinimums = { sidebar: 192, author: 320, preview: 288 };
const defaultModalSelector = 'dialog[open], [aria-modal="true"]';
export default function ResizableWorkspace({ children, className, ref: forwardedRef, t: translate, panels = defaultPanels, minimums = defaultMinimums, storageKey = 'studio-panel-widths', modalSelector = defaultModalSelector, contentInert = false, ...attributes }) {
  const context = useStudioText();
  const t = translate || context;
  const root = useRef(null), drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [widths, setWidths] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey)); return saved && ['sidebar', 'author'].every(key => Number.isFinite(saved[key]) && saved[key] > 0) ? saved : {}; } catch { return {}; }
  });
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [positions, setPositions] = useState([0, 0]);
  useEffect(() => {
    const element = root.current;
    const measure = () => {
      const sidebar = element.querySelector(panels.sidebar).getBoundingClientRect().width;
      const author = element.querySelector(panels.author).getBoundingClientRect().width;
      setPositions([sidebar, sidebar + author]);
      setToolbarHeight(element.querySelector(panels.toolbar)?.getBoundingClientRect().height || 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(element.querySelector(panels.sidebar)); observer.observe(element.querySelector(panels.author));
    measure(); return () => observer.disconnect();
  }, [panels.sidebar, panels.author, panels.toolbar]);
  // A modal layer inside the workspace (dialog[open] or aria-modal) takes modality: everything around it becomes inert,
  // separators included. `contentInert` does the same for a modal the host renders outside the workspace.
  useEffect(() => {
    const element = root.current;
    let current = null, release = null, lastFocus = null;
    const apply = () => {
      const layer = contentInert ? element : [...element.querySelectorAll(modalSelector)].at(-1) || null;
      if (layer === current) return;
      if (release) {
        release(); release = null;
        const active = activeElement(element);
        if ((!active || !element.contains(active)) && lastFocus?.isConnected && !lastFocus.closest('[inert]')) lastFocus.focus();
      }
      current = layer;
      if (layer === element) { const marked = [...element.children].filter(child => !child.hasAttribute('inert')); marked.forEach(child => child.setAttribute('inert', '')); release = () => marked.forEach(child => child.removeAttribute('inert')); }
      else if (layer) release = inertOutside(element, layer);
    };
    const remember = event => { const owner = event.target.closest(modalSelector); if (!owner || owner === element) lastFocus = event.target; };
    const observer = new MutationObserver(apply);
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'aria-modal'] });
    element.addEventListener('focusin', remember);
    apply();
    return () => { observer.disconnect(); element.removeEventListener('focusin', remember); release?.(); };
  }, [modalSelector, contentInert]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* Resizing still works without storage. */ } }, [widths, storageKey]);
  function resize(index, desired) {
    const element = root.current, total = element.clientWidth;
    const sidebar = element.querySelector(panels.sidebar).getBoundingClientRect().width;
    const author = element.querySelector(panels.author).getBoundingClientRect().width;
    const previewMinimum = element.classList.contains(panels.previewCollapsed) ? 0 : minimums.preview;
    const maximum = index === 0 ? total - (previewMinimum ? author : minimums.author) - previewMinimum : total - sidebar - previewMinimum;
    const minimum = index === 0 ? minimums.sidebar : minimums.author;
    setWidths(previous => ({ ...previous, [index === 0 ? 'sidebar' : 'author']: Math.max(minimum, Math.min(maximum, desired)) }));
  }
  return <div {...attributes} ref={node => { root.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }} className={`${className} resizable-workspace ${dragging ? 'is-resizing' : ''}`} style={{ '--toolbar-height': `${toolbarHeight}px`, '--saved-sidebar': widths.sidebar ? `${widths.sidebar}px` : undefined, '--saved-author': widths.author ? `${widths.author}px` : undefined }}>
    {children}
    {[0, 1].map(index => <div key={index} role="separator" aria-orientation="vertical" aria-label={index === 0 ? t('Resize project files') : t('Resize editor and preview')} aria-valuenow={Math.round(index === 0 ? positions[0] : positions[1] - positions[0])} tabIndex={0} className={`panel-resizer resizer-${index}`} style={{ left: positions[index] }} title={t('Drag to resize · double-click to reset')}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: index === 0 ? positions[0] : positions[1] - positions[0] }; setDragging(true); }}
      onPointerMove={event => { if (drag.current) resize(index, drag.current.width + event.clientX - drag.current.x); }}
      onPointerUp={event => { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onDoubleClick={() => setWidths({})}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return; event.preventDefault(); if (event.key === 'Home') setWidths({}); else resize(index, (index === 0 ? positions[0] : positions[1] - positions[0]) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10)); }} />)}
  </div>;
}
