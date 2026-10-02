import { Image as ImageIcon, LayoutGrid, Pencil } from 'lucide-react';
import { useStudioText } from '../../i18n/StudioUiProvider.jsx';
import CardFrame, { CardAction, formatCost } from './CardFrame.jsx';

// card: ImageCard { name, before?, after, variants?, width?, height?, cost? }
export default function ImageCard({ card, onAction, can, frame }) {
  const t = useStudioText();
  const size = card.width && card.height ? `${card.width}×${card.height}` : '';
  const meta = [size, formatCost(card.cost)].filter(Boolean).join(' · ');
  return <CardFrame type="image" icon={ImageIcon} title={card.name} meta={meta || undefined} frame={frame}
    actions={<>
      {card.variants?.length > 0 && <CardAction action="variants" can={can} onAction={onAction} card={card} icon={LayoutGrid} label={t('Variants')} />}
      <CardAction action="edit" can={can} onAction={onAction} card={card} icon={Pencil} label={t('Edit')} />
    </>}>
    {card.variants?.length
      ? <div className="studio-card-image-grid">{card.variants.map((src, index) => <img key={src} src={src} alt={t('Variant {number}', { number: index + 1 })} loading="lazy" />)}</div>
      : <div className="studio-card-image-compare">
        {card.before && <figure><img src={card.before} alt={t('Before')} loading="lazy" /><figcaption>{t('Before')}</figcaption></figure>}
        <figure><img src={card.after} alt={card.before ? t('After') : card.name} loading="lazy" />{card.before && <figcaption>{t('After')}</figcaption>}</figure>
      </div>}
  </CardFrame>;
}
