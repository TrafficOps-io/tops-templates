import { useEffect, useRef, useState } from 'react';

const isSettings = () => window.location.hash === '#settings';

// A bookmarkable page without replacing the mounted project or its conversation state.
export function useSettingsPage() {
  const [open, setOpen] = useState(isSettings);
  const returnTo = useRef(null);
  useEffect(() => {
    const sync = () => setOpen(isSettings());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    if (open || !returnTo.current) return;
    const { element, scroll } = returnTo.current;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, scroll);
      if (element?.isConnected && !element.closest('[hidden]')) element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  function show() {
    if (isSettings()) return;
    returnTo.current = { element: document.activeElement, scroll: window.scrollY };
    history.pushState({ ...history.state, studioSettings: true }, '', '#settings');
    setOpen(true);
  }
  function close() {
    if (history.state?.studioSettings) history.back();
    else {
      history.replaceState(history.state, '', location.pathname + location.search);
      setOpen(false);
    }
  }
  return [open, show, close];
}
