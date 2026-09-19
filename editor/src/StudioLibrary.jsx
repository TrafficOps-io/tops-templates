import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Copy, FileCode2, FolderOpen, LayoutTemplate, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { generateProject } from '@trafficops/template-runtime';
import { buildPreview } from '@trafficops/template-editor-shell/preview';
import { studioStarters } from './studio-catalog.js';

function Thumbnail({ project }) {
  const [visible, setVisible] = useState(false), root = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const preview = useMemo(() => {
    if (!visible) return null;
    try { const files = generateProject(project.files, project.settings || {}); return buildPreview(files, Object.keys(files).find(path => path.endsWith('.html'))); } catch { return null; }
  }, [visible, project.files, project.settings]);
  useEffect(() => () => preview?.dispose(), [preview]);
  return <div ref={root} className="library-thumbnail" aria-hidden="true">{preview ? <iframe title={`${project.name} thumbnail`} srcDoc={preview.html} sandbox="" tabIndex={-1} /> : <FileCode2 size={38} />}<span>{project.builtin ? 'STARTER' : project.kind === 'template' ? 'TEMPLATE' : 'LANDING'}</span></div>;
}

export default function StudioLibrary({ projects, busy, aiEnabled = false, onCreate, onOpen, onDuplicate, onDelete, onImport, onFolder }) {
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const shown = projects.filter(item => (filter === 'all' || item.kind === filter) && item.name.toLowerCase().includes(search.toLowerCase()));
  return <section className="library" aria-labelledby="library-title">
    <div className="library-heading"><div><span className="section-kicker">YOUR WORKSPACE</span><h2 id="library-title">Ideas become pages.</h2><p>Build a landing. Craft a reusable template. Pick up where you left off.</p></div><button className="btn btn-primary" disabled={busy} onClick={() => onCreate()}><Plus size={17} />New project</button></div>
    <div className={`creation-shortcuts ${aiEnabled ? '' : 'manual-only'}`}>{[['template', LayoutTemplate, 'From a template', 'Start with a design and make it yours.'], ['blank', FileCode2, 'Start from scratch', 'A clean canvas for your next idea.'], ...(aiEnabled ? [['ai', Sparkles, 'Create with AI', 'Describe it. Build it together.']] : [])].map(([mode, Icon, title, text]) => <button key={mode} disabled={busy} onClick={() => onCreate({ mode })}><Icon size={23} /><strong>{title}</strong><span>{text}</span><ArrowUpRight size={16} /></button>)}</div>
    <div className="library-tools"><div className="library-filters" role="group" aria-label="Project filter">{[['all', 'All projects'], ['landing', 'Landings'], ['template', 'Templates']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} <span>{projects.filter(item => key === 'all' || item.kind === key).length}</span></button>)}</div><label className="library-search"><Search size={16} /><input aria-label="Search projects" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search projects" /></label><button className="btn btn-ghost btn-sm" disabled={busy} onClick={onImport}><Upload size={15} />Import ZIP</button>{onFolder && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onFolder}><FolderOpen size={15} />Open folder</button>}</div>
    {shown.length ? <div className="library-grid">{shown.map(project => <article className="library-card" key={project.id}><button className="library-preview-button" disabled={busy} aria-label={`Open ${project.name}`} onClick={() => onOpen(project)}><Thumbnail project={project} /></button><div className="library-card-body"><h3>{project.name}</h3><p>{project.kind === 'template' ? 'Reusable template' : 'Landing page'} · {new Date(project.updatedAt).toLocaleDateString()}</p><div className="library-card-actions"><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onOpen(project)}>Open editor <ArrowUpRight size={14} /></button>{project.kind === 'template' && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onCreate({ mode: 'template', source: project })}>Use template</button>}<button className="btn btn-ghost btn-sm btn-square" aria-label={`Duplicate ${project.name}`} disabled={busy} onClick={() => onDuplicate(project)}><Copy size={14} /></button><button className="btn btn-ghost btn-sm btn-square" aria-label={`Delete ${project.name}`} disabled={busy} onClick={() => onDelete(project)}><Trash2 size={14} /></button></div></div></article>)}</div> : <div className="library-empty"><LayoutTemplate size={28} /><h3>{search ? 'No matching projects' : filter === 'template' ? 'Your next reusable idea starts here' : 'Make your first page'}</h3><p>{search ? 'Try a different name or filter.' : aiEnabled ? 'Create from a starter, a blank page or a conversation with AI. Your projects save on this device.' : 'Create from a starter or a blank page. Your projects save on this device.'}</p></div>}
    <div className="library-section-heading"><div><span className="section-kicker">A HEAD START</span><h2>Made to be yours</h2></div><p>Included starters · available offline</p></div><div className="library-grid starter-grid">{studioStarters.map(project => <article className="library-card" key={project.id}><button className="library-preview-button" aria-label={`Use ${project.name}`} disabled={busy} onClick={() => onCreate({ mode: 'template', source: project })}><Thumbnail project={project} /></button><div className="library-card-body"><h3>{project.name}</h3><p>{project.description}</p><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onCreate({ mode: 'template', source: project })}>Use template <ArrowUpRight size={14} /></button></div></article>)}</div>
    {!aiEnabled && <p className="library-install-note">Install and open Studio as an app to use the AI assistant and connect project folders.</p>}
    <p className="library-storage-note">Saved in this browser on this device. Export source ZIPs for backups or to move your work to another device.</p>
  </section>;
}

