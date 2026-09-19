import { useStudioText } from './studio-i18n.js';
import { useEffect, useId, useRef } from 'react';
import { activeElement, focusableElements, trapFocus } from './focus.js';
export default function Modal({ title, children, onClose, onSubmit, confirmLabel, confirmFirst = false, busy = false }) {
  const t = useStudioText();
  const root = useRef(null), confirm = useRef(null), id = useId();
  useEffect(() => {
    const previous = activeElement(root.current);
    (confirmFirst ? confirm.current : root.current.querySelector('input:not([type="hidden"]),select,textarea') || focusableElements(root.current)[0])?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  return <div className="hosted-modal" ref={root} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); } else trapFocus(event, root.current); }} onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="hosted-dialog" onSubmit={onSubmit}><h2 id={id}>{title}</h2>{children}<div className="modal-action"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button ref={confirm} type="submit" className="btn btn-primary" disabled={busy}>{confirmLabel}</button></div></form>
  </div>;
}
