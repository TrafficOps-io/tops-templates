// tone как у StatusBadge; actions: ReactNode
export default function InlineNotice({ tone = 'info', title, children, actions, className = '' }) {
  const role = tone === 'danger' ? 'alert' : 'status';
  return <div role={role} className={`studio-notice studio-notice-${tone} ${className}`}>
    <div className="studio-notice-body">{title && <p className="studio-notice-title">{title}</p>}{children && <div className="studio-notice-text">{children}</div>}</div>
    {actions && <div className="studio-notice-actions">{actions}</div>}
  </div>;
}
