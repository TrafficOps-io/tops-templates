import { useEffect, useId, useRef } from 'react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import { activeElement, focusableElements, trapFocus } from '../workspace/focus.js';
export default function Modal({ title, children, onClose, onSubmit, confirmLabel, confirmFirst = false, busy = false, confirmClassName = 'studio-button studio-button-primary studio-button-md btn btn-primary', t: translate }) {
  const context = useStudioText(), t = translate || context;
  const root = useRef(null), confirm = useRef(null), id = useId();
  useEffect(() => {
    const previous = activeElement(root.current);
    (confirmFirst ? confirm.current : root.current.querySelector('input:not([type="hidden"]),select,textarea') || focusableElements(root.current)[0])?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  return <div className="studio-modal hosted-modal" ref={root} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); } else trapFocus(event, root.current); }} onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="studio-dialog hosted-dialog" onSubmit={onSubmit}><h2 id={id}>{title}</h2>{children}<div className="modal-action"><button type="button" className="studio-button studio-button-ghost studio-button-md btn btn-ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button ref={confirm} type="submit" className={confirmClassName} disabled={busy}>{confirmLabel}</button></div></form>
  </div>;
}
