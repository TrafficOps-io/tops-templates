import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import { AttachmentChip, formatBytes } from '../primitives/Chips.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import { attachmentType, attachmentUsage } from './attachments.js';

const keyOf = (file, index) => `${index}:${file.name}:${file.size}`;

// files: File[] attached in the composer; onRemove(index).
export default function Attachments({ files = [], onRemove, disabled = false }) {
  if (!files.length) return null;
  return <div className="studio-chat-composer-attachments">
    {files.map((file, index) => <AttachmentChip key={keyOf(file, index)} attachment={{ name: file.name, type: attachmentType(file), bytes: file.size }}
      onRemove={onRemove && !disabled ? () => onRemove(index) : undefined} />)}
  </div>;
}

// "N of count · X of total" by port.attachmentLimits; nothing without limits.
export function AttachmentCounter({ files = [], limits }) {
  const t = useStudioText();
  if (!limits) return null;
  const usage = attachmentUsage(files, limits);
  const over = usage.count >= usage.maxCount;
  return <span className="studio-chat-composer-counter" data-full={over || undefined}>
    {t('{count} of {max} files · {size} of {total}', { count: usage.count, max: usage.maxCount, size: formatBytes(usage.bytes), total: formatBytes(usage.maxBytes) })}
  </span>;
}

const REASONS = {
  count: 'Too many files: up to {count} per message.',
  size: 'Empty or larger than {size}.',
  total: 'All files together must fit in {total}.',
  type: 'This file type is not supported.',
};

// rejected: { file, reason }[] from appendAttachments; the reason is shown next to the file name.
export function RejectedAttachments({ rejected = [], limits, onDismiss }) {
  const t = useStudioText();
  if (!rejected.length) return null;
  const values = { count: limits?.count, size: formatBytes(limits?.bytesPerFile ?? 0), total: formatBytes(limits?.bytesTotal ?? 0) };
  return <InlineNotice tone="danger" title={t('Some files were not attached')}
    actions={onDismiss && <button type="button" className="studio-chat-composer-dismiss" onClick={onDismiss}>{t('Dismiss')}</button>}>
    <ul className="studio-chat-composer-rejected">
      {rejected.map(({ file, reason }, index) => <li key={keyOf(file, index)}><strong>{file.name}</strong> — {t(REASONS[reason], values)}</li>)}
    </ul>
  </InlineNotice>;
}
