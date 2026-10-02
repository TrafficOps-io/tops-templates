import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Copy, FileCode2, FolderOpen, LayoutTemplate, MoreHorizontal, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { generateProject } from '@trafficops/template-runtime';
import { buildPreview } from '@trafficops/template-editor-shell/preview';
import { Menu, Skeleton, Tabs, tabPanelProps } from '@trafficops/studio-ui/primitives';
import { studioStarters } from './studio-catalog.js';
import { BRIEF_REQUIRED, BriefComposer, briefAttachments, briefIdeas } from './HomeProjectChat.jsx';
import './create-project.css';
import { readProjectTree } from './storage/files.js';
import { readValues } from './storage/project-meta.js';
// A listed project's files are read from its folder only once it is visible and its access is already granted;
// otherwise the card shows a placeholder (reading must never prompt).
function useFolderFiles(project, visible) {
  const [read, setRead] = useState(null);
  const readable = visible && !project.files && project.handle && project.access === 'granted' && !project.problem;
  useEffect(() => {
    if (!readable) return;
    let alive = true;
    Promise.all([readProjectTree(project.handle), readValues(project.handle)]).then(([tree, values]) => { if (alive && Object.keys(tree.files).length) setRead({ files: tree.files, settings: values }); }).catch(() => {});
    return () => { alive = false; };
  }, [readable, project.handle, project.updatedAt]);
  return project.files ? { files: project.files, settings: project.settings } : read;
}



// Live preview, rendered only once scrolled near the viewport; compact drops the kind badge.
function Thumbnail({ project, compact = false }) {
  const [visible, setVisible] = useState(false), root = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const content = useFolderFiles(project, visible);
  const preview = useMemo(() => {
    if (!visible || !content) return null;
    try { const files = generateProject(content.files, content.settings || {}); return buildPreview(files, Object.keys(files).find(path => path.endsWith('.html'))); } catch { return null; }
  }, [visible, content]);
  useEffect(() => () => preview?.dispose(), [preview]);
  const base = compact ? 'template-choice-thumbnail' : 'library-thumbnail';
  return <div ref={root} className={base} aria-hidden="true">{preview ? <iframe title={`${project.name} thumbnail`} srcDoc={preview.html} sandbox="" tabIndex={-1} /> : <div className={`${base}-skeleton`}><Skeleton shape="card" height="100%" /></div>}{!compact && <span>{project.builtin ? 'STARTER' : project.kind === 'template' ? 'TEMPLATE' : 'LANDING'}</span>}</div>;
}

function ProjectActions({ project, busy, onCreate, onUseTemplate, onDuplicate, onDelete }) {
  return <Menu label={`Project actions: ${project.name}`} className="library-project-menu" triggerClassName="btn btn-ghost btn-sm btn-square" disabled={busy} trigger={<MoreHorizontal size={17} aria-hidden="true" />}>
    {({ close }) => <>
      {project.kind === 'template' && <button type="button" role="menuitem" onClick={() => { close(false); onUseTemplate ? onUseTemplate(project) : onCreate({ mode: 'template', source: project }); }}><LayoutTemplate size={15} />Use template</button>}
      <button type="button" role="menuitem" aria-label={`Duplicate ${project.name}`} onClick={() => { close(); onDuplicate(project); }}><Copy size={15} />Duplicate</button>
      <button type="button" role="menuitem" className="studio-menu-danger" aria-label={`Delete ${project.name}`} onClick={() => { close(); onDelete(project); }}><Trash2 size={15} />Delete</button>
    </>}
  </Menu>;
}

