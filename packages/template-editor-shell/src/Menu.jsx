import { useEffect, useId, useRef, useState } from 'react';

export default function Menu({ label, trigger, children, className = '', triggerClassName = '', disabled = false }) {
  const [open, setOpen] = useState(false), root = useRef(null), button = useRef(null), popup = useRef(null), id = useId();
  const items = () => [...(popup.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
  const close = (restore = true) => { setOpen(false); if (restore) button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const dismiss = event => { if (!event.composedPath().includes(root.current)) close(false); };
    const document = root.current.ownerDocument;
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  function keyDown(event) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && !disabled) { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const choices = items(), active = root.current.getRootNode().activeElement, index = choices.indexOf(active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    choices[next]?.focus();
  }
  return <div className={`editor-menu ${className}`} ref={root} onKeyDown={keyDown}>
    <button ref={button} type="button" className={triggerClassName} aria-label={label} aria-haspopup="menu" aria-controls={id} aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && <div ref={popup} id={id} className="editor-popover" role="menu" aria-label={label}>{children({ close })}</div>}
  </div>;
}
