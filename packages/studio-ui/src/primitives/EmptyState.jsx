export default function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return <div className={`studio-empty ${className}`} role="status">
    {Icon && <Icon size={24} aria-hidden="true" className="studio-empty-icon" />}
    <p className="studio-empty-title">{title}</p>
    {description && <p className="studio-empty-description">{description}</p>}
    {action}
  </div>;
}
