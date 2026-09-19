import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useStudioHost } from './host-context.js';
import { useStudioText } from './studio-i18n.js';

export default function AiSettings({ onBack }) {
  const host = useStudioHost(), t = useStudioText(), port = host.ai.settings;
  const [settings, setSettings] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    port.load({ signal: controller.signal }).then(setSettings).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [port]);
  async function run(operation) {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  const change = key => event => { setSettings(value => ({ ...value, [key]: event.target.value })); setNotice(''); };
  const notify = () => window.dispatchEvent(new Event('trafficops-ai-settings'));
  return <section className="ai-settings"><button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={15} />{t('Back to assistant')}</button><h2><KeyRound size={19} />{t('AI connection settings')}</h2>
    {settings && (port.owner === 'user' ? <form onSubmit={event => { event.preventDefault(); run(async () => { setSettings(await port.save(settings)); notify(); setNotice(t('Connection saved on this device.')); }); }}>
      <p className="field-help">{t('Your project folders and ZIP files never contain API keys.')}</p><fieldset disabled={busy}>
        <label className="field"><span>{t('API key')}</span><input type="password" className="input w-full" autoComplete="new-password" value={settings.apiKey || ''} onChange={change('apiKey')} required /><small>{t('Saved in this browser’s IndexedDB. Requests go directly to OpenRouter and are billed to your account.')}</small></label>
        <label className="field"><span>{t('Text model')}</span><input className="input w-full" value={settings.model} onChange={change('model')} required /></label>
        <label className="field"><span>{t('Image model')}</span><input className="input w-full" value={settings.imageModel} onChange={change('imageModel')} /><small><a href="https://openrouter.ai/models?output_modalities=image" target="_blank" rel="noreferrer">{t('OpenRouter model catalog')} ↗</a></small></label>
        <div className="ai-actions"><button className="btn btn-primary btn-sm" type="submit">{t('Save connection')}</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => run(async () => { await port.remove(); setSettings(await port.load()); notify(); setNotice(t('API key removed from this device.')); })}>{t('Remove key')}</button></div>
      </fieldset></form> : <><p role="status">{settings.configured ? t('The key is configured by your administrator.') : t('No key configured. Ask your administrator.')}</p><dl><dt>{t('Text model')}</dt><dd>{settings.model || '—'}</dd><dt>{t('Image model')}</dt><dd>{settings.imageModel || '—'}</dd></dl>{port.url && <a className="btn btn-outline btn-sm" href={port.url} target="_blank" rel="noopener noreferrer">{t('Team AI settings')} ↗</a>}</>)}
    <button type="button" className="btn btn-outline btn-sm connection-test" disabled={busy || !settings?.configured} onClick={() => run(async () => { const result = await port.test(); setNotice(t(result.message)); })}>{t('Check connection')}</button>
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
