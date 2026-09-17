import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, Code2, FileCode2, FileImage, Files, FolderOpen, HelpCircle, LoaderCircle, Monitor, PanelRightClose, PanelRightOpen, Pencil, Plus, RotateCcw, Settings2, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';
import { byteSize, createZip, downloadFile, isTemplate, LIMITS, renameFile, safePath, validateProject } from './project.js';
import { buildPreview } from './preview.js';
import { starterProject } from './starter.js';
import ParameterForm from './ParameterForm.jsx';

const CodeEditor = lazy(() => import('./CodeEditor.jsx'));
const message = error => error instanceof Error ? error.message : String(error);

function FileDialog({ operation, active, onClose, onSubmit }) {
  const [value, setValue] = useState(operation === 'rename' ? active : '');
  const [error, setError] = useState('');
  const nativeDialog = useRef(null);
  useEffect(() => { nativeDialog.current.showModal(); }, []);
  const title = operation === 'add' ? 'Create a file' : operation === 'rename' ? 'Rename file' : operation === 'remove' ? 'Delete this file?' : 'Start a new project?';
  return <dialog ref={nativeDialog} className="modal" aria-labelledby="dialog-title" onCancel={onClose}><form className="modal-box" onSubmit={event => { event.preventDefault(); try { onSubmit(value); onClose(); } catch (cause) { setError(message(cause)); } }}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
    {['add', 'rename'].includes(operation) ? <><label className="field"><span>File path</span><input autoFocus className="input input-bordered w-full" value={value} onChange={event => setValue(event.target.value)} placeholder="pages/about.tpl" required /></label><p className="field-help">Use folders in the path, for example blocks/header.tpl. Renaming does not update references in other files.</p></> : <p className="muted">{operation === 'remove' ? <><strong>{active}</strong> will be removed from this project.</> : 'Your current work will be replaced. Download the template ZIP first to keep it.'}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-action"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className={`btn ${operation === 'remove' ? 'btn-neutral' : 'btn-primary'}`} type="submit">{operation === 'remove' ? 'Delete file' : operation === 'reset' ? 'Create project' : 'Save file'}</button></div>
  </form><button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={onClose} /></dialog>;
}

export default function App() {
  const [files, setFiles] = useState(starterProject);
  const [active, setActive] = useState('index.tpl');
  const [overrides, setOverrides] = useState({});
  const [tab, setTab] = useState('settings');
  const [previewPage, setPreviewPage] = useState('index.html');
  const [previewVisible, setPreviewVisible] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState(false);
  const archiveInput = useRef(null), dataInput = useRef(null), importWorker = useRef(null);
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

  function replaceProject(next) {
    setFiles(next); setActive(Object.keys(next).find(name => isTemplate(name)) || Object.keys(next)[0]);
    setOverrides({}); setError(''); setDirty(false); setPreviewPage('index.html');
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
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.files); };
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('The archive could not be read.')); };
        worker.postMessage(buffer, [buffer]);
      });
      replaceProject(next); setNotice(`Opened ${file.name}. Everything stays in this browser.`);
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
      downloadFile(source ? 'trafficops-template.zip' : 'trafficops-pages.zip', createZip(source ? files : generated.files, { generated: !source }));
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
    } else if (dialog === 'rename') { setFiles(renameFile(files, active, value.trim())); setActive(value.trim()); }
    else {
      const name = safePath(value.trim());
      if (Object.hasOwn(files, name)) throw new Error('A file with this path already exists.');
      const next = validateProject({ ...files, [name]: isTemplate(name) ? '@layout\n<!doctype html>\n<html><body><h1>New page</h1></body></html>\n@endlayout\n' : '' });
      setFiles(next); setActive(name); setTab('code');
    }
    setDirty(true);
  }

  return <div className="studio">
    <header className="topbar"><a className="brand" href="https://github.com/trafficops-io/tops-templates" target="_blank" rel="noreferrer"><img src="/favicon.svg" alt="" /><span>trafficops<span className="brand-domain">.io</span></span></a><span className="brand-divider" /><span className="product-name">Template Studio</span><span className="badge badge-outline version">BETA</span><div className="topbar-right"><span className="privacy"><ShieldCheck size={15} /> Local by design</span><button className="btn btn-ghost btn-sm btn-square" aria-label="Show editor help" onClick={() => setHelp(!help)}><HelpCircle size={18} /></button><a className="docs-link" href="https://github.com/trafficops-io/tops-templates/tree/main/docs" target="_blank" rel="noreferrer">Docs ↗</a></div></header>
    <main className="workspace">
      <div className="workspace-heading"><div><div className="eyebrow"><span /> YOUR NEXT PAGE STARTS HERE</div><h1>A little code. A lot of possibility.</h1><p>Shape your template, make it yours, take it anywhere.</p></div><div className="project-actions"><button className="btn btn-ghost btn-sm" aria-controls="preview-panel" aria-expanded={previewVisible} onClick={() => setPreviewVisible(visible => !visible)}>{previewVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}{previewVisible ? 'Hide preview' : 'Show preview'}</button><button className="btn btn-ghost btn-sm" onClick={() => setDialog('reset')}><Plus size={16} /> New project</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => archiveInput.current?.click()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUpFromLine size={16} />} Open ZIP</button></div></div>
      {help && <div className="help-panel"><div><strong>Your browser is the workspace.</strong><p>Open a template ZIP or start a new project. Edit files with Monaco, set parameters, and download generated pages. Images use relative paths; include the matching assets in the ZIP. Scripts, navigation, and external resources are disabled in preview. Download your template before closing — this session is not saved automatically.</p></div><button className="btn btn-ghost btn-sm btn-square" aria-label="Close help" onClick={() => setHelp(false)}><X size={16} /></button></div>}
      {error && <div role="alert" className="error-banner"><span>{error}</span><button className="btn btn-ghost btn-xs btn-square" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <div className={`editor-shell ${previewVisible ? '' : 'preview-hidden'}`}>
        <aside className="file-sidebar"><div className="panel-heading"><span><Files size={15} /> PROJECT FILES</span><button className="btn btn-ghost btn-xs btn-square" aria-label="Create file" onClick={() => setDialog('add')}><Plus size={15} /></button></div><div className="project-folder"><FolderOpen size={15} /><span>my-template</span><span className="count">{names.length}</span></div><nav className="file-tree" aria-label="Project files">{names.map(name => <button className={`file-row ${name === active ? 'active' : ''}`} title={name} key={name} onClick={() => { setActive(name); if (!isTemplate(name)) setTab('code'); }}><span className={`file-icon ${isTemplate(name) ? 'template-icon' : ''}`}>{/\.(svg|png|jpe?g|webp|gif)$/i.test(name) ? <FileImage size={15} /> : <FileCode2 size={15} />}</span><span className="file-name">{name}</span>{name === active && <span className="active-dot" />}</button>)}</nav><div className="file-actions"><button className="btn btn-ghost btn-xs" onClick={() => setDialog('rename')}><Pencil size={12} /> Rename</button><button className="btn btn-ghost btn-xs" onClick={() => setDialog('remove')}><Trash2 size={12} /> Delete</button></div><div className="sidebar-footer"><div className="local-mark"><ShieldCheck size={16} /><strong>Yours, from start to finish.</strong></div><p>No accounts. No uploads.<br />Just you and your next idea.</p><button className="btn btn-outline btn-sm w-full" onClick={() => exportZip(true)}><ArrowDownToLine size={14} /> Save template ZIP</button></div></aside>
        <section className="author-panel"><div className="author-tabs" role="tablist" aria-label="Authoring mode"><button id="settings-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}><Settings2 size={15} /> Customize</button><button id="code-tab" role="tab" aria-controls="author-content" aria-selected={tab === 'code'} className={tab === 'code' ? 'selected' : ''} onClick={() => setTab('code')}><Code2 size={15} /> Source code</button></div><div id="author-content" role="tabpanel" aria-labelledby={`${tab}-tab`} className={`author-content ${tab === 'code' ? 'source-content' : ''}`}>
          {tab === 'settings' ? <><div className="settings-intro"><div className="section-kicker">MAKE IT YOURS</div><h2>{definition?.name || 'Template settings'}</h2><p>{definition?.description || 'Your template’s parameters become the controls below.'}</p></div>{generated.error && <div role="alert" className="validation-error"><strong>{parsed.error ? 'Check your template' : 'Check your settings'}</strong><p>{generated.error}</p></div>}{definition && <ParameterForm definition={definition} values={values} onChange={next => { setOverrides(next); setDirty(true); }} />}<div className="settings-actions"><button className="btn btn-ghost btn-xs" onClick={() => { setOverrides({}); setDirty(true); }}><RotateCcw size={12} /> Reset defaults</button><button className="btn btn-ghost btn-xs" onClick={() => dataInput.current?.click()}>Load JSON</button><button className="btn btn-ghost btn-xs" disabled={!definition} onClick={() => downloadFile('trafficops-data.json', JSON.stringify(values, null, 2), 'application/json')}>Save JSON</button></div></>
            : <><div className="source-heading"><span>{active}</span><span>{typeof activeValue === 'string' ? 'UTF-8' : 'BINARY'}</span></div>{typeof activeValue === 'string' ? <Suspense fallback={<div className="empty-state"><LoaderCircle size={20} className="spin" /><p>Opening editor…</p></div>}><CodeEditor key={active} path={active} value={activeValue} onChange={editSource} /></Suspense> : <div className="empty-state"><FileImage size={36} /><h3>Asset included</h3><p>This file is preserved in your ZIP.<br />Reference it by its relative path.</p><code>{active}</code><span>{Math.ceil(byteSize(activeValue) / 1024)} KiB</span></div>}</>}
        </div></section>
        <section id="preview-panel" className="preview-panel" hidden={!previewVisible}><div className="preview-toolbar"><div className="preview-label"><span className={ready ? 'status-dot' : 'status-dot pending'} /><span>LIVE PREVIEW</span></div><div className="device-tabs" aria-label="Preview size"><button title="Desktop preview" aria-label="Desktop preview" aria-pressed={!mobile} className={!mobile ? 'selected' : ''} onClick={() => setMobile(false)}><Monitor size={16} /></button><button title="Mobile preview" aria-label="Mobile preview" aria-pressed={mobile} className={mobile ? 'selected' : ''} onClick={() => setMobile(true)}><Smartphone size={15} /></button></div><label className="page-select"><select aria-label="Preview page" value={shownPage || ''} disabled={!pageNames.length} onChange={event => setPreviewPage(event.target.value)}>{pageNames.length ? pageNames.map(name => <option key={name}>{name}</option>) : <option value="">No pages</option>}</select><ChevronDown size={12} /></label></div>
          <div className={`preview-stage ${mobile ? 'mobile-preview' : ''}`}>{preview ? <div className="browser-frame"><div className="browser-chrome"><span /><span /><span /><div>{shownPage}</div><ShieldCheck size={12} /></div><iframe title="Generated page preview" srcDoc={preview} sandbox="" referrerPolicy="no-referrer" /></div> : <div className="empty-preview"><Code2 size={30} /><h3>A page is taking shape.</h3><p>{generated.error || 'Add a .tpl file with an @layout block to get started.'}</p></div>}</div>
          <div className="preview-bottom"><span><ShieldCheck size={13} /> Static preview · local assets only</span><span>{pageNames.length} {pageNames.length === 1 ? 'page' : 'pages'}</span></div>
        </section>
      </div>
      <div className="workspace-footer"><div className="workspace-status"><span className={`status-dot ${dirty ? 'pending' : ''}`} /><span>{dirty ? 'Unsaved session · download to keep your work' : 'Ready to make something yours'}</span></div><button className="btn btn-primary generate-button" disabled={!ready || busy} onClick={() => exportZip(false)}><ArrowDownToLine size={16} /> Download pages <span className="button-detail">.zip</span></button></div>
    </main>
    <footer className="site-footer"><span>BUILT FOR THE WAY YOU CREATE.</span><span>Open source, by <a href="https://github.com/trafficops-io" target="_blank" rel="noreferrer">trafficops.io ↗</a></span></footer>
    {notice && <div className="toast toast-end"><div role="status" className="notice"><Check size={16} />{notice}</div></div>}
    {dialog && <FileDialog operation={dialog} active={active} onClose={() => setDialog(null)} onSubmit={handleDialog} />}
    <input ref={archiveInput} hidden type="file" accept=".zip,application/zip" aria-label="Open template ZIP" onChange={event => importArchive(event.target.files?.[0])} />
    <input ref={dataInput} hidden type="file" accept=".json,application/json" aria-label="Load parameter JSON" onChange={event => importData(event.target.files?.[0])} />
  </div>;
}
