import { ExternalLink, FileText } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import { formatBytes } from '../../primitives/Chips.jsx';
import CardFrame, { CardAction } from './CardFrame.jsx';

// card: FileCard { name, bytes, url?, raw? }. raw is the only place where JSON is shown (spec §5.2);
// unknown card types arrive here with raw = the original result.
export default function FileCard({ card, onAction, can, frame }) {
  const t = useStudioText();
  return <CardFrame type="file" icon={FileText} title={card.name} meta={Number.isFinite(card.bytes) ? formatBytes(card.bytes, t) : undefined} frame={frame}
    actions={<CardAction action="open" can={can} onAction={onAction} card={card} icon={ExternalLink} label={t('Open')} />}>
    {card.raw !== undefined && <details className="studio-card-raw"><summary>{t('Details')}</summary><pre tabIndex={0}>{JSON.stringify(card.raw, null, 2)}</pre></details>}
  </CardFrame>;
}
