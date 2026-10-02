import { Music, Pencil, Play } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import CardFrame, { CardAction, formatCost, formatDuration, formatPercent } from './CardFrame.jsx';

// card: AudioCard { name, url?, durationMs?, provider?, cost?, status?: generating | ready | failed, progress? }
// url/durationMs may be missing while generating.
export default function AudioCard({ card, onAction, can, frame }) {
  const t = useStudioText();
  const status = card.status ?? 'ready';
  const meta = [formatDuration(card.durationMs), card.provider, formatCost(card.cost)].filter(Boolean).join(' · ');
  return <CardFrame type="audio" icon={Music} title={card.name} meta={meta || undefined} frame={frame}
    actions={<>
      {status === 'ready' && <CardAction action="play" can={can} onAction={onAction} card={card} icon={Play} label={t('Play')} />}
      <CardAction action="edit" can={can} onAction={onAction} card={card} icon={Pencil} label={t('Edit')} />
    </>}>
    {status === 'ready' && card.url && <audio controls preload="metadata" src={card.url} className="studio-card-audio" />}
    {status === 'generating' && <MediaProgress progress={card.progress} />}
    {status === 'failed' && <p className="studio-card-failed">{t('Generation failed')}</p>}
  </CardFrame>;
}

export function MediaProgress({ progress }) {
  const t = useStudioText(), known = Number.isFinite(progress);
  return <div className="studio-card-progress">
    <progress max={1} value={known ? progress : undefined} aria-label={t('Generating…')} />
    <span>{known ? formatPercent(progress) : t('Generating…')}</span>
  </div>;
}
