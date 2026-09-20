import { ChevronDown, Code2, Maximize2, Minimize2, Monitor, Pause, Play, RotateCw, ShieldCheck, Smartphone, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioText } from './studio-i18n.js';
import Menu from './Menu.jsx';

// Keep the working document mounted while its successor loads at the exact same
// dimensions. Switching a single iframe's src/srcdoc would expose a blank page.
function PreviewFrames({ preview, interactive, onDisplayed, title }) {
  const [visible, setVisible] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const desired = useRef(preview), pendingElement = useRef(null), onDisplayedRef = useRef(onDisplayed);
  desired.current = preview; onDisplayedRef.current = onDisplayed;
  const pending = visible?.revision === preview.revision ? null : preview;
  const reveal = useCallback(frame => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!mounted.current || desired.current.revision !== frame.revision) return;
      setVisible(frame); onDisplayedRef.current?.(frame);
    }));
  }, []);
  useEffect(() => {
    if (!pending?.readyToken) return;
    const ready = event => {
      if (event.source !== pendingElement.current?.contentWindow || event.data?.type !== 'trafficops-preview-ready' || event.data?.token !== pending.readyToken) return;
      reveal(pending);
    };
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, [pending, reveal]);
  return <div className="preview-frame-stack" aria-busy={Boolean(pending)}>
    {[visible, pending].filter(Boolean).map(frame => <iframe key={frame.revision} ref={frame === pending ? pendingElement : undefined}
      className={frame === visible ? 'preview-document is-visible' : 'preview-document is-preparing'}
      aria-hidden={frame !== visible} tabIndex={frame === visible ? undefined : -1}
      title={title} src={frame.url} srcDoc={frame.html}
      sandbox={interactive ? 'allow-scripts allow-forms' : ''} referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'"
      onLoad={() => { if (frame === pending && !frame.readyToken) reveal(frame); }} />)}
  </div>;
}

export default function PreviewPanel({ pages, page, onPageChange, onSetEntry, locked, mobile, onMobileChange, preview, error, ready, expanded, onToggleExpanded, note, interactive = false, paused = false, updating = false, onRefresh, onTogglePaused, onDisplayed }) {
  const t = useStudioText(), current = pages.find(item => item.name === page);
  return <section id="preview-panel" className="preview-panel" aria-label={t('Live preview')}>
    <div className="preview-toolbar"><div className="preview-label"><span className={`status-dot ${ready && !updating ? '' : 'pending'}`} /><span>{t('LIVE PREVIEW')}</span></div>
      <Menu className="page-menu" triggerClassName="page-menu-trigger" label={t('Preview page')} disabled={!pages.length} trigger={<><span>{page || t('No pages')}</span><ChevronDown size={12} /></>}>
        {({ close }) => <>{pages.map(item => <button key={item.name} type="button" role="menuitem" aria-current={page === item.name ? 'page' : undefined} onClick={() => { onPageChange(item.name); close(); }}><span>{item.name}</span>{item.isEntry && <Star size={12} aria-label={t('Entry page')} />}</button>)}{onSetEntry && <><hr /><button type="button" role="menuitem" disabled={locked || !current || current.isEntry} onClick={() => { onSetEntry(page); close(); }}><Star size={13} />{t('Make entry page')}</button></>}</>}
      </Menu>
      <div className="preview-run-controls">
        {onRefresh && <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t('Refresh preview')} title={t('Refresh preview')} onClick={onRefresh}><RotateCw size={15} /></button>}
        {onTogglePaused && <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t(paused ? 'Resume automatic preview' : 'Pause automatic preview')} title={t(paused ? 'Resume automatic preview' : 'Pause automatic preview')} aria-pressed={paused} onClick={onTogglePaused}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}
      </div>
      <div className="device-tabs" role="group" aria-label={t('Preview size')}><button type="button" title={t('Desktop preview')} aria-label={t('Desktop preview')} aria-pressed={!mobile} className={!mobile ? 'selected' : ''} onClick={() => onMobileChange(false)}><Monitor size={16} /></button><button type="button" title={t('Mobile preview')} aria-label={t('Mobile preview')} aria-pressed={mobile} className={mobile ? 'selected' : ''} onClick={() => onMobileChange(true)}><Smartphone size={15} /></button></div>
      {expanded !== undefined && <button type="button" data-editor-expand={!expanded ? '' : undefined} className="btn btn-ghost btn-xs btn-square expand-editor-button" aria-label={expanded ? t('Collapse editor') : t('Expand editor')} title={expanded ? t('Collapse editor') : t('Expand editor')} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
    </div>
    <div className={`preview-stage ${mobile ? 'mobile-preview' : ''}`}>{preview ? <div className="browser-frame"><div className="browser-chrome"><span /><span /><span /><div>{preview.page || page}</div><ShieldCheck size={12} /></div><PreviewFrames preview={preview} interactive={interactive} onDisplayed={onDisplayed} title={t('Generated page preview')} /></div> : <div className="empty-preview"><Code2 size={30} /><h3>{t('A page is taking shape.')}</h3><p>{error || t('Add a .tpl file with an @layout block to get started.')}</p></div>}</div>
    {error && preview && <div className="preview-update-error" role="alert"><strong>{t('Preview could not update. Showing the last working version.')}</strong><span>{error}</span></div>}
    <div className="preview-bottom"><span><ShieldCheck size={13} />{paused ? t('Automatic preview paused') : updating ? t('Updating preview…') : note}</span><span>{t('{count} pages', { count: pages.length })}</span></div>
  </section>;
}
