import { LoaderCircle } from 'lucide-react';
export const variants = ['primary', 'secondary', 'ghost', 'danger'];
export const sizes = ['sm', 'md'];
export default function Button({ variant = 'secondary', size = 'md', icon: Icon, loading = false, disabled = false, className = '', children, type = 'button', ...attributes }) {
  return <button type={type} {...attributes} className={`studio-button studio-button-${variant} studio-button-${size} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>
    {/* opacity, not visibility or aria-hidden: the label stays the accessible name while loading */}
    <span className="studio-button-content">{Icon && <Icon size={16} aria-hidden="true" />}{children}</span>
    {loading && <LoaderCircle size={16} className="studio-button-spinner" aria-hidden="true" />}
  </button>;
}
