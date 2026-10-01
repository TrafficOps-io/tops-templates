// tone: neutral | success | warning | danger | info | accent; текст обязателен
export default function StatusBadge({ tone = 'neutral', children, className = '' }) {
  return <span className={`studio-badge studio-badge-${tone} ${className}`}><i className="studio-badge-dot" aria-hidden="true" />{children}</span>;
}
