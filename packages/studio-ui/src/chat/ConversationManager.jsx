import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import { activeElement, inertOutside, trapFocus } from '../workspace/focus.js';

// A non-form surface: ThreadList owns the rename form and delete confirmation.
// Render in the caller's tree so native modality, menus and confirmations also work in a shadow root.
export default function ConversationManager({ chatRoot, children, error, onClose }) {
  const t = useStudioText(), id = useId(), root = useRef(null);
  const nestedDialog = () => [...(root.current?.querySelectorAll('[aria-modal="true"]') || [])].at(-1);
  useEffect(() => {
    const dialog = root.current, previous = activeElement(dialog);
    dialog.showModal();
    dialog.querySelector('input[type="search"]')?.focus();
    let current = null, release = null, lastFocus = null, restoreFrame = null;
    const remember = event => { if (!event.target.closest('[aria-modal="true"]')) lastFocus = event.target; };
    dialog.addEventListener('focusin', remember);
    const syncLayer = () => {
      const nested = nestedDialog();
      if (nested === current) return;
      const dismissed = current && !nested;
      release?.(); current = nested; release = nested ? inertOutside(dialog, nested) : null;
      // Modal's cleanup can run while its row is still inert. Restore after both this observer and the host release it.
      if (dismissed) restoreFrame = requestAnimationFrame(() => { if (dialog.open && !nestedDialog() && lastFocus?.isConnected && !lastFocus.closest('[inert]')) lastFocus.focus(); });
    };
    const observer = new MutationObserver(syncLayer);
    observer.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => {
      observer.disconnect(); dialog.removeEventListener('focusin', remember); cancelAnimationFrame(restoreFrame); release?.(); if (dialog.open) dialog.close();
      requestAnimationFrame(() => {
        const target = previous?.isConnected && previous.getClientRects().length && !previous.closest('[inert]') ? previous : chatRoot?.querySelector('[data-testid="studio-chat-composer"] textarea');
        target?.focus();
      });
    };
  }, []);
  useEffect(() => {
    if (!chatRoot) return;
    const observer = new ResizeObserver(entries => { if (entries[0].contentRect.width >= 560) onClose(); });
    observer.observe(chatRoot); return () => observer.disconnect();
  }, [chatRoot, onClose]);
  return <dialog ref={root} className="studio-chat-manager" aria-labelledby={id} data-testid="studio-chat-management"
    onCancel={event => { event.preventDefault(); if (!nestedDialog()) onClose(); }}
    onPointerDown={event => { const box = root.current.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) && !nestedDialog()) onClose(); }}
    onKeyDown={event => {
      // The innermost menu/confirmation handles its own keys; never run a second Tab trap.
      if (event.defaultPrevented || event.target.closest('[role="menu"]') || nestedDialog()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      else trapFocus(event, root.current, { ignoreWithin: null });
    }}>
    <div className="studio-chat-manager-content">
      <header className="studio-chat-manager-heading"><h2 id={id}>{t('Manage conversations')}</h2><Button variant="ghost" size="sm" icon={X} aria-label={t('Close')} onClick={onClose} /></header>
      {error && <InlineNotice tone="danger" title={t('The action failed')}>{error}</InlineNotice>}
      <div className="studio-chat-manager-body">{children}</div>
    </div>
  </dialog>;
}
