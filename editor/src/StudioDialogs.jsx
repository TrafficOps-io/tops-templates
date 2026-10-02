import { useEffect, useRef, useState } from 'react';
import { StudioUiProvider } from '@trafficops/studio-ui/i18n';
import { ArrowRight, FileCode2, FolderOpen, FolderPlus, Images, LoaderCircle, PackageCheck, RefreshCw, Trash2, X } from 'lucide-react';
import AiSettings from '@trafficops/template-editor-shell/AiSettings';
import { StudioHostContext } from '@trafficops/template-editor-shell/host-context';
import { projectLocation } from './ProjectSwitcher.jsx';
const tourSteps = installedMode => [
  { icon: FolderPlus, title: 'Create or import a project', text: installedMode ? 'Choose a template, start from scratch or send an AI brief. You can also import an editable ZIP or open a project folder.' : 'Choose a template, start from scratch or import an editable project ZIP.' },
  { icon: FileCode2, title: 'Edit your page', text: 'Use Content for text and settings, or Code for source files. Check the result in Preview.' },
  { icon: Images, title: 'Add your images', text: 'Choose project assets or upload images from your computer. Crop and resize them before adding.' },
  { icon: PackageCheck, title: 'Export when ready', text: 'Your project saves on this device. Export a landing for hosting or an editable ZIP to back up and continue your work.' },
];

export function TourDialog({ onClose, installedMode = false, returnFocus }) {
  const nativeDialog = useRef(null);
  useEffect(() => { const previous = returnFocus?.isConnected ? returnFocus : document.activeElement, element = nativeDialog.current; element.showModal(); return () => { element.close(); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); }); }; }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="tour-title" onCancel={onClose}><div className="modal-box tour-modal">
    <header className="tour-hero"><button type="button" className="btn btn-ghost btn-sm btn-square tour-close" aria-label="Close quick start" onClick={onClose}><X size={18} /></button><h2 id="tour-title">From template to finished pages</h2><p>A quick guide to your workspace.</p></header>
    <ol className="tour-steps">{tourSteps(installedMode).map(({ icon: Icon, title, text }) => <li key={title}><span className="tour-step-node" aria-hidden="true"><Icon size={18} /></span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
    <footer className="tour-footer"><p className="tour-note">AI and connected folders are available in the installed Studio app.</p><div className="tour-actions"><a className="btn btn-ghost" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Read full docs ↗</a><button type="button" className="btn btn-primary" onClick={onClose}>Start creating<ArrowRight size={16} /></button></div></footer>
  </div><button type="button" className="modal-backdrop" aria-label="Close quick start" onClick={onClose} /></dialog>;
}

export function ProjectsDialog({ projects, currentId, supported, busy, onAdd, onOpen, onForget, onReload, onLocation, onClose }) {
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="projects-title" onCancel={onClose}><div className="modal-box projects-modal"><div className="dialog-heading"><div><span className="section-kicker">LOCAL WORKSPACES</span><h2 id="projects-title">Project storage</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close projects" onClick={onClose}><X size={18} /></button></div>
    <p className="muted projects-intro">Projects can stay on this device or save directly to a connected folder. Opening a folder resumes its project. Use “Save to folder” in the editor to move the current project and keep its conversations.</p>
    {!supported && <div className="project-support-note"><strong>Folder editing is unavailable in this browser.</strong><span>Use Chrome or Edge for read/write folders. ZIP import and export continue to work here.</span></div>}
    <div className="project-list">{projects.length ? projects.map(project => <div className={`project-list-row ${project.id === currentId ? 'current' : ''}`} key={project.id}><button type="button" className="project-open" disabled={busy || !supported} onClick={() => onOpen(project)}><FolderOpen size={18} /><span><strong>{project.name}</strong><small>{projectLocation(project)}</small></span></button><label className="project-path-field"><span className="field-help">Folder label (optional)</span><input aria-label={`Folder label for ${project.name}`} className="input input-sm" defaultValue={project.displayPath || ''} placeholder={`${project.name}/`} onBlur={event => onLocation(project, event.target.value)} /></label><div className="project-row-actions">{project.id === currentId && <button type="button" className="btn btn-ghost btn-sm btn-square" disabled={busy} title="Reload from disk" aria-label={`Reload ${project.name} from disk`} onClick={() => onReload(project)}><RefreshCw size={14} /></button>}<button type="button" className="btn btn-ghost btn-sm btn-square" disabled={busy || project.id === currentId} title="Disconnect folder without deleting files" aria-label={`Disconnect ${project.name}`} onClick={() => onForget(project)}><Trash2 size={14} /><span>Disconnect</span></button></div></div>) : <div className="project-list-empty"><FolderOpen size={24} /><span>No connected folders yet.</span></div>}</div>
    <div className="modal-action"><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button><button type="button" className="btn btn-primary" disabled={!supported || busy} onClick={onAdd}>{busy ? <LoaderCircle size={16} className="spin" /> : <FolderPlus size={16} />} Open existing folder</button></div>
  </div><button type="button" className="modal-backdrop" aria-label="Close projects" onClick={onClose} /></dialog>;
}

export function AiSettingsDialog({ ai, onClose }) {
  const nativeDialog = useRef(null);
  const [portalContainer, setPortalContainer] = useState(null);
  useEffect(() => { nativeDialog.current.showModal(); setPortalContainer(nativeDialog.current); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-label="OpenRouter settings" onCancel={onClose}>
    <div className="modal-box"><StudioUiProvider portalContainer={portalContainer}><StudioHostContext.Provider value={{ ai }}><AiSettings onBack={onClose} backLabel="Close" /></StudioHostContext.Provider></StudioUiProvider></div>
  </dialog>;
}