export default function StudioLibrary({ projects, busy, aiEnabled = false, activity = [], onCreate, onOpen, onDuplicate, onDelete, onImport, onFolder, storageMode = 'folder', onUseTemplate, onReconnect, onRemove }) {
  const id = useId(), [view, setView] = useState('projects'), [filter, setFilter] = useState('all');
  const [search, setSearch] = useState(''), [templateSearch, setTemplateSearch] = useState('');
  const shown = projects.filter(item => (filter === 'all' || item.kind === filter) && item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const matches = item => item.name.toLowerCase().includes(templateSearch.trim().toLowerCase());
  const starters = studioStarters.filter(matches), templates = projects.filter(item => item.kind === 'template').filter(matches);
  const working = projects.filter(project => activity.some(run => run.projectId === project.id));
  const catalogue = (items, builtin = false) => <div className={`library-grid ${builtin ? 'starter-grid' : 'saved-template-grid'}`}>{items.map(project => <article className="library-card" key={project.id}>
    <button className="library-preview-button" aria-label={`Use ${project.name}`} disabled={busy} onClick={() => onUseTemplate && !project.builtin ? onUseTemplate(project) : onCreate({ mode: 'template', source: project })}><Thumbnail project={project} /></button>
    <div className="library-card-body"><h3>{project.name}</h3><p>{project.description || 'Your reusable template'}</p>
      <div className="library-card-actions"><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onUseTemplate && !project.builtin ? onUseTemplate(project) : onCreate({ mode: 'template', source: project })}>Use template <ArrowUpRight size={14} /></button>
        {!builtin && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onOpen(project)}>Edit template</button>}</div>
    </div>
  </article>)}</div>;
  return <section className="library library-project-first" aria-labelledby="library-title" data-testid="studio-library">
    <div className="library-heading"><div><h1 id="library-title">{view === 'projects' ? 'Projects' : 'Templates'}</h1><p>{view === 'projects' ? 'Continue your work or start a new page.' : 'Choose a starting point. Each use creates an independent project.'}</p></div>
      <button className="btn btn-primary" disabled={busy} onClick={() => onCreate()}><Plus size={17} />New project</button>
    </div>
    <div className="library-navigation"><Tabs id={id} className="library-views" label="Library views" value={view} onChange={setView} items={[{ id: 'projects', label: 'Projects', badge: <span aria-hidden="true">{projects.length}</span> }, { id: 'templates', label: 'Templates' }]} />
      <div className="library-transfer-actions"><button className="btn btn-ghost btn-sm" disabled={busy} onClick={onImport}><Upload size={15} />Import ZIP</button>{onFolder && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onFolder}><FolderOpen size={15} />Open folder</button>}</div>
    </div>
    {working.length > 0 && (view === 'templates' || working.some(project => !shown.some(item => item.id === project.id))) && <div className="library-activity" role="status"><span><Sparkles size={15} aria-hidden="true" />AI is working in {working.length} {working.length === 1 ? 'project' : 'projects'}</span>{working.map(project => <button key={project.id} className="text-link" disabled={busy} onClick={() => onOpen(project)}>Open {project.name}</button>)}</div>}
    <div {...tabPanelProps(id, 'projects')} hidden={view !== 'projects'} className="library-view">
      <div className="library-tools"><label className="library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search projects" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search projects" /></label>
        {projects.length > 0 && <select className="select select-sm library-kind-filter" aria-label="Project filter" value={filter} onChange={event => setFilter(event.target.value)}>{[['all', 'All projects'], ['landing', 'Landings'], ['template', 'Reusable templates']].map(([key, label]) => <option key={key} value={key}>{label} ({projects.filter(item => key === 'all' || item.kind === key).length})</option>)}</select>}
      </div>
      {shown.length ? <div className="library-project-list">{shown.map(project => <article className="library-card library-project-row" key={project.id}>
        <button className="library-preview-button" disabled={busy} aria-label={`Open ${project.name}`} onClick={() => onOpen(project)}><Thumbnail project={project} /></button>
        <div className="library-project-copy"><h3><button type="button" disabled={busy} onClick={() => onOpen(project)}>{project.name}</button></h3><p>{project.kind === 'template' ? 'Reusable template' : 'Landing page'} · {new Date(project.updatedAt).toLocaleDateString()}</p>
          {project.source && <p className="library-card-badges"><span>{project.source === 'opfs' ? 'In this browser' : 'Folder'}</span>{project.source === 'folder' && project.access !== 'granted' && <span>Needs permission</span>}</p>}
          {project.problem && <div className="library-unavailable" role="status"><strong>{project.problem.kind === 'permission' ? 'Needs permission' : 'Folder unavailable'}</strong><span>{project.problem.message}</span>{project.source === 'folder' && <div className="library-card-actions"><button className="btn btn-outline btn-sm" disabled={busy} aria-label={`Reconnect ${project.name}`} onClick={() => onReconnect(project)}>Reconnect</button><button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remove ${project.name} from list`} onClick={() => onRemove(project)}>Remove from list</button></div>}</div>}
          {activity.some(run => run.projectId === project.id) && <p className="library-ai-status" role="status"><Sparkles size={13} aria-hidden="true" />{activity.filter(run => run.projectId === project.id).length} AI {activity.filter(run => run.projectId === project.id).length === 1 ? 'conversation working' : 'conversations working'}</p>}
        </div>
        <div className="library-project-actions"><button className="btn btn-ghost btn-sm library-open" disabled={busy} onClick={() => onOpen(project)}>Open editor <ArrowUpRight size={14} /></button><ProjectActions project={project} busy={busy} onCreate={onCreate} onUseTemplate={onUseTemplate} onDuplicate={onDuplicate} onDelete={onDelete} /></div>
      </article>)}</div> : <div className="library-empty"><FileCode2 size={26} aria-hidden="true" /><h2>{search.trim() || filter !== 'all' ? 'No matching projects' : 'Start your first project'}</h2><p>{search.trim() || filter !== 'all' ? 'Try another name or project type.' : 'Use a template or start from scratch. Your work saves on this device.'}</p><button className="btn btn-outline btn-sm" onClick={() => { setView('templates'); requestAnimationFrame(() => document.getElementById(`${id}-templates`)?.focus()); }}>Browse templates</button></div>}
    </div>
    <div {...tabPanelProps(id, 'templates')} hidden={view !== 'templates'} className="library-view">
      <div className="library-tools"><label className="library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search templates" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} placeholder="Search templates" /></label></div>
      {templates.length > 0 && <section className="library-catalogue-section" aria-labelledby={`${id}-saved-title`}><h2 id={`${id}-saved-title`}>Your reusable templates</h2>{catalogue(templates)}</section>}
      {starters.length > 0 && <section className="library-catalogue-section" aria-labelledby={`${id}-starters-title`}><div className="library-catalogue-heading"><h2 id={`${id}-starters-title`}>Included starters</h2><span>Available offline</span></div>{catalogue(starters, true)}</section>}
      {!templates.length && !starters.length && <div className="library-empty"><Search size={24} aria-hidden="true" /><h2>No matching templates</h2><p>Try another name.</p></div>}
    </div>
    <div className="library-notes"><p>{storageMode === 'opfs' ? 'Stored in this browser — export a backup ZIP regularly. Clearing site data removes these projects.' : 'Each project is a folder on your computer. Studio remembers the folders you open here.'}</p></div>
  </section>;
}

export function CreateProjectDialog({ initial = {}, templates, busy, aiEnabled = false, aiSettings, returnFocus, onCreate, onLoadTemplate, onClose }) {
  const [kind, setKind] = useState(initial.kind || 'landing'), [mode, setMode] = useState(initial.mode === 'ai' && !aiEnabled ? 'template' : initial.mode || 'template');
  const [attachments, setAttachments] = useState([]), [useOnPage, setUseOnPage] = useState(false), [imageChoice, setImageChoice] = useState(initial.generateImages), [settings, setSettings] = useState(null);
  // name stays null until the user types, so the field follows the chosen template's default.
  const [name, setName] = useState(null), [prompt, setPrompt] = useState('');
  const [sourceId, setSourceId] = useState(initial.source?.id || studioStarters[0].id), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(() => initial.source && !initial.source.builtin && initial.source.files ? { [initial.source.id]: initial.source } : {}), [loading, setLoading] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(!initial.source), [creating, setCreating] = useState(false);
  const locked = busy || creating;
  const submitting = useRef(false), dialog = useRef(null), formId = useId(), choices = [...templates, ...studioStarters], source = choices.find(item => item.id === sourceId);
  const defaultName = mode === 'template' && source ? source.name : kind === 'template' ? 'Untitled template' : 'Untitled landing';
  function chooseIdea(value) {
    setPrompt(kind === 'template' ? `${value} Make it a reusable template with editable content and images.` : value);
    requestAnimationFrame(() => dialog.current?.querySelector('textarea')?.focus());
  }
  function choose(id) { selectSource(id); setName(value => value?.trim() ? value : null); }
  useEffect(() => { const previous = returnFocus?.isConnected ? returnFocus : document.activeElement, element = dialog.current; element.showModal(); element.querySelector('input[maxlength]')?.focus(); return () => { element.close(); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); }); }; }, []);
  useEffect(() => { if (!aiEnabled) setMode(value => value === 'ai' ? 'template' : value); }, [aiEnabled]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!aiEnabled || !aiSettings) { setSettings({}); return; }
      aiSettings.load().then(value => { if (alive) setSettings({ imageModel: value.imageModel }); }).catch(cause => { if (alive) { setSettings({}); setError(cause.message); } });
    };
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; window.removeEventListener('trafficops-ai-settings', load); };
  }, [aiEnabled, aiSettings]);
  function selectSource(id) {
    setSourceId(id); setError('');
    const entry = templates.find(item => item.id === id);
    if (!entry || loaded[id] || !onLoadTemplate) return;
    const reading = onLoadTemplate(entry);
    setLoading(id);
    Promise.resolve(reading).then(source => { if (source) setLoaded(items => ({ ...items, [id]: source })); }).catch(cause => setError(cause.message)).finally(() => setLoading(value => value === id ? null : value));
  }
  // Template/blank submit through the hidden form (the composer is a form of its own, forms cannot nest);
  // the AI brief submits through BriefComposer with its File[] attachments.
  async function create(brief) {
    if (locked || submitting.current || (mode === 'ai' && settings === null)) return false; setError('');
    if (brief && !brief.text.trim()) { setError(BRIEF_REQUIRED); return false; }
    const userTemplate = mode === 'template' && templates.some(item => item.id === sourceId);
    if (userTemplate && !loaded[sourceId]) { setError(loading === sourceId ? 'Studio is still reading this template.' : 'Studio needs access to this template: choose it again in the list.'); return false; }
    const source = mode === 'template' ? loaded[sourceId] || studioStarters.find(item => item.id === sourceId) : undefined;
    // Resolve the default at generation time: the user may connect an image
    // model in the editor after creating this project's initial brief.
    submitting.current = true; setCreating(true);
    try { await onCreate({ kind, mode, name: (name ?? '').trim() || (mode === 'ai' ? '' : defaultName), prompt: (brief?.text ?? prompt).trim(), attachmentFiles: brief?.attachments || [], useOnPage: Boolean(brief?.useOnPage), generateImages: imageChoice, source }); }
    catch (cause) { setError(cause.message); return false; }
    finally { submitting.current = false; setCreating(false); }
  }
  return <dialog ref={dialog} className="modal" aria-labelledby="create-project-title" onCancel={event => { if (locked) event.preventDefault(); else onClose(); }}><div className="modal-box create-project-modal"><form id={formId} hidden onSubmit={event => { event.preventDefault(); create(); }} /><div className="dialog-heading"><div><h2 id="create-project-title">New project</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close new project" disabled={locked} onClick={onClose}><X size={18} /></button></div><fieldset disabled={locked}>
    <div className={`creation-mode ${aiEnabled ? '' : 'manual-only'}`} role="group" aria-label="Creation method">{[['template', 'From template', LayoutTemplate], ['blank', 'From scratch', FileCode2], ...(aiEnabled ? [['ai', 'With AI', Sparkles]] : [])].map(([value, label, Icon]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); }}><Icon size={16} />{label}</button>)}</div>
    {mode !== 'ai' && <label className="field"><span>Project name</span><input form={formId} className="input w-full" autoFocus maxLength={120} value={name ?? defaultName} placeholder="My next idea" onChange={event => setName(event.target.value)} onFocus={event => { if (name === null) event.target.select(); }} /></label>}
    {mode === 'template' && <div className="starting-template">
      {source && (initial.source || !pickerOpen) && <div className="selected-template-summary"><Thumbnail project={source} compact /><div><span>Starting template</span><strong>{source.name}</strong><small>{source.builtin ? 'Included starter' : 'Your reusable template'}</small></div><button type="button" className="btn btn-ghost btn-sm" aria-expanded={pickerOpen} aria-controls={`${formId}-templates`} onClick={() => setPickerOpen(value => !value)}>{pickerOpen ? 'Hide templates' : 'Change template'}</button></div>}
      <fieldset id={`${formId}-templates`} hidden={!pickerOpen} className="field template-picker"><legend>Starting template</legend><div className="template-choices">{choices.map(item => <button type="button" key={item.id} className="template-choice" aria-pressed={item.id === sourceId} onClick={() => choose(item.id)}><Thumbnail project={item} compact /><span className="template-choice-name">{item.name}</span><span className="template-choice-tag">{item.builtin ? 'Starter' : 'Your template'}</span><span className="template-choice-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span></button>)}</div><small>Creates an independent copy, including content and assets.</small></fieldset></div>}
    {mode === 'blank' && <p className="create-explanation">Start with a minimal editable page. Add files and make it yours.</p>}
    {mode === 'ai' && <><BriefComposer value={prompt} onChange={setPrompt} attachments={attachments} onAttachmentsChange={setAttachments} settings={settings} imageChoice={imageChoice} onImageChoiceChange={setImageChoice} useOnPage={useOnPage} onUseOnPageChange={setUseOnPage} disabled={locked || settings === null} onSubmit={create} placeholder="Describe your landing page" autoFocus />{locked && <p role="status" className="home-chat-status">Creating project…</p>}<p className="field-help">A new project and its first conversation open after you send the brief. You can connect your AI key in the editor.</p><details className="brief-ideas"><summary>Example briefs</summary><div>{briefIdeas.map(([label, value]) => <button type="button" className="btn btn-ghost btn-sm" key={label} disabled={locked || Boolean(prompt.trim())} onClick={() => chooseIdea(value)}>{label}</button>)}</div></details></>}
    <details className="create-project-options"><summary><ChevronRight size={14} aria-hidden="true" /><span>Project options</span><span className="create-options-kind">{kind === 'template' ? 'Reusable template' : 'Landing page'}</span></summary>{mode === 'ai' && <label className="field"><span>Project name (optional)</span><input className="input w-full" maxLength={120} value={name ?? ''} placeholder="Named from your brief" onChange={event => setName(event.target.value)} /></label>}<div className="create-kind" role="group" aria-label="Project type">{[['landing', 'Landing page', 'A page ready to customize and export.'], ['template', 'Reusable template', 'A starting point for future landing pages.']].map(([value, title, text]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}><strong>{title}</strong><span>{text}</span></button>)}</div></details>
    </fieldset>{error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-action"><button type="button" className="btn btn-ghost" disabled={locked} onClick={onClose}>Cancel</button>{mode !== 'ai' && <button form={formId} className="btn btn-primary" disabled={locked}>{locked ? 'Creating…' : `Create ${kind === 'template' ? 'template' : 'landing'}`}</button>}</div></div></dialog>;
}
