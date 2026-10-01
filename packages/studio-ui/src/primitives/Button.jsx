import { LoaderCircle } from 'lucide-react';
export const variants = ['primary', 'secondary', 'ghost', 'danger'];
export const sizes = ['sm', 'md'];
export default function Button({ variant = 'secondary', size = 'md', icon: Icon, loading = false, disabled = false, className = '', children, type = 'button', ...attributes }) {
  return <button type={type} className={`studio-button studio-button-${variant} studio-button-${size} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...attributes}>
    <span className="studio-button-content" aria-hidden={loading || undefined}>{Icon && <Icon size={16} aria-hidden="true" />}{children}</span>
    {loading && <LoaderCircle size={16} className="studio-button-spinner" aria-hidden="true" />}
  </button>;
}
