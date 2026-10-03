import { useState } from 'react';
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DEFAULT_REPOSITORIES } from './template-repositories.js';
import './template-repositories.css';

export default function RepositorySettings({ manager }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function action(operation) {
    setError(''); setNotice('');
    try { await operation(); } catch (cause) { setError(cause.message); }
  }
  async function add(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    await action(async () => { await manager.add(url); setUrl(''); setNotice('Repository added. Its templates are ready to use.'); });
    setBusy(false);
  }
  return <section className="global-settings-section" aria-labelledby="repositories-title">
    <div className="settings-section-intro"><span className="settings-section-number" aria-hidden="true">03</span><h2 id="repositories-title" tabIndex={-1}>Template repositories</h2><p>Add your team’s catalog by its index URL. Templates are grouped by repository in the library and when you create a project.</p></div>
    <div className="settings-section-body repository-settings">
      <form onSubmit={add}><label className="field" htmlFor="repository-index-url"><span>Repository index URL</span><input id="repository-index-url" className="input w-full" type="url" required maxLength={4096} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/templates/index.json" aria-describedby="repository-url-help" disabled={busy} /></label><p id="repository-url-help" className="field-help">Paste a direct JSON file URL from your website, static hosting or GitHub raw content.</p><button className="btn btn-primary btn-sm" disabled={busy || !url.trim()}><Plus size={15} />{busy ? 'Adding repository…' : 'Add repository'}</button></form>
      {(error || manager.error) && <p className="inline-error" role="alert">{error || manager.error}</p>}
      {notice && <p className="field-help" role="status">{notice}</p>}
      <div className="repository-list">{manager.repositories.map(record => {
        const meta = record.catalog?.repository;
        return <article key={record.id} className="repository-row" aria-label={meta?.name || record.url}>
          <div className="repository-heading"><h3>{meta?.name || 'Template repository'}</h3><label className="repository-toggle"><input type="checkbox" className="checkbox checkbox-sm" checked={record.enabled} onChange={event => action(() => manager.enable(record.id, event.target.checked))} aria-label={`Enable ${meta?.name || record.url}`} />Enabled</label></div>
          {meta?.description && <p>{meta.description}</p>}
          <a className="repository-url text-link" href={record.url} target="_blank" rel="noreferrer">{record.url}<ExternalLink size={12} /></a>
          <div className="repository-meta">{meta?.author && <span>By {meta.author}</span>}{meta?.homepage && <a className="text-link" href={meta.homepage} target="_blank" rel="noreferrer">Homepage <ExternalLink size={12} /></a>}<span>{record.catalog ? `${record.catalog.templates.length} templates` : 'No cached index'}</span>{record.builtin && <span>Included with Studio</span>}</div>
          <p className="repository-status" role="status">{record.loading ? 'Refreshing index…' : record.updatedAt ? `Last refreshed ${new Date(record.updatedAt).toLocaleString()}` : 'Not refreshed yet'}</p>
          {record.error && <p className="inline-error" role="alert">{record.error}{record.catalog && ' Showing the last saved catalog.'}</p>}
          <div className="repository-actions"><button type="button" className="btn btn-outline btn-sm" disabled={record.loading} onClick={() => manager.refresh(record.id)} aria-label={`Refresh ${meta?.name || record.url}`}><RefreshCw size={14} />Refresh</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => action(() => manager.remove(record.id))} aria-label={`Remove ${meta?.name || record.url}`}><Trash2 size={14} />Remove</button></div>
        </article>;
      })}</div>
      {!manager.repositories.length && <p className="field-help">No repositories added. Add an index URL to browse templates.</p>}
      <div className="repository-actions">{DEFAULT_REPOSITORIES.filter(entry => !manager.repositories.some(record => record.url === new URL(entry.path, location.href).href)).map(entry => <button type="button" key={entry.id} className="text-link" disabled={busy} onClick={() => setUrl(new URL(entry.path, location.href).href)}>Use the included {entry.name} repository</button>)}</div>
      <p className="field-help">Repositories are saved in this browser and shared by all your Studio projects. Removing one keeps projects you have already created. Previously downloaded templates remain available offline while browser cache is retained.</p>
      <details className="settings-privacy"><summary>Hosting a repository</summary><p>Publish an index.json and editable ZIP archives on an HTTP(S) host. Links can be relative to the index. Cross-origin indexes and ZIPs need the Access-Control-Allow-Origin header; use HTTPS when Studio runs on HTTPS. GitHub URLs should point to raw files. Preview pages must allow embedding, or users can open the preview link.</p><p>Only add sources you trust: templates can contain scripts that run in the project preview. Repository requests do not send credentials.</p></details>
    </div>
  </section>;
}
