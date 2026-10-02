import { useEffect, useRef } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import AiSettings from '@trafficops/template-editor-shell/AiSettings';
import { StudioHostContext } from '@trafficops/template-editor-shell/host-context';
export function TourDialog({ onClose }) {
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="tour-title" onCancel={onClose}><div className="modal-box tour-modal"><div className="dialog-heading"><div><span className="section-kicker">QUICK START</span><h2 id="tour-title">From template to finished pages</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close quick start" onClick={onClose}><X size={18} /></button></div><ol className="tour-steps"><li><span>1</span><div><strong>Add your project</strong><p>Create a landing or reusable template from a starter, from scratch, or with AI. Each project lives in its own folder; you can also open an existing folder.</p></div></li><li><span>2</span><div><strong>Build the template</strong><p>Edit TPL, CSS, and other source files. Changes in Content update the preview live.</p></div></li><li><span>3</span><div><strong>Choose images</strong><p>Image parameters can use existing project assets or files dropped from your computer.</p></div></li><li><span>4</span><div><strong>Take it with you</strong><p>Projects autosave to their folder. Download generated pages and export source ZIPs for portable backups.</p></div></li></ol><div className="tour-note"><ShieldCheck size={16} /><span>Studio is local: your files stay in your folders. AI requests go only to the provider you connect.</span></div><div className="modal-action"><a className="btn btn-ghost" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Read full docs ↗</a><button type="button" className="btn btn-primary" onClick={onClose}>Start creating</button></div></div><button type="button" className="modal-backdrop" aria-label="Close quick start" onClick={onClose} /></dialog>;
}

export function AiSettingsDialog({ ai, onClose }) {
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-label="OpenRouter settings" onCancel={onClose}>
    <div className="modal-box"><StudioHostContext.Provider value={{ ai }}><AiSettings onBack={onClose} backLabel="Close" /></StudioHostContext.Provider></div>
  </dialog>;
}
