import { LayoutGrid, Pencil, Video } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import CardFrame, { CardAction, formatCost, formatDuration } from './CardFrame.jsx';
import { MediaProgress } from './AudioCard.jsx';

// card: VideoCard { name, url?, poster?, durationMs?, width?, height?, provider?, cost?, status?, progress? }
export default function VideoCard({ card, onAction, can, frame }) {
  const t = useStudioText();
  const status = card.status ?? 'ready';
  const size = card.width && card.height ? `${card.width}×${card.height}` : '';
  const meta = [size, formatDuration(card.durationMs), card.provider, formatCost(card.cost)].filter(Boolean).join(' · ');
  return <CardFrame type="video" icon={Video} title={card.name} meta={meta || undefined} frame={frame}
    actions={<>
      <CardAction action="variants" can={can} onAction={onAction} card={card} icon={LayoutGrid} label={t('Variants')} />
      <CardAction action="edit" can={can} onAction={onAction} card={card} icon={Pencil} label={t('Edit')} />
    </>}>
    {status === 'ready' && card.url && <video controls preload="metadata" src={card.url} poster={card.poster} className="studio-card-video" />}
    {status === 'generating' && <MediaProgress progress={card.progress} />}
    {status === 'failed' && <p className="studio-card-failed">{t('Generation failed')}</p>}
  </CardFrame>;
}
