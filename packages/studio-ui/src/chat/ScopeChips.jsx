import { X } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';

// Built-in labels for ScopeKind (chat/port.d.ts); keys are in studio-translations.json.
export const SCOPE_LABELS = { project: 'Project', file: 'File', block: 'Block', content: 'Content only', discussion: 'Discussion', scene: 'Scene', audio: 'Audio', script: 'Script' };

// scopes: ScopeKind[] (prop or port.capabilities.scopes); scope: Scope { kind, targetId?, label? }; onScopeChange(scope).
// One chip is active (aria-pressed); the active chip, unless it is the default, is removed by its cross and the default
// (project, or the first offered scope) becomes active again. A scope set by the product outside the list (file, block)
// is shown as an extra active chip.
export default function ScopeChips({ scopes = [], scope, onScopeChange, disabled = false }) {
  const t = useStudioText();
  const fallback = scopes.includes('project') || !scopes.length ? 'project' : scopes[0];
  const active = scope?.kind ?? fallback;
  const kinds = scopes.includes(active) ? scopes : [...scopes, active];
  if (kinds.length < 2 && active === fallback) return null;
  const label = kind => (kind === active && scope?.label ? scope.label : t(SCOPE_LABELS[kind] ?? kind));
  return <div className="studio-chat-scope" role="group" aria-label={t('Assistant task')}>
    {kinds.map(kind => <span key={kind} className="studio-chat-scope-chip">
      <button type="button" aria-pressed={kind === active} disabled={disabled} onClick={() => kind !== active && onScopeChange?.({ kind })}>{label(kind)}</button>
      {kind === active && kind !== fallback && <button type="button" className="studio-chat-scope-remove" disabled={disabled} aria-label={t('Remove {name}', { name: label(kind) })} onClick={() => onScopeChange?.({ kind: fallback })}><X size={12} aria-hidden="true" /></button>}
    </span>)}
  </div>;
}
