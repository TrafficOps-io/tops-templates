import { useEffect, useRef } from 'react';
import { ArrowRight, Sparkles, FileCode2, FolderPlus, Images, PackageCheck, X } from 'lucide-react';
const tourSteps = () => [
  { icon: FolderPlus, title: 'Create or import a project', text: 'Choose a template, start from scratch or send an AI brief. Import an editable ZIP or open a project folder.' },
  { icon: FileCode2, title: 'Edit your page', text: 'Use Content for text and settings, or Code for source files. Check the result in Preview.' },
  { icon: Sparkles, title: 'Enable AI with your own key (optional)', text: 'Conversations helps you create and edit pages with AI. Open Settings, add your OpenRouter API key and choose a text model. OpenRouter connects you to AI models and bills usage to your account.', ai: true },
  { icon: Images, title: 'Add your images', text: 'Choose project assets or upload images from your computer. Crop and resize them before adding.' },
  { icon: PackageCheck, title: 'Export when ready', text: 'Your project autosaves to its folder. Export a landing for hosting or an editable ZIP to back up and continue your work.' },
];

export function TourDialog({ onClose, installedMode = false, returnFocus, onSettings }) {
  const nativeDialog = useRef(null);
  useEffect(() => { const previous = returnFocus?.isConnected ? returnFocus : document.activeElement, element = nativeDialog.current; element.showModal(); return () => { element.close(); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); }); }; }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="tour-title" onCancel={onClose}><div className="modal-box tour-modal">
    <header className="tour-hero"><button type="button" className="btn btn-ghost btn-sm btn-square tour-close" aria-label="Close quick start" onClick={onClose}><X size={18} /></button><h2 id="tour-title">From template to finished pages</h2><p>A quick guide to your workspace.</p></header>
    <ol className="tour-steps">{tourSteps(installedMode).map(({ icon: Icon, title, text, ai }) => <li key={title}><span className="tour-step-node" aria-hidden="true"><Icon size={18} /></span><div><strong>{title}</strong><p>{text}</p>{ai && onSettings && <button type="button" className="text-link tour-settings-link" onClick={onSettings}>Set up AI in Settings <ArrowRight size={13} /></button>}</div></li>)}</ol>
    <footer className="tour-footer"><p className="tour-note">Your key is saved only in this browser, never on TrafficOps servers or in project exports. AI requests go directly to OpenRouter; prompts and shared project content reach your selected model provider.</p><div className="tour-actions"><a className="btn btn-ghost" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Read full docs ↗</a><button type="button" className="btn btn-primary" onClick={onClose}>Start creating<ArrowRight size={16} /></button></div></footer>
  </div><button type="button" className="modal-backdrop" aria-label="Close quick start" onClick={onClose} /></dialog>;
}