export function CreateProjectDialog({ initial = {}, templates, busy, aiEnabled = false, onCreate, onClose }) {
  const [kind, setKind] = useState(initial.kind || 'landing'), [mode, setMode] = useState(initial.mode === 'ai' && !aiEnabled ? 'template' : initial.mode || 'template');
  const [name, setName] = useState(initial.source ? `${initial.source.name} landing` : ''), [prompt, setPrompt] = useState('');
  const [sourceId, setSourceId] = useState(initial.source?.id || studioStarters[0].id), [error, setError] = useState('');
  const dialog = useRef(null), choices = [...templates, ...studioStarters];
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => { if (!aiEnabled) setMode(value => value === 'ai' ? 'template' : value); }, [aiEnabled]);
  async function submit(event) {
    event.preventDefault(); setError('');
    try { await onCreate({ kind, mode, name: name.trim(), prompt: prompt.trim(), source: choices.find(item => item.id === sourceId) }); }
    catch (cause) { setError(cause.message); }
  }
  return <dialog ref={dialog} className="modal" aria-labelledby="create-project-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}><form className="modal-box create-project-modal" onSubmit={submit}><div className="dialog-heading"><div><span className="section-kicker">START SOMETHING</span><h2 id="create-project-title">New project</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close new project" disabled={busy} onClick={onClose}><X size={18} /></button></div><fieldset disabled={busy}>
    <label className="field"><span>Project name</span><input className="input w-full" autoFocus required maxLength={120} value={name} placeholder="My next idea" onChange={event => setName(event.target.value)} /></label>
    <div className="create-kind" role="group" aria-label="Project type">{[['landing', 'Landing page', 'A page ready to customize and export.'], ['template', 'Reusable template', 'A starting point for future landing pages.']].map(([value, title, text]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}><strong>{title}</strong><span>{text}</span></button>)}</div>
    <div className={`creation-mode ${aiEnabled ? '' : 'manual-only'}`} role="group" aria-label="Creation method">{[['template', 'From template', LayoutTemplate], ['blank', 'From scratch', FileCode2], ...(aiEnabled ? [['ai', 'With AI', Sparkles]] : [])].map(([value, label, Icon]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); }}><Icon size={16} />{label}</button>)}</div>
    {mode === 'template' && <label className="field"><span>Starting template</span><select className="select w-full" value={sourceId} onChange={event => setSourceId(event.target.value)}>{choices.map(item => <option key={item.id} value={item.id}>{item.name}{item.builtin ? ' · Starter' : ' · Your template'}</option>)}</select><small>Creates an independent copy, including content and assets.</small></label>}
    {mode === 'blank' && <p className="create-explanation">Start with a minimal editable page. Add files and make it yours.</p>}
    {mode === 'ai' && <label className="field"><span>Describe your project</span><textarea className="textarea w-full" required rows={5} maxLength={6000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A landing for a ceramics studio. Warm colors, large typography, a collection section and a booking link…" /><small>Uses your OpenRouter connection and credits. Review the generated code before applying. If you haven't connected a key, you can do so in the editor.</small></label>}
    </fieldset>{error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-action"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : mode === 'ai' ? 'Create with AI' : `Create ${kind === 'template' ? 'template' : 'landing'}`}</button></div></form></dialog>;
}
