import { ChevronDown, Code2, Maximize2, Minimize2, Monitor, ShieldCheck, Smartphone, Star } from 'lucide-react';
import { useStudioText } from './studio-i18n.js';
import Menu from './Menu.jsx';

export default function PreviewPanel({ pages, page, onPageChange, onSetEntry, locked, mobile, onMobileChange, preview, error, ready, expanded, onToggleExpanded, note }) {
  const t = useStudioText(), current = pages.find(item => item.name === page);
  return <section id="preview-panel" className="preview-panel" aria-label={t('Live preview')}>
    <div className="preview-toolbar"><div className="preview-label"><span className={`status-dot ${ready ? '' : 'pending'}`} /><span>{t('LIVE PREVIEW')}</span></div>
      <Menu className="page-menu" triggerClassName="page-menu-trigger" label={t('Preview page')} disabled={!pages.length} trigger={<><span>{page || t('No pages')}</span><ChevronDown size={12} /></>}>
        {({ close }) => <>{pages.map(item => <button key={item.name} type="button" role="menuitem" aria-current={page === item.name ? 'page' : undefined} onClick={() => { onPageChange(item.name); close(); }}><span>{item.name}</span>{item.isEntry && <Star size={12} aria-label={t('Entry page')} />}</button>)}{onSetEntry && <><hr /><button type="button" role="menuitem" disabled={locked || !current || current.isEntry} onClick={() => { onSetEntry(page); close(); }}><Star size={13} />{t('Make entry page')}</button></>}</>}
      </Menu>
      <div className="device-tabs" role="group" aria-label={t('Preview size')}><button type="button" title={t('Desktop preview')} aria-label={t('Desktop preview')} aria-pressed={!mobile} className={!mobile ? 'selected' : ''} onClick={() => onMobileChange(false)}><Monitor size={16} /></button><button type="button" title={t('Mobile preview')} aria-label={t('Mobile preview')} aria-pressed={mobile} className={mobile ? 'selected' : ''} onClick={() => onMobileChange(true)}><Smartphone size={15} /></button></div>
      {expanded !== undefined && <button type="button" data-editor-expand={!expanded ? '' : undefined} className="btn btn-ghost btn-xs btn-square expand-editor-button" aria-label={expanded ? t('Collapse editor') : t('Expand editor')} title={expanded ? t('Collapse editor') : t('Expand editor')} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
    </div>
    <div className={`preview-stage ${mobile ? 'mobile-preview' : ''}`}>{preview && pages.length ? <div className="browser-frame"><div className="browser-chrome"><span /><span /><span /><div>{page}</div><ShieldCheck size={12} /></div><iframe key={preview.revision} title={t('Generated page preview')} srcDoc={preview.html} sandbox="" referrerPolicy="no-referrer" /></div> : <div className="empty-preview"><Code2 size={30} /><h3>{t('A page is taking shape.')}</h3><p>{error || t('Add a .tpl file with an @layout block to get started.')}</p></div>}</div>
    <div className="preview-bottom"><span><ShieldCheck size={13} />{note}</span><span>{t('{count} pages', { count: pages.length })}</span></div>
  </section>;
}
