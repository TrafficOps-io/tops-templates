import { ExternalLink, ListTree } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import CardFrame, { CardAction } from './CardFrame.jsx';

// Values are shown as text; structured values are summarised (JSON is shown only in FileCard, spec §5.2).
function display(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.every(item => typeof item !== 'object' || item === null) ? value.join(', ') : '…';
  return typeof value === 'object' ? '…' : String(value);
}

// card: ValuesCard { section, changes: { path, before, after }[] }
export default function ValuesCard({ card, onAction, can, frame }) {
  const t = useStudioText(), changes = Array.isArray(card.changes) ? card.changes.filter(change => change && typeof change === 'object') : [];
  return <CardFrame type="values" icon={ListTree} title={card.section} frame={frame}
    meta={t('Changes: {count}', { count: changes.length })}
    actions={<CardAction action="open" can={can} onAction={onAction} card={card} icon={ExternalLink} label={t('Open')} />}>
    <table className="studio-card-values">
      <thead><tr><th scope="col">{t('Field')}</th><th scope="col">{t('Before')}</th><th scope="col">{t('After')}</th></tr></thead>
      <tbody>{changes.map(change => <tr key={String(change.path)}>
        <th scope="row">{change.path}</th>
        <td className="studio-card-before">{display(change.before)}</td>
        <td className="studio-card-after"><span aria-hidden="true">→ </span>{display(change.after)}</td>
      </tr>)}</tbody>
    </table>
  </CardFrame>;
}
