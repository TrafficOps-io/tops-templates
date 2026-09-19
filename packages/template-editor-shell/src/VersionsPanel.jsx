import { History } from 'lucide-react';
import { versionsModel } from './versions-model.js';
export default function VersionsPanel({ title, description, groups, group, onGroupChange, actions, highlighted, onDismissHighlight }) {
  const model = versionsModel(groups, group);
  return <section className={`versions-panel ${highlighted ? 'is-highlighted' : ''}`} aria-label={title} onClick={onDismissHighlight}>
    <header className="versions-heading"><div><h2>{title}</h2><p>{description}</p></div><div className="versions-actions">{actions}</div></header>
    <div className="versions-segments" role="group" aria-label={title}>{model.segments.map(segment => <button type="button" key={segment.id} aria-pressed={model.selected.id === segment.id} className={model.selected.id === segment.id ? 'selected' : ''} onClick={() => onGroupChange(segment.id)}>{segment.label}<span className="count">{segment.count}</span></button>)}</div>
    {model.empty ? <div className="versions-empty"><History size={22} /><h3>{model.empty.title}</h3><p>{model.empty.description}</p></div> : <div className="versions-list">{model.rows.map(row => <article key={row.id} className="version-row"><div><strong>{row.title}</strong>{row.badge && <span className="version-badge">{row.badge}</span>}<p>{row.meta}</p></div><div className="version-actions">{row.actions}</div></article>)}</div>}
  </section>;
}
