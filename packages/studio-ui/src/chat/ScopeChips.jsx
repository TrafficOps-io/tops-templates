import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';

// Built-in labels for ScopeKind (chat/port.d.ts); keys are in studio-translations.json.
export const SCOPE_LABELS = { project: 'Project', file: 'File', block: 'Block', content: 'Content only', discussion: 'Discussion', scene: 'Scene', audio: 'Audio', script: 'Script' };

// scopes: ScopeKind[] (prop or port.capabilities.scopes); scope: Scope { kind, targetId?, label? }; onScopeChange(scope).
// One compact control in the composer toolbar: a trigger named by the active scope opens a role="menu" of menuitemradio items
// (the active one aria-checked; arrows, Home/End, Escape). The active scope, unless it is the default, is removed by the cross
// next to the trigger and the default (project, or the first offered scope) becomes active again. A scope set by the product
// outside the list (file, block) is offered as an extra item.
export default function ScopeChips({ scopes = [], scope, onScopeChange, disabled = false }) {
  const t = useStudioText(), id = useId();
  const [open, setOpen] = useState(false), root = useRef(null), trigger = useRef(null), menu = useRef(null);
  const fallback = scopes.includes('project') || !scopes.length ? 'project' : scopes[0];
  const active = scope?.kind ?? fallback;
  const kinds = scopes.includes(active) ? scopes : [...scopes, active];
  const hidden = kinds.length < 2 && active === fallback;
  const items = () => [...(menu.current?.querySelectorAll('[role="menuitemradio"]') ?? [])];
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => { if (disabled || hidden) setOpen(false); }, [disabled, hidden]);
  useEffect(() => {
    if (!open) return undefined;
    (items().find(item => item.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const dismiss = event => { if (!event.composedPath().includes(root.current)) close(false); };
    const document = root.current.ownerDocument;
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden) return null;
  const label = kind => (kind === active && scope?.label ? scope.label : t(SCOPE_LABELS[kind] ?? kind));
  // Unified assistants have no mode picker. An explicit editor selection is removable context only.
  if (scopes.length <= 1) return <div className="studio-chat-scope" role="group" aria-label={t('Assistant task')}>
    <span className="studio-chat-scope-label">{scope?.label || scope?.targetId && active === 'file' && scope.targetId || t(active === 'block' ? 'Selected blocks' : SCOPE_LABELS[active] ?? active)}</span>
    <Button variant="ghost" size="sm" icon={X} disabled={disabled} aria-label={t('Remove {name}', { name: label(active) })} onClick={() => onScopeChange?.({ kind: fallback })} />
  </div>;
  function choose(kind) { close(); if (kind !== active) onScopeChange?.({ kind }); }
  function keyDown(event) {
    if (!open) {
      if (event.target === trigger.current && ['ArrowDown', 'ArrowUp'].includes(event.key) && !disabled) { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const choices = items(), index = choices.indexOf(root.current.getRootNode().activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    choices[next]?.focus();
  }
  return <div ref={root} className="studio-chat-scope" role="group" aria-label={t('Assistant task')} onKeyDown={keyDown}>
    <Button ref={trigger} variant="ghost" size="sm" className="studio-chat-scope-trigger" title={t('Assistant task')} disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span className="studio-chat-scope-label">{label(active)}</span><ChevronDown size={14} aria-hidden="true" />
    </Button>
    {active !== fallback && <Button variant="ghost" size="sm" icon={X} className="studio-chat-scope-remove" disabled={disabled}
      aria-label={t('Remove {name}', { name: label(active) })} title={t('Remove {name}', { name: label(active) })} onClick={() => onScopeChange?.({ kind: fallback })} />}
    {open && <div ref={menu} id={id} role="menu" aria-label={t('Assistant task')} className="studio-chat-scope-menu">
      {kinds.map(kind => <button key={kind} type="button" role="menuitemradio" aria-checked={kind === active} tabIndex={-1} onClick={() => choose(kind)}>
        <Check size={14} aria-hidden="true" className="studio-chat-scope-check" /><span>{label(kind)}</span>
      </button>)}
    </div>}
  </div>;
}
