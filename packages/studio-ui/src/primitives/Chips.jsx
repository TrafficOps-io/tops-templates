import { AtSign, FileText, Image as ImageIcon, Layers, Music, Video, X } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
const kindIcons = { section: Layers, scene: Layers, track: Music, file: FileText, asset: ImageIcon, field: AtSign };
const typeIcons = { image: ImageIcon, audio: Music, video: Video, document: FileText };
export function formatBytes(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(2)} GB`; }
// target: { kind, label }; onOpen(target) — переход к цели; onRemove — только в композере
export function MentionChip({ target, onOpen, onRemove, t: translate }) {
  const context = useStudioText(), t = translate || context, Icon = kindIcons[target.kind] || AtSign;
  return <span className={`studio-chip studio-chip-mention studio-chip-${target.kind}`}>
    <button type="button" className="studio-chip-main" onClick={onOpen ? () => onOpen(target) : undefined} disabled={!onOpen}><Icon size={12} aria-hidden="true" />@{target.label}</button>
    {onRemove && <button type="button" className="studio-chip-remove" aria-label={t('Remove {name}', { name: target.label })} onClick={onRemove}><X size={12} aria-hidden="true" /></button>}
  </span>;
}
// attachment: { name, type: image|audio|video|document, bytes }
export function AttachmentChip({ attachment, onOpen, onRemove, t: translate }) {
  const context = useStudioText(), t = translate || context, Icon = typeIcons[attachment.type] || FileText;
  return <span className="studio-chip studio-chip-attachment">
    <button type="button" className="studio-chip-main" onClick={onOpen ? () => onOpen(attachment) : undefined} disabled={!onOpen}><Icon size={12} aria-hidden="true" />{attachment.name}<span className="studio-chip-meta">{formatBytes(attachment.bytes)}</span></button>
    {onRemove && <button type="button" className="studio-chip-remove" aria-label={t('Remove {name}', { name: attachment.name })} onClick={onRemove}><X size={12} aria-hidden="true" /></button>}
  </span>;
}
