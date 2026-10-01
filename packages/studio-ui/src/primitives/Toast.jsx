import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
const ToastContext = createContext(null);
// tone: success | info | warning | danger. Ошибки (danger) не исчезают сами; остальные через 5 с.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]), timers = useRef(new Map()), counter = useRef(0), t = useStudioText();
  const dismiss = useCallback(id => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setToasts(current => current.filter(item => item.id !== id)); }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  const push = useCallback(({ tone = 'info', title, description, action }) => {
    const id = `toast-${++counter.current}`; setToasts(current => [...current, { id, tone, title, description, action }]);
    if (tone !== 'danger') timers.current.set(id, setTimeout(() => dismiss(id), 5000));
    return id;
  }, [dismiss]);
  return <ToastContext.Provider value={{ push, dismiss }}>
    {children}
    <div className="studio-toasts">
      {toasts.map(toast => <div key={toast.id} role={toast.tone === 'danger' ? 'alert' : 'status'} className={`studio-toast studio-toast-${toast.tone}`}>
        <div className="studio-toast-body"><p className="studio-toast-title">{toast.title}</p>{toast.description && <p className="studio-toast-description">{toast.description}</p>}</div>
        {toast.action}
        <button type="button" className="studio-toast-close" aria-label={t('Dismiss')} onClick={() => dismiss(toast.id)}><X size={14} aria-hidden="true" /></button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}
export function useToast() { const context = useContext(ToastContext); if (!context) throw new Error('useToast requires ToastProvider'); return context; }
