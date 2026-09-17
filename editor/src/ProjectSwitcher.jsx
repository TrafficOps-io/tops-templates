import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, FolderPlus, Settings2 } from 'lucide-react';
export const projectLocation = project => project?.displayPath || `${project?.name || 'Project'}/`;
export default function ProjectSwitcher({ projects, current, sessionName, disabled, onOpen, onAdd, onManage }) {
  const [open, setOpen] = useState(false), root = useRef(null), trigger = useRef(null);
  useEffect(() => {
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <div className="project-switcher" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); if (!open) { setOpen(true); return; }
      const buttons = [...root.current.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].filter(button => !button.disabled);
      const index = buttons.indexOf(document.activeElement), direction = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + direction + buttons.length) % buttons.length]?.focus();
    }
  }}><button ref={trigger} className="project-switcher-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><FolderOpen size={18} /><span><strong>{current?.name || sessionName}</strong><small>{current ? projectLocation(current) : 'Saved on this device'}</small></span><ChevronDown size={15} /></button>{open && <div className="project-switcher-menu" role="menu" aria-label="Switch project"><span className="section-kicker">PROJECT FOLDERS</span>{projects.map(project => <button role="menuitemradio" aria-checked={project.id === current?.id} key={project.id} onClick={() => { setOpen(false); onOpen(project); }}><FolderOpen size={16} /><span><strong>{project.name}</strong><small title={projectLocation(project)}>{projectLocation(project)}</small></span>{project.id === current?.id && <Check size={15} />}</button>)}{!projects.length && <p className="field-help">Connect a folder to save files to your computer.</p>}<button role="menuitem" onClick={() => { setOpen(false); onAdd(); }}><FolderPlus size={16} /> Add project folder</button><button role="menuitem" onClick={() => { setOpen(false); onManage(); }}><Settings2 size={16} /> Manage folders & paths</button></div>}</div>;
}
