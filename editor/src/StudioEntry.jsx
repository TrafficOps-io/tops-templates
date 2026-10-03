import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { isStudioEntry } from './entry-route.js';
import { watchDisplayMode } from './app-mode.js';
import LandingPage from './LandingPage.jsx';

const App = lazy(() => import('./App.jsx'));

class WorkspaceBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="studio-root entry-loading"><h1>Studio could not load</h1><p>Check your connection and reload to open your workspace.</p><button className="btn btn-primary" onClick={() => location.reload()}>Reload Studio</button><a href="/">About Landing Studio</a></main> : this.props.children;
  }
}

export default function StudioEntry() {
  const [studio, setStudio] = useState(isStudioEntry);
  useEffect(() => {
    // A legacy settings bookmark must return to the workspace when Settings closes.
    if (location.hash === '#settings' && !new URLSearchParams(location.search).has('studio')) {
      const url = new URL(location.href); url.searchParams.set('studio', '1');
      history.replaceState(history.state, '', url);
    }
    const sync = () => setStudio(isStudioEntry());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    const stop = watchDisplayMode(sync);
    return () => { stop(); window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  return studio ? <WorkspaceBoundary><Suspense fallback={<main className="studio-root entry-loading" aria-label="Opening your workspace" role="status"><div className="entry-loading-line" /><div className="entry-loading-panel" /><p>Opening your workspace…</p></main>}><App /></Suspense></WorkspaceBoundary> : <LandingPage />;
}
