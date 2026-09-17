import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, Code2, FileImage, HelpCircle, LoaderCircle, Maximize2, Minimize2, Monitor, PanelRightClose, PanelRightOpen, Plus, RotateCcw, Settings2, ShieldCheck, Smartphone, X } from 'lucide-react';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { byteSize, createZip, downloadFile, isTemplate, isText, LIMITS, projectFolders, renameFile, safePath, validateFolders, validateProject } from './project.js';
import { buildPreview } from './preview.js';
import { starterProject } from './starter.js';
import ParameterForm from './ParameterForm.jsx';
import ProjectSidebar from './ProjectSidebar.jsx';

const CodeEditor = lazy(() => import('./CodeEditor.jsx'));
const message = error => error instanceof Error ? error.message : String(error);

function FileDialog({ operation, active, onClose, onSubmit }) {
  const [value, setValue] = useState(operation === 'rename' ? active : '');
  const [error, setError] = useState('');
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  const title = operation === 'add-file' ? 'Create a file' : operation === 'add-folder' ? 'Create a folder' : operation === 'rename' ? 'Rename file' : operation === 'remove' ? 'Delete this file?' : 'Start a new project?';
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="dialog-title" onCancel={onClose}><form className="modal-box" onSubmit={event => { event.preventDefault(); try { onSubmit(value); onClose(); } catch (cause) { setError(message(cause)); } }}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
    {['add-file', 'add-folder', 'rename'].includes(operation) ? <><label className="field"><span>{operation === 'add-folder' ? 'Folder path' : 'File path'}</span><input autoFocus className="input input-bordered w-full" value={value} onChange={event => setValue(event.target.value)} placeholder={operation === 'add-folder' ? 'images/gallery' : 'pages/about.tpl'} required /></label><p className="field-help">{operation === 'add-folder' ? 'Nested folders are supported. Use a relative path without spaces.' : 'Use folders in the path, for example blocks/header.tpl. Renaming does not update references in other files.'}</p></> : <p className="muted">{operation === 'remove' ? <><strong>{active}</strong> will be removed from this project.</> : 'Your current work will be replaced. Download the template ZIP first to keep it.'}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-action"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className={`btn ${operation === 'remove' ? 'btn-neutral' : 'btn-primary'}`} type="submit">{operation === 'remove' ? 'Delete file' : operation === 'reset' ? 'Create project' : operation === 'add-folder' ? 'Create folder' : operation === 'add-file' ? 'Create file' : 'Rename file'}</button></div>
  </form><button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={onClose} /></dialog>;
}

function TourDialog({ onClose }) {
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="tour-title" onCancel={onClose}><div className="modal-box tour-modal"><div className="dialog-heading"><div><span className="section-kicker">QUICK START</span><h2 id="tour-title">From template to finished pages</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close quick start" onClick={onClose}><X size={18} /></button></div><ol className="tour-steps"><li><span>1</span><div><strong>Add your project</strong><p>Open a ZIP, create files and folders, or drop assets into Project files.</p></div></li><li><span>2</span><div><strong>Build the template</strong><p>Edit TPL, CSS, and other source files. Changes in Customize update the preview live.</p></div></li><li><span>3</span><div><strong>Choose images</strong><p>Image parameters can use existing project assets or files dropped from your computer.</p></div></li><li><span>4</span><div><strong>Take it with you</strong><p>Download generated pages, and save the template ZIP before closing the browser.</p></div></li></ol><div className="tour-note"><ShieldCheck size={16} /><span>Everything runs locally in this browser. Your files are not uploaded.</span></div><div className="modal-action"><a className="btn btn-ghost" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Read full docs ↗</a><button type="button" className="btn btn-primary" onClick={onClose}>Start creating</button></div></div><button type="button" className="modal-backdrop" aria-label="Close quick start" onClick={onClose} /></dialog>;
}

function PreviewPanel({ ready, mobile, onMobileChange, shownPage, pageNames, onPageChange, preview, error }) {
  return <section id="preview-panel" className="preview-panel" aria-label="Live preview">
    <div className="preview-toolbar"><div className="preview-label"><span className={ready ? 'status-dot' : 'status-dot pending'} /><span>LIVE PREVIEW</span></div><div className="device-tabs" aria-label="Preview size"><button title="Desktop preview" aria-label="Desktop preview" aria-pressed={!mobile} className={!mobile ? 'selected' : ''} onClick={() => onMobileChange(false)}><Monitor size={16} /></button><button title="Mobile preview" aria-label="Mobile preview" aria-pressed={mobile} className={mobile ? 'selected' : ''} onClick={() => onMobileChange(true)}><Smartphone size={15} /></button></div><label className="page-select"><select aria-label="Preview page" value={shownPage || ''} disabled={!pageNames.length} onChange={event => onPageChange(event.target.value)}>{pageNames.length ? pageNames.map(name => <option key={name}>{name}</option>) : <option value="">No pages</option>}</select><ChevronDown size={12} /></label></div>
    <div className={`preview-stage ${mobile ? 'mobile-preview' : ''}`}>{preview ? <div className="browser-frame"><div className="browser-chrome"><span /><span /><span /><div>{shownPage}</div><ShieldCheck size={12} /></div><iframe title="Generated page preview" srcDoc={preview} sandbox="" referrerPolicy="no-referrer" /></div> : <div className="empty-preview"><Code2 size={30} /><h3>A page is taking shape.</h3><p>{error || 'Add a .tpl file with an @layout block to get started.'}</p></div>}</div>
    <div className="preview-bottom"><span><ShieldCheck size={13} /> Static preview · local assets only</span><span>{pageNames.length} {pageNames.length === 1 ? 'page' : 'pages'}</span></div>
  </section>;
}

export default function App() {
  const [files, setFiles] = useState(starterProject);
  const [folders, setFolders] = useState(['images']);
  const [active, setActive] = useState('index.tpl');
  const [reveal, setReveal] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [tab, setTab] = useState('settings');
  const [previewPage, setPreviewPage] = useState('index.html');
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(true);
  const [expandedPreviewVisible, setExpandedPreviewVisible] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState(false);
  const archiveInput = useRef(null), dataInput = useRef(null), importWorker = useRef(null), compactTab = useRef('settings');
  const deferredFiles = useDeferredValue(files);
  const parsed = useMemo(() => { try { return { project: parseProject(deferredFiles) }; } catch (cause) { return { error: message(cause) }; } }, [deferredFiles]);
  const definition = parsed.project?.definition;
  const values = useMemo(() => {
    if (!definition) return {};
    const defaults = getDefaults(definition);
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, Object.hasOwn(overrides, key) ? overrides[key] : value]));
  }, [definition, overrides]);
  const deferredValues = useDeferredValue(values);
  const generated = useMemo(() => {
    if (!definition) return { error: parsed.error };
    try { return { files: generateProject(deferredFiles, deferredValues) }; } catch (cause) { return { error: message(cause) }; }
  }, [definition, deferredFiles, deferredValues, parsed.error]);
  const pageNames = useMemo(() => generated.files ? Object.keys(generated.files).filter(name => /\.html?$/i.test(name)).sort() : [], [generated.files]);
  const shownPage = pageNames.includes(previewPage) ? previewPage : pageNames[0];
  const names = Object.keys(files).sort((a, b) => a.localeCompare(b));
  const activeValue = files[active];
  const ready = !generated.error && deferredFiles === files && deferredValues === values;

  useEffect(() => {
    if (!generated.files || !shownPage) { setPreview(''); return; }
    try { const result = buildPreview(generated.files, shownPage); setPreview(result.html); return result.dispose; }
    catch (cause) { setError(message(cause)); setPreview(''); }
  }, [generated.files, shownPage]);
  useEffect(() => {
    if (!dirty) return;
    const handler = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timeout); }, [notice]);
  useEffect(() => () => importWorker.current?.terminate(), []);
  useEffect(() => {
    if (!workspaceExpanded) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [workspaceExpanded]);

  function replaceProject(next, nextFolders = []) {
    setFiles(next); setActive(Object.keys(next).find(name => isTemplate(name)) || Object.keys(next)[0]);
    setFolders(validateFolders(next, nextFolders)); setOverrides({}); setError(''); setDirty(false); setPreviewPage('index.html');
  }
  async function importArchive(file) {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      if (file.size > LIMITS.archive) throw new Error('Choose a ZIP smaller than 20 MiB.');
      const buffer = await file.arrayBuffer();
      const next = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./archive.worker.js', import.meta.url), { type: 'module' });
        importWorker.current?.terminate(); importWorker.current = worker;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('ZIP import took too long. Use a smaller archive.')); }, 15000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data); };
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('The archive could not be read.')); };
        worker.postMessage(buffer, [buffer]);
      });
      replaceProject(next.files, next.folders); setNotice(`Opened ${file.name}. Everything stays in this browser.`);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); if (archiveInput.current) archiveInput.current.value = ''; }
  }
  async function importData(file) {
    if (!file) return;
    try {
      if (file.size > LIMITS.text) throw new Error('Settings JSON must be smaller than 2 MiB.');
      const data = JSON.parse(await file.text());
      if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Settings must be a JSON object.');
      if (!definition) throw new Error('Fix the template before importing settings.');
      generateProject(files, data);
      setOverrides(data); setDirty(true); setError(''); setNotice('Settings loaded.');
    } catch (cause) { setError(message(cause)); }
    finally { if (dataInput.current) dataInput.current.value = ''; }
  }
  function exportZip(source = false) {
    try {
      if (!source && !ready) throw new Error(generated.error || 'Wait for the template to finish updating.');
      downloadFile(source ? 'trafficops-template.zip' : 'trafficops-pages.zip', createZip(source ? files : generated.files, { generated: !source, directories: source ? folders : [] }));
      if (source && Object.keys(overrides).length === 0) setDirty(false);
      setNotice(source ? 'Template ZIP downloaded.' : 'Your pages are ready. ZIP downloaded.');
    } catch (cause) { setError(message(cause)); }
  }
  function editSource(value) {
    if (byteSize(value) > LIMITS.text) { setError('A text file may be no larger than 2 MiB.'); return; }
    setFiles(previous => ({ ...previous, [active]: value })); setDirty(true);
  }
  function handleDialog(value) {
    if (dialog === 'reset') { replaceProject(starterProject(true)); setDirty(true); return; }
    if (dialog === 'remove') {
      const next = Object.fromEntries(Object.entries(files).filter(([name]) => name !== active));
      if (!Object.keys(next).length) throw new Error('Keep at least one file in your project.');
      setFiles(next); setActive(Object.keys(next)[0]);
    } else if (dialog === 'rename') {
      const name = value.trim(), next = renameFile(files, active, name);
      validateFolders(next, folders);
      setFiles(next); setActive(name);
    }
    else if (dialog === 'add-folder') {
      const name = safePath(value.trim());
      const nextFolders = validateFolders(files, [...folders, name]);
      if (projectFolders(files, folders).includes(name)) throw new Error('This folder already exists.');
      setFolders(nextFolders);
    }
    else {
      const name = safePath(value.trim());
      if (Object.hasOwn(files, name)) throw new Error('A file with this path already exists.');
      const next = validateProject({ ...files, [name]: isTemplate(name) ? '@layout\n  <!doctype html>\n  <html>\n    <body>\n      <h1>New page</h1>\n    </body>\n  </html>\n@endlayout\n' : '' });
      validateFolders(next, folders);
      setFiles(next); setActive(name); setTab('code');
    }
    setDirty(true);
  }

  async function addUploadedFiles(fileList, targetFolder = '', { renameCollisions = false } = {}) {
    const uploads = [...(fileList || [])];
    if (!uploads.length) return [];
    try {
      const additions = {};
      for (const file of uploads) {
        const relative = file.webkitRelativePath || file.name;
        let path = safePath([targetFolder, relative].filter(Boolean).join('/'));
        if (Object.hasOwn(files, path) || Object.hasOwn(additions, path)) {
          if (!renameCollisions) throw new Error(`A file already exists: ${path}`);
          const extensionAt = path.lastIndexOf('.'), base = extensionAt > path.lastIndexOf('/') ? path.slice(0, extensionAt) : path, extension = extensionAt > path.lastIndexOf('/') ? path.slice(extensionAt) : '';
          let suffix = 2;
          while (Object.hasOwn(files, `${base}-${suffix}${extension}`) || Object.hasOwn(additions, `${base}-${suffix}${extension}`)) suffix++;
          path = `${base}-${suffix}${extension}`;
        }
        if (file.size > LIMITS.file || (isText(path) && file.size > LIMITS.text)) throw new Error(`File is too large: ${path}`);
        additions[path] = isText(path) ? await file.text() : new Uint8Array(await file.arrayBuffer());
      }
      const next = validateProject({ ...files, ...additions });
      const nextFolders = validateFolders(next, folders);
      setFiles(next); setFolders(nextFolders); setDirty(true); setError('');
      const paths = Object.keys(additions); setNotice(`${paths.length} ${paths.length === 1 ? 'file' : 'files'} added to the project.`);
      return paths;
    } catch (cause) { setError(message(cause)); return []; }
  }

  function moveEntry(entry, targetFolder) {
    try {
      const source = safePath(entry.path), target = targetFolder ? safePath(targetFolder) : '';
      const destination = [target, source.split('/').pop()].filter(Boolean).join('/');
      if (source === destination) return;
      if (entry.type === 'file') {
        if (projectFolders(files, folders).includes(destination)) throw new Error(`A file conflicts with a folder: ${destination}`);
        const next = renameFile(files, source, destination);
        setFiles(next); if (active === source) setActive(destination);
      } else {
        if (target === source || target.startsWith(`${source}/`)) throw new Error('A folder cannot be moved inside itself.');
        const beforeFolders = projectFolders(files, folders);
        if (beforeFolders.includes(destination) && destination !== source) throw new Error(`A folder already exists: ${destination}`);
        const affected = Object.keys(files).filter(name => name.startsWith(`${source}/`));
        if (!affected.length && !beforeFolders.includes(source)) throw new Error(`Folder not found: ${source}`);
        const nextEntries = Object.entries(files).map(([name, value]) => [name.startsWith(`${source}/`) ? `${destination}${name.slice(source.length)}` : name, value]);
        const destinations = nextEntries.map(([name]) => name);
        if (new Set(destinations).size !== destinations.length) throw new Error(`Moving ${source} would overwrite an existing file.`);
        const next = Object.fromEntries(nextEntries);
        validateProject(next);
        const allFolders = beforeFolders.map(name => name === source || name.startsWith(`${source}/`) ? `${destination}${name.slice(source.length)}` : name);
        setFiles(next); setFolders(validateFolders(next, allFolders));
        if (active?.startsWith(`${source}/`)) setActive(`${destination}${active.slice(source.length)}`);
      }
      setDirty(true); setError('');
    } catch (cause) { setError(message(cause)); }
  }

  async function uploadImage(file) {
    if (!file || (!String(file.type).startsWith('image/') && !/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file.name))) { setError('Choose an image file.'); return null; }
    const paths = await addUploadedFiles([file], 'images', { renameCollisions: true });
    return paths[0] || null;
  }

  function toggleWorkspace() {
    if (!workspaceExpanded) {
      compactTab.current = tab;
      setTab('code');
      setExpandedPreviewVisible(true);
    } else {
      setTab(compactTab.current);
    }
    setWorkspaceExpanded(expanded => !expanded);
  }

  return <div className={`studio ${workspaceExpanded ? 'workspace-expanded' : ''}`}>
    <header className="topbar"><div className="topbar-inner"><a className="brand" href="https://github.com/trafficops-io/tops-templates" target="_blank" rel="noreferrer" aria-label="TrafficOps Templates on GitHub"><img src="/favicon.svg" alt="" /><span className="brand-wordmark">Traffic<span>Ops</span></span></a><span className="brand-divider" /><span className="product-name">Template Studio</span><span className="badge badge-outline version">BETA</span><div className="topbar-right"><span className="privacy"><ShieldCheck size={15} /> Local by design</span><button className="btn btn-ghost btn-sm quick-start-button" aria-label="Open quick start guide" onClick={() => setHelp(true)}><HelpCircle size={16} /> Quick start</button><a className="docs-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Docs ↗</a></div></div></header>
    <main className="workspace">
      <div className="workspace-heading"><div className="workspace-intro"><div className="eyebrow"><span /> TEMPLATE STUDIO / LOCAL-FIRST</div><h1>A little code.<br /><span>A lot of possibility.</span></h1><p>Shape your template, preview every change, and take the result anywhere.</p></div><div className="project-actions"><button className="btn btn-ghost btn-sm expand-workspace-button" onClick={toggleWorkspace}><Maximize2 size={16} /> Expand editor</button><button className="btn btn-ghost btn-sm" onClick={() => setDialog('reset')}><Plus size={16} /> New project</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => archiveInput.current?.click()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUpFromLine size={16} />} Open ZIP</button></div></div>
      {error && <div role="alert" className="error-banner"><span>{error}</span><button className="btn btn-ghost btn-xs btn-square" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <div className={`editor-shell ${workspaceExpanded ? 'is-expanded' : 'is-compact'} ${filesCollapsed ? 'files-collapsed' : ''} ${workspaceExpanded && !expandedPreviewVisible ? 'preview-collapsed' : ''}`}>
        <ProjectSidebar files={files} folders={folders} active={active} isCollapsed={filesCollapsed} onToggleCollapsed={() => setFilesCollapsed(collapsed => !collapsed)} onSelect={name => { setActive(name); if (!isTemplate(name)) setTab('code'); }} onCreate={kind => setDialog(kind === 'folder' ? 'add-folder' : 'add-file')} onRename={() => setDialog('rename')} onDelete={() => setDialog('remove')} onMove={moveEntry} onUpload={addUploadedFiles} onExport={() => exportZip(true)} />
        <section className="author-panel"><div className="author-tabs"><div className="author-tab-list" role="tablist" aria-label="Authoring mode"><button id="settings-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}><Settings2 size={15} /> Customize</button><button id="code-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'code'} className={tab === 'code' ? 'selected' : ''} onClick={() => setTab('code')}><Code2 size={15} /> Source code</button></div>{workspaceExpanded && <button type="button" className="exit-expanded-button" aria-label="Exit expanded view" onClick={toggleWorkspace}><Minimize2 size={15} /> Exit</button>}</div>
          {tab === 'settings' && workspaceExpanded && <div className="settings-heading"><span>Template settings</span><div className="source-tools"><button className="btn btn-ghost btn-xs preview-toggle-button" aria-controls="preview-panel" aria-expanded={expandedPreviewVisible} onClick={() => setExpandedPreviewVisible(visible => !visible)}>{expandedPreviewVisible ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}{expandedPreviewVisible ? 'Hide preview' : 'Show preview'}</button></div></div>}
          <div id="author-content" role="tabpanel" aria-labelledby={`${tab}-tab`} className={`author-content ${tab === 'code' ? 'source-content' : ''}`}>
            {tab === 'settings' ? <><div className="settings-intro"><div className="section-kicker">MAKE IT YOURS</div><h2>{definition?.name || 'Template settings'}</h2><p>{definition?.description || 'Your template’s parameters become the controls below.'}</p></div>{generated.error && <div role="alert" className="validation-error"><strong>{parsed.error ? 'Check your template' : 'Check your settings'}</strong><p>{generated.error}</p></div>}{definition && <ParameterForm definition={definition} values={values} projectImages={names.filter(name => /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(name))} onImageUpload={uploadImage} onChange={next => { setOverrides(next); setDirty(true); }} />}<div className="settings-actions"><button className="btn btn-ghost btn-xs" onClick={() => { setOverrides({}); setDirty(true); }}><RotateCcw size={12} /> Reset defaults</button><button className="btn btn-ghost btn-xs" onClick={() => dataInput.current?.click()}>Load JSON</button><button className="btn btn-ghost btn-xs" disabled={!definition} onClick={() => downloadFile('trafficops-data.json', JSON.stringify(values, null, 2), 'application/json')}>Save JSON</button></div></>
              : <>{typeof activeValue === 'string' ? <Suspense fallback={<div className="empty-state"><LoaderCircle size={20} className="spin" /><p>Opening editor…</p></div>}><CodeEditor key={active} path={active} value={activeValue} files={files} onChange={editSource} onError={setError} reveal={reveal?.path === active ? reveal : null} onOpenFile={(path, selection) => { setActive(path); setTab('code'); setReveal({ path, selection }); }} previewVisible={expandedPreviewVisible} onTogglePreview={workspaceExpanded ? () => setExpandedPreviewVisible(visible => !visible) : undefined} /></Suspense> : <div className="empty-state"><FileImage size={36} /><h3>Asset included</h3><p>This file is preserved in your ZIP.<br />Reference it by its relative path.</p><code>{active}</code><span>{Math.ceil(byteSize(activeValue) / 1024)} KiB</span></div>}</>}
          </div>
        </section>
        {(!workspaceExpanded || expandedPreviewVisible) && <PreviewPanel ready={ready} mobile={mobile} onMobileChange={setMobile} shownPage={shownPage} pageNames={pageNames} onPageChange={setPreviewPage} preview={preview} error={generated.error} />}
      </div>
      <div className="workspace-footer"><div className="workspace-status"><span className={`status-dot ${dirty ? 'pending' : ''}`} /><span>{dirty ? 'Unsaved session · download to keep your work' : 'Ready to make something yours'}</span></div><button className="btn btn-primary generate-button" disabled={!ready || busy} onClick={() => exportZip(false)}><ArrowDownToLine size={16} /> Download pages <span className="button-detail">.zip</span></button></div>
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    {notice && <div className="toast toast-end"><div role="status" className="notice"><Check size={16} />{notice}</div></div>}
    {help && <TourDialog onClose={() => setHelp(false)} />}
    {dialog && <FileDialog operation={dialog} active={active} onClose={() => setDialog(null)} onSubmit={handleDialog} />}
    <input ref={archiveInput} hidden type="file" accept=".zip,application/zip" aria-label="Open template ZIP" onChange={event => importArchive(event.target.files?.[0])} />
    <input ref={dataInput} hidden type="file" accept=".json,application/json" aria-label="Load parameter JSON" onChange={event => importData(event.target.files?.[0])} />
  </div>;
}
