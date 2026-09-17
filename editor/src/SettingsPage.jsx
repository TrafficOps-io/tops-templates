import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Save, Trash2 } from 'lucide-react';
import { clearOpenRouterSettings, loadOpenRouterSettings, normalizeOpenRouterSettings, saveOpenRouterSettings } from './openrouter-settings.js';

export default function SettingsPage({ onBack }) {
  const [settings, setSettings] = useState(normalizeOpenRouterSettings);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  useEffect(() => { let alive = true; loadOpenRouterSettings().then(value => { if (alive) { setSettings(value); setLoaded(true); } }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, []);
  const change = key => event => { setSettings(previous => ({ ...previous, [key]: event.target.value })); setStatus(''); };
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { setSettings(await saveOpenRouterSettings(settings)); setStatus('Connection saved on this device.'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function forget() {
    setBusy(true); setError('');
    try { await clearOpenRouterSettings(); setSettings(normalizeOpenRouterSettings()); setStatus('API key removed from this device.'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <main className="app-settings"><button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={16} /> Back to project</button><div className="section-kicker">LANDING STUDIO</div><h1>Settings</h1><p className="muted">Connections for this installed app. Your project folders and ZIP files never contain API keys.</p><form className="settings-card" onSubmit={save}><h2><KeyRound size={20} /> OpenRouter</h2><fieldset disabled={!loaded || busy}><label className="field"><span>API key</span><input type="password" className="input input-bordered w-full" autoComplete="new-password" value={settings.apiKey} onChange={change('apiKey')} placeholder="sk-or-v1-…" required /><p className="field-help">Saved in this browser’s IndexedDB. Requests go directly to OpenRouter and are billed to your account.</p></label><label className="field"><span>Text model</span><input className="input input-bordered w-full" value={settings.model} onChange={change('model')} required /><p className="field-help">Choose a model with tool calling for editing, or structured output for filling content.</p></label><label className="field"><span>Image model</span><input className="input input-bordered w-full" value={settings.imageModel} onChange={change('imageModel')} placeholder="Exact image model ID" /><p className="field-help">Choose an image generation model from the <a href="https://openrouter.ai/models?output_modalities=image" target="_blank" rel="noreferrer">OpenRouter catalog ↗</a>. Image generation sends your prompt and field description.</p></label><div className="settings-card-actions"><button className="btn btn-primary" type="submit"><Save size={16} /> Save connection</button><button className="btn btn-ghost" type="button" onClick={forget}><Trash2 size={16} /> Remove key</button></div></fieldset>{error && <p role="alert" className="inline-error">{error}</p>}{status && <p role="status">{status}</p>}</form></main>;
}
