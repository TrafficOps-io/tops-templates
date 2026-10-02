import { ExternalLink, RotateCw, Wand2 } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import CardFrame, { CardAction } from './CardFrame.jsx';

// card: OperationCard { label, target: MentionTarget, before?, after? }
export default function OperationCard({ card, onAction, can, frame }) {
  const t = useStudioText();
  const changed = card.before !== undefined || card.after !== undefined;
  return <CardFrame type="operation" icon={Wand2} title={card.label} meta={card.target?.label} frame={frame}
    actions={<>
      <CardAction action="open" can={can} onAction={onAction} card={card} icon={ExternalLink} label={t('Open')} />
      <CardAction action="continue" can={can} onAction={onAction} card={card} icon={RotateCw} label={t('Continue')} />
    </>}>
    {changed && <p className="studio-card-change">
      <span className="studio-card-before">{card.before || '—'}</span>
      <span aria-hidden="true"> → </span>
      <span className="studio-card-after">{card.after || '—'}</span>
    </p>}
  </CardFrame>;
}
