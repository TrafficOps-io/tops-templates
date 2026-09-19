import { useEffect, useRef, useState } from 'react';
import { useStudioText } from './studio-i18n.js';

const storageKey = 'studio-panel-widths';
export default function ResizableWorkspace({ children, className, ref: forwardedRef, ...attributes }) {
  const t = useStudioText();
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
      const sidebar = element.querySelector('.file-sidebar').getBoundingClientRect().width;
      const author = element.querySelector('.author-panel').getBoundingClientRect().width;
      setPositions([sidebar, sidebar + author]);
      setToolbarHeight(element.querySelector('.studio-toolbar')?.getBoundingClientRect().height || 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(element.querySelector('.file-sidebar')); observer.observe(element.querySelector('.author-panel'));
    measure(); return () => observer.disconnect();
  }, []);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* Resizing still works without storage. */ } }, [widths]);
  function resize(index, desired) {
    const element = root.current, total = element.clientWidth;
    const sidebar = element.querySelector('.file-sidebar').getBoundingClientRect().width;
    const author = element.querySelector('.author-panel').getBoundingClientRect().width;
    const previewMinimum = element.classList.contains('preview-collapsed') ? 0 : 240;
    const maximum = index === 0 ? total - (previewMinimum ? author : 288) - previewMinimum : total - sidebar - previewMinimum;
    const minimum = index === 0 ? 176 : 288;
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
