import { useState } from 'react';
import { FileCode2, ExternalLink } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import { lineDiff } from '../chat-model.js';
import CardFrame, { CardAction } from './CardFrame.jsx';

const LIMIT = 80;

// card: DiffCard { path, added, removed, before, after }
export default function DiffCard({ card, onAction, can, frame }) {
  const t = useStudioText(), [expanded, setExpanded] = useState(false);
  const { leading, removed, added, trailing } = lineDiff(card.before, card.after);
  const truncated = removed.length > LIMIT || added.length > LIMIT, limit = expanded ? undefined : LIMIT;
  return <CardFrame type="diff" icon={FileCode2} title={card.path} frame={frame}
    meta={<><span className="studio-card-added">+{card.added}</span> <span className="studio-card-removed">−{card.removed}</span></>}
    actions={<CardAction action="open" can={can} onAction={onAction} card={card} icon={ExternalLink} label={t('Open')} />}>
    <pre className="studio-card-diff" tabIndex={0}>
      {leading.map((line, index) => <span key={`l${index}`} className="studio-card-diff-context">{`  ${line}\n`}</span>)}
      {removed.slice(0, limit).map((line, index) => <span key={`r${index}`} className="studio-card-diff-removed">{`− ${line}\n`}</span>)}
      {added.slice(0, limit).map((line, index) => <span key={`a${index}`} className="studio-card-diff-added">{`+ ${line}\n`}</span>)}
      {trailing.map((line, index) => <span key={`t${index}`} className="studio-card-diff-context">{`  ${line}\n`}</span>)}
    </pre>
    {truncated && <button type="button" className="studio-card-link" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'Show fewer changes' : 'Show full changes')}</button>}
  </CardFrame>;
}
