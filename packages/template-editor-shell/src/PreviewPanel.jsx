import { ChevronDown, Code2, Maximize2, Minimize2, Monitor, MousePointer2, Pause, Play, RotateCw, ShieldCheck, Smartphone, Sparkles, Star, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioText } from './studio-i18n.js';
import Menu from './Menu.jsx';
import SectionPicker from './SectionPicker.jsx';
import { previewSectionOptions } from './preview-selection.js';

// Keep the working document mounted while its successor loads at the exact same
// dimensions. Switching a single iframe's src/srcdoc would expose a blank page.
function PreviewFrames({ preview, interactive, onDisplayed, title, selectionEnabled, selectedBlocks, selectionLocked, selectionStale, onSelectionChange, onSelectionDocumentChange }) {
  const [visible, setVisible] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const desired = useRef(preview), elements = useRef(new Map()), elementRefs = useRef(new Map()), documents = useRef(new Map()), visibleRef = useRef(visible), callbacks = useRef({}), selection = useRef({});
  desired.current = preview; visibleRef.current = visible;
  callbacks.current = { onDisplayed, onSelectionChange, onSelectionDocumentChange };
  selection.current = { enabled: Boolean(selectionEnabled && !selectionLocked && !selectionStale), selectedIds: selectedBlocks.map(block => block.id) };
  const pending = visible?.revision === preview.revision ? null : preview;
  const control = useCallback(frame => {
    const document = documents.current.get(frame.revision), element = elements.current.get(frame.revision);
    if (!frame.selection || !document || !element || visibleRef.current?.revision !== frame.revision) return;
    element.contentWindow?.postMessage({ type: 'trafficops-preview-selection-control', version: 1, token: frame.selection.token, documentToken: document.token, ...selection.current }, '*');
  }, []);
  const reveal = useCallback(frame => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!mounted.current || desired.current.revision !== frame.revision) return;
      visibleRef.current = frame; setVisible(frame); callbacks.current.onDisplayed?.(frame);
      const document = documents.current.get(frame.revision);
      if (document) callbacks.current.onSelectionDocumentChange?.(frame, document.page);
      control(frame);
    }));
  }, [control]);
  useEffect(() => {
    if (!pending?.readyToken) return;
    const ready = event => {
      if (event.source !== elements.current.get(pending.revision)?.contentWindow || event.data?.type !== 'trafficops-preview-ready' || event.data?.token !== pending.readyToken) return;
      reveal(pending);
    };
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, [pending, reveal]);
  useEffect(() => {
    const receive = event => {
      const frame = [visibleRef.current, desired.current].find(candidate => candidate?.selection && event.source === elements.current.get(candidate.revision)?.contentWindow);
      const message = event.data;
      if (!frame || message?.version !== 1 || message.token !== frame.selection.token || typeof message.documentToken !== 'string' || !message.documentToken || typeof message.page !== 'string' || !Array.isArray(message.selectedIds) || message.selectedIds.some(id => typeof id !== 'string')) return;
      if (message.type === 'trafficops-preview-selection-ready') {
        documents.current.set(frame.revision, { token: message.documentToken, page: message.page });
        if (visibleRef.current?.revision === frame.revision) {
          callbacks.current.onSelectionDocumentChange?.(frame, message.page); control(frame);
        }
        return;
      }
      if (message.type !== 'trafficops-preview-selection-change' || !selection.current.enabled || visibleRef.current?.revision !== frame.revision) return;
      const document = documents.current.get(frame.revision);
      if (!document || document.token !== message.documentToken || document.page !== message.page) return;
      const ids = [...new Set(message.selectedIds)];
      if (ids.length !== selection.current.selectedIds.length || ids.some(id => !selection.current.selectedIds.includes(id))) callbacks.current.onSelectionChange?.(ids, frame, message.page);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [control]);
  useEffect(() => { if (visible) control(visible); }, [visible, selectionEnabled, selectedBlocks, selectionLocked, selectionStale, control]);
  useEffect(() => {
    const active = new Set([visible?.revision, pending?.revision]);
    for (const revision of documents.current.keys()) if (!active.has(revision)) documents.current.delete(revision);
    for (const revision of elementRefs.current.keys()) if (!active.has(revision)) elementRefs.current.delete(revision);
  }, [visible, pending]);
  const frameRef = revision => {
    if (!elementRefs.current.has(revision)) elementRefs.current.set(revision, element => {
      if (element) elements.current.set(revision, element); else elements.current.delete(revision);
    });
    return elementRefs.current.get(revision);
  };
  return <div className="preview-frame-stack" aria-busy={Boolean(pending)}>
    {[visible, pending].filter(Boolean).map(frame => <iframe key={frame.revision} ref={frameRef(frame.revision)}
      className={frame === visible ? 'preview-document is-visible' : 'preview-document is-preparing'}
      aria-hidden={frame !== visible} tabIndex={frame === visible ? undefined : -1}
      title={title} src={frame.url} srcDoc={frame.html}
      sandbox={interactive ? 'allow-scripts allow-forms' : ''} referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'"
      onLoad={() => { if (frame === pending && !frame.readyToken) reveal(frame); }} />)}
  </div>;
}

export default function PreviewPanel({ pages, page, onPageChange, onSetEntry, entryDisabled = false, locked, mobile, onMobileChange, preview, error, ready, expanded, onToggleExpanded, note, interactive = false, paused = false, updating = false, onRefresh, onTogglePaused, onDisplayed, selectionAvailable = false, selectionEnabled = false, onSelectionEnabledChange, selectedBlocks = [], selectionLocked = false, selectionStale = false, onSelectionChange, onEditSelected, onSelectionDocumentChange }) {
  const t = useStudioText(), current = pages.find(item => item.name === page);
  const [displayed, setDisplayed] = useState(null), [selectionDocument, setSelectionDocument] = useState(null);
  const displayedFrame = displayed || preview;
  const display = useCallback(frame => { setDisplayed(frame); onDisplayed?.(frame); }, [onDisplayed]);
  const documentChanged = useCallback((frame, page) => { setSelectionDocument({ revision: frame.revision, page }); onSelectionDocumentChange?.(frame, page); }, [onSelectionDocumentChange]);
  const selectionPage = selectionDocument && selectionDocument.revision === displayedFrame?.revision ? selectionDocument.page : displayedFrame?.page || page;
  const sectionOptions = previewSectionOptions(displayedFrame, selectionPage);
  const sectionLabels = new Map(sectionOptions.map(section => [section.id, section.label]));
  const firstSelected = selectedBlocks[0], ancestors = (firstSelected?.ancestorIds || []).map(id => displayedFrame?.selection?.blockInstances?.find(block => block.id === id)).filter(Boolean);
  const updateSelection = ids => onSelectionChange?.(ids, displayedFrame, selectionPage);
  return <section id="preview-panel" className="preview-panel" aria-label={t('Live preview')}>
    <div className="preview-toolbar"><div className="preview-label"><span className={`status-dot ${ready && !updating ? '' : 'pending'}`} /><span>{t('LIVE PREVIEW')}</span></div>
      <Menu className="page-menu" triggerClassName="page-menu-trigger" label={t('Preview page')} disabled={!pages.length} trigger={<><span>{page || t('No pages')}</span><ChevronDown size={12} /></>}>
        {({ close }) => <>{pages.map(item => <button key={item.name} type="button" role="menuitem" aria-current={page === item.name ? 'page' : undefined} onClick={() => { onPageChange(item.name); close(); }}><span>{item.name}</span>{item.isEntry && <Star size={12} aria-label={t('Entry page')} />}</button>)}{onSetEntry && <><hr /><button type="button" role="menuitem" disabled={locked || entryDisabled || !current || current.isEntry} onClick={() => { onSetEntry(page); close(); }}><Star size={13} />{t('Make entry page')}</button></>}</>}
      </Menu>
      {selectionAvailable && <button type="button" className="btn btn-ghost btn-xs preview-selection-toggle" aria-pressed={selectionEnabled} disabled={!preview || selectionLocked || selectionStale} onClick={() => onSelectionEnabledChange?.(!selectionEnabled)}><MousePointer2 size={14} /><span>{t('Select elements')}</span></button>}
      <div className="preview-run-controls">
        {onRefresh && <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t('Refresh preview')} title={t('Refresh preview')} onClick={onRefresh}><RotateCw size={15} /></button>}
        {onTogglePaused && <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t(paused ? 'Resume automatic preview' : 'Pause automatic preview')} title={t(paused ? 'Resume automatic preview' : 'Pause automatic preview')} aria-pressed={paused} onClick={onTogglePaused}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}
      </div>
      <div className="device-tabs" role="group" aria-label={t('Preview size')}><button type="button" title={t('Desktop preview')} aria-label={t('Desktop preview')} aria-pressed={!mobile} className={!mobile ? 'selected' : ''} onClick={() => onMobileChange(false)}><Monitor size={16} /></button><button type="button" title={t('Mobile preview')} aria-label={t('Mobile preview')} aria-pressed={mobile} className={mobile ? 'selected' : ''} onClick={() => onMobileChange(true)}><Smartphone size={15} /></button></div>
      {expanded !== undefined && <button type="button" data-editor-expand={!expanded ? '' : undefined} className="btn btn-ghost btn-xs btn-square expand-editor-button" aria-label={expanded ? t('Collapse editor') : t('Expand editor')} title={expanded ? t('Collapse editor') : t('Expand editor')} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
    </div>
    {selectionAvailable && (selectionEnabled || selectedBlocks.length > 0) && <div className="preview-selection-context" aria-label={t('Selected elements')}>
      {selectionEnabled && <SectionPicker key={JSON.stringify([displayedFrame?.revision, selectionPage])} sections={sectionOptions} selectedIds={selectedBlocks.map(block => block.id)} onChange={updateSelection} disabled={selectionLocked || selectionStale} />}
      <div className="preview-selection-chips">{selectedBlocks.length ? selectedBlocks.map(block => <span key={block.id} className="preview-selection-chip"><span>{sectionLabels.get(block.id) || block.label}</span><button type="button" disabled={selectionLocked} aria-label={t('Remove {name} from selection', { name: sectionLabels.get(block.id) || block.label })} onClick={() => updateSelection(selectedBlocks.filter(item => item.id !== block.id).map(item => item.id))}><X size={12} /></button></span>) : <span className="preview-selection-hint">{t('Click marked blocks to select one or more.')}</span>}</div>
      {ancestors.length > 0 && <Menu label={t('Select parent block')} disabled={selectionLocked || selectionStale} trigger={<>{t('Select parent')}<ChevronDown size={12} /></>}>
        {({ close }) => ancestors.map(block => <button key={block.id} type="button" role="menuitem" onClick={() => { updateSelection([...selectedBlocks.filter(item => !item.ancestorIds?.includes(block.id) && item.id !== block.id).map(item => item.id), block.id]); close(); }}>{block.label}</button>)}
      </Menu>}
      {selectedBlocks.length > 0 && <><button type="button" className="btn btn-ghost btn-xs" disabled={selectionLocked} onClick={() => updateSelection([])}>{t('Clear selection')}</button><button type="button" className="btn btn-primary btn-xs" disabled={selectionLocked || selectionStale || !onEditSelected} onClick={onEditSelected}><Sparkles size={12} />{t('Edit selected')}</button></>}
      {selectionStale && <span className="preview-selection-hint" role="status">{t('Preview changed. Refresh it before selecting blocks.')}</span>}
    </div>}
    <div className={`preview-stage ${mobile ? 'mobile-preview' : ''}`}>{preview ? <div className="browser-frame"><div className="browser-chrome"><span /><span /><span /><div>{preview.page || page}</div><ShieldCheck size={12} /></div><PreviewFrames preview={preview} interactive={interactive} onDisplayed={display} title={t('Generated page preview')} selectionEnabled={selectionEnabled} selectedBlocks={selectedBlocks} selectionLocked={selectionLocked} selectionStale={selectionStale} onSelectionChange={onSelectionChange} onSelectionDocumentChange={documentChanged} /></div> : <div className="empty-preview"><Code2 size={30} /><h3>{t('A page is taking shape.')}</h3><p>{error || t('Add a .tpl file with an @layout block to get started.')}</p></div>}</div>
    {error && preview && <div className="preview-update-error" role="alert"><strong>{t('Preview could not update. Showing the last working version.')}</strong><span>{error}</span></div>}
    <div className="preview-bottom"><span><ShieldCheck size={13} />{paused ? t('Automatic preview paused') : updating ? t('Updating preview…') : note}</span><span>{t('{count} pages', { count: pages.length })}</span></div>
  </section>;
}
