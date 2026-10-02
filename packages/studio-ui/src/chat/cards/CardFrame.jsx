// Shared result-card frame: <article> with the test hook, header (icon · name · meta · actions) and body.
// frame carries data-card from cards/index.js renderCard.
export default function CardFrame({ type, icon: Icon, title, meta, actions, frame, children }) {
  return <article data-testid="studio-chat-card" {...frame} className={`studio-card studio-card-${type}`}>
    <header className="studio-card-header">
      {Icon && <Icon size={16} aria-hidden="true" className="studio-card-icon" />}
      <span className="studio-card-title">{title}</span>
      {meta && <span className="studio-card-meta">{meta}</span>}
      {actions && <span className="studio-card-actions">{actions}</span>}
    </header>
    {children && <div className="studio-card-body">{children}</div>}
  </article>;
}

// Small header action button; rendered only when the port supports the action (can(action)).
export function CardAction({ action, can, onAction, card, label, icon: Icon, value }) {
  if (!can(action)) return null;
  return <button type="button" className="studio-card-action" onClick={() => onAction(action, card, value)}>
    {Icon && <Icon size={14} aria-hidden="true" />}{label}
  </button>;
}

export const formatDuration = ms => {
  if (!Number.isFinite(ms)) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
export const formatCost = cost => (Number.isFinite(cost) ? `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}` : '');
export const formatPercent = progress => `${Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)}%`;
