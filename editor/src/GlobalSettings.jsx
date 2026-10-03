import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import AiSettings from '@trafficops/template-editor-shell/AiSettings';
import { StudioHostContext } from '@trafficops/template-editor-shell/host-context';
import { applyTheme, readTheme } from './theme.js';
import RepositorySettings from './RepositorySettings.jsx';
import './global-settings.css';

function useAiConnection(ai) {
  const [connection, setConnection] = useState(null);
  useEffect(() => {
    let alive = true, generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const settings = await ai.settings.load();
        if (alive && current === generation) setConnection({ configured: settings.configured });
      } catch { if (alive && current === generation) setConnection({ unavailable: true }); }
    };
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; window.removeEventListener('trafficops-ai-settings', load); };
  }, [ai]);
  return connection;
}

export function AiSetupNotice({ ai, onSettings }) {
  const connection = useAiConnection(ai);
  return <aside className="library-ai-intro" aria-label="AI assistant">
    <Sparkles size={20} aria-hidden="true" />
    <div><strong>{connection?.configured ? 'Your AI key is saved' : 'Create and edit with AI'}</strong>
      <p>{connection?.configured ? 'Open Conversations in any project. Your OpenRouter key is saved only in this browser.' : 'Bring your own OpenRouter API key (BYOK) to use AI in Conversations. Your key stays in this browser, never on TrafficOps servers.'}</p>
    </div>
    <button type="button" className="btn btn-outline btn-sm" onClick={onSettings}>{connection?.configured ? 'AI settings' : 'Set up AI'}<ArrowRight size={14} /></button>
  </aside>;
}

const themes = [
  { value: 'system', label: 'System', description: 'Follow your device', Icon: Monitor },
  { value: 'light', label: 'Light', description: 'A bright workspace', Icon: Sun },
  { value: 'dark', label: 'Dark', description: 'A softer workspace', Icon: Moon },
];

export default function GlobalSettings({ ai, onBack, backLabel, repositoryManager, initialSection }) {
  const [theme, setTheme] = useState(readTheme), title = useRef(null);
  const connection = useAiConnection(ai);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const section = initialSection === 'repositories' && document.getElementById('repositories-title');
      if (section) { section.scrollIntoView({ block: 'start' }); section.focus({ preventScroll: true }); }
      else { window.scrollTo(0, 0); title.current?.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection]);
  return <div className="global-settings">
    <button type="button" className="btn btn-ghost btn-sm settings-back" onClick={onBack}><ArrowLeft size={15} />{backLabel}</button>
    <header className="global-settings-heading"><h1 ref={title} tabIndex={-1}>Settings</h1><p>AI, appearance and template repositories for every project in this browser.</p></header>
    <section className="global-settings-section" aria-labelledby="ai-settings-title">
      <div className="settings-section-intro"><span className="settings-section-number" aria-hidden="true">01</span><h2 id="ai-settings-title">AI assistant</h2><p>Create pages, rewrite content and edit code in Conversations.</p><span className="settings-connection-status" role="status"><span className={connection?.configured ? 'is-configured' : ''} />{!connection ? 'Loading connection…' : connection.unavailable ? 'Connection unavailable' : connection.configured ? 'Key saved on this device' : 'API key needed'}</span></div>
      <div className="settings-section-body">
        <div className="settings-ai-explainer"><h3>Your models. Your key.</h3><p>Studio includes an optional AI assistant. OpenRouter is the service that connects it to AI models. Bring your own API key (BYOK); usage is billed to your OpenRouter account.</p><a className="text-link" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get an OpenRouter API key ↗</a></div>
        <div className="settings-connection-form"><StudioHostContext.Provider value={{ ai }}><AiSettings title="OpenRouter" /></StudioHostContext.Provider></div>
        <details className="settings-privacy" open><summary>What stays local, and what is sent?</summary><ul><li>Your key is stored only in this browser on this device. TrafficOps servers never receive it.</li><li>AI requests go directly from your browser to OpenRouter. The key authenticates those requests; your prompts and shared project content are sent to OpenRouter and the selected model provider.</li><li>Your key is never included in project folders or ZIP exports. You can remove it here at any time.</li></ul></details>
      </div>
    </section>
    <section className="global-settings-section settings-appearance" aria-labelledby="appearance-title"><div className="settings-section-intro"><span className="settings-section-number" aria-hidden="true">02</span><h2 id="appearance-title">Appearance</h2><p>Choose how Studio looks. Your preference saves automatically.</p></div>
      <fieldset className="settings-theme-options"><legend className="settings-theme-legend">Theme</legend>{themes.map(({ value, label, description, Icon }) => <label key={value} className={`settings-theme-option ${theme === value ? 'is-selected' : ''}`}><input type="radio" name="studio-theme" value={value} checked={theme === value} onChange={() => { applyTheme(value); setTheme(value); }} /><span className="settings-theme-preview" aria-hidden="true">{(value === 'system' ? ['light', 'dark'] : [value]).map(scheme => <span key={scheme} className="settings-theme-miniature" data-theme={`studio-${scheme}`}><span /><span /><span /></span>)}</span><span className="settings-theme-name"><Icon size={16} aria-hidden="true" />{label}{theme === value && <Check size={15} aria-hidden="true" />}</span><small>{description}</small></label>)}</fieldset>
    </section>
    {repositoryManager && <RepositorySettings manager={repositoryManager} />}
  </div>;
}
