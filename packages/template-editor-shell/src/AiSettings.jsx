import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { ModelPicker } from '@trafficops/studio-ui/primitives';
import { usePortalContainer } from '@trafficops/studio-ui/i18n';
import { useStudioHost } from './host-context.js';
import { useStudioText } from './studio-i18n.js';
import { RECOMMENDED_MODELS, cachedOpenRouterCatalog, catalogOptions, catalogText, loadOpenRouterCatalog, recentModels, rememberModel } from './model-catalog.js';

/**
 * A model of the connection: ModelPicker over the public OpenRouter catalog, or a text field (catalog unavailable,
 * offline, or the user enters an ID). The catalog is requested on the first interaction with the picker, not on open.
 */
function ModelField({ kind, label, value, onChange, catalog, onLoadCatalog, recent, text, required = false, help }) {
  const [manual, setManual] = useState(false), labelId = useId(), portalContainer = usePortalContainer();
  const failed = catalog.status === 'error', typed = manual || failed || catalog.status === 'disabled';
  const options = useMemo(() => catalogOptions(catalog.models, kind, { current: value, ...text }), [catalog.models, kind, value, text]);
  return <div className="field ai-model-field"><span id={labelId}>{label}</span>
    {typed ? <input className="input w-full" aria-labelledby={labelId} value={value} onChange={event => onChange(event.target.value)} required={required} />
      : <div onPointerDownCapture={onLoadCatalog} onFocusCapture={onLoadCatalog} onKeyDownCapture={onLoadCatalog}>
        <ModelPicker label={label} value={kind === 'image' ? value || null : value} options={options} onChange={id => onChange(id || '')} recentIds={recent} recommendedIds={RECOMMENDED_MODELS[kind]}
          placeholder={catalog.status === 'loading' ? catalogText('Loading models…', {}, text) : undefined} portalContainer={portalContainer || undefined}
          {...(kind === 'image' ? { inherit: { label: catalogText('No image model', {}, text), detail: catalogText('Image generation is off', {}, text) } } : {})} />
      </div>}
    {failed && <small role="status">{catalogText('The OpenRouter model catalog is unavailable. Enter the model ID.', {}, text)}</small>}
    <div className="ai-model-help">{help}
      {catalog.status !== 'disabled' && !failed && <button type="button" className="btn btn-link btn-xs ai-model-mode" onClick={() => setManual(current => !current)}>{catalogText(manual ? 'Choose from catalog' : 'Enter model ID', {}, text)}</button>}
    </div>
  </div>;
}

/** modelCatalog — false keeps text fields (hosts that forbid requests to openrouter.ai); the catalog is only used for user-owned connections. */
export default function AiSettings({ onBack, backLabel = 'Back to assistant', modelCatalog = true, title = 'AI connection settings' }) {
  const keyInputId = useId();
  const host = useStudioHost(), t = useStudioText(), port = host.ai.settings;
  const text = useMemo(() => ({ t, language: host.language }), [t, host.language]);
  const catalogAllowed = modelCatalog !== false && port.owner === 'user';
  const [catalog, setCatalog] = useState(() => { const models = catalogAllowed ? cachedOpenRouterCatalog() : null; return models ? { status: 'ready', models } : { status: catalogAllowed ? 'idle' : 'disabled', models: [] }; });
  const [recent, setRecent] = useState(() => ({ text: recentModels('text'), image: recentModels('image') }));
  const loadCatalog = () => {
    if (catalog.status !== 'idle') return;
    setCatalog({ status: 'loading', models: [] });
    loadOpenRouterCatalog().then(models => setCatalog({ status: 'ready', models }), () => setCatalog({ status: 'error', models: [] }));
  };
  const [settings, setSettings] = useState(null), [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const load = () => port.load({ signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setSettings(value); setDirty(false); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    load();
    window.addEventListener('trafficops-ai-settings', load);
    return () => { controller.abort(); window.removeEventListener('trafficops-ai-settings', load); };
  }, [port]);
  async function run(operation) {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  const change = key => event => setValue(key, event.target.value);
  const setValue = (key, value) => { setSettings(current => ({ ...current, [key]: value })); setNotice(''); setError(''); setDirty(true); };
  const notify = () => window.dispatchEvent(new Event('trafficops-ai-settings'));
  return <section className="ai-settings">{onBack && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onBack}><ArrowLeft size={15} />{t(backLabel)}</button>}<h2><KeyRound size={19} />{t(title)}</h2>
    {!settings && !error && <p role="status">{t('Loading settings…')}</p>}
    {settings && (port.owner === 'user' ? <form onSubmit={event => { event.preventDefault(); run(async () => { const saved = await port.save(settings); setSettings(saved); setDirty(false); setRecent({ text: rememberModel('text', saved.model), image: saved.imageModel ? rememberModel('image', saved.imageModel) : recentModels('image') }); notify(); setNotice(t('Connection saved on this device.')); }); }}>
      <p className="field-help">{t('Your project folders and ZIP files never contain API keys.')}</p><fieldset disabled={busy}>
        <div className="ai-key-field">
          {settings.configured && <p role="status">{t('An OpenRouter key is saved on this device.')}</p>}
          <label className="field"><span>{t('API key')}</span><input id={keyInputId} type="password" className="input w-full" autoComplete="new-password" value={settings.apiKey || ''} onChange={change('apiKey')} required /><small>{t('Saved in this browser’s IndexedDB. Requests go directly to OpenRouter and are billed to your account.')}</small></label>
          {settings.configured && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setSettings(value => ({ ...value, apiKey: '' })); setDirty(true); setNotice(''); setError(''); document.getElementById(keyInputId)?.focus(); }}>{t('Replace key')}</button>}
        </div>
        <ModelField kind="text" label={t('Text model')} value={settings.model} onChange={value => setValue('model', value)} catalog={catalog} onLoadCatalog={loadCatalog} recent={recent.text} text={text} required />
        <ModelField kind="image" label={t('Image model')} value={settings.imageModel} onChange={value => setValue('imageModel', value)} catalog={catalog} onLoadCatalog={loadCatalog} recent={recent.image} text={text}
          help={<small><a href="https://openrouter.ai/models?output_modalities=image" target="_blank" rel="noreferrer">{t('OpenRouter model catalog')} ↗</a></small>} />
        <div className="ai-actions"><button className="btn btn-primary btn-sm" type="submit">{t('Save connection')}</button><button className="btn btn-ghost btn-sm" type="button" disabled={!settings.configured} onClick={() => run(async () => { await port.remove(); setSettings(await port.load()); setDirty(false); notify(); setNotice(t('API key removed from this device.')); })}>{t('Remove key')}</button></div>
      </fieldset></form> : <><p role="status">{settings.configured ? t('The key is configured by your administrator.') : t('No key configured. Ask your administrator.')}</p><dl><dt>{t('Text model')}</dt><dd>{settings.model || '—'}</dd><dt>{t('Image model')}</dt><dd>{settings.imageModel || '—'}</dd></dl>{port.url && <a className="btn btn-outline btn-sm" href={port.url} target="_blank" rel="noopener noreferrer">{t('Team AI settings')} ↗</a>}</>)}
    {dirty && <p className="field-help" role="status">{t('Save your changes before checking the connection.')}</p>}
    <button type="button" className="btn btn-outline btn-sm connection-test" disabled={busy || dirty || !settings?.configured} onClick={() => run(async () => { const result = await port.test(); setNotice(t(result.message)); })}>{t('Check connection')}</button>
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
