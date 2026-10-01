import { useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { FILE_ATTACHMENT_ACCEPT, FILE_ATTACHMENT_LIMITS, readFileAiAttachments } from './file-ai-attachments.js';
import { useStudioText } from './studio-i18n.js';
import { useImagePaste } from './use-image-paste.js';

export default function PromptAttachments({ attachments = [], onChange, onBusyChange, promptRef, disabled = false, showDisclosure = true, compact = false, imageOnly = false, allowProjectAssets = false }) {
  const input = useRef(null), readingRef = useRef(false), t = useStudioText();
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  async function add(files) {
    if (disabled || readingRef.current || !files.length) return;
    readingRef.current = true; setReading(true); onBusyChange?.(true); setError('');
    try {
      if (imageOnly && Array.from(files).some(file => !/^image\/(png|jpeg|webp)$/.test(file.type))) throw new Error('Attach PNG, JPEG or WebP images for this request.');
      const next = await readFileAiAttachments(files, attachments);
      onChange(next.map(item => item.mime.startsWith('image/') ? { ...item, useOnPage: Boolean(attachments.find(previous => previous.id === item.id)?.useOnPage) } : item));
    }
    catch (cause) { setError(t(cause.message)); }
    finally { readingRef.current = false; setReading(false); onBusyChange?.(false); }
  }
  const onPaste = useImagePaste(promptRef, add, disabled || reading);
  return <div className={`ai-attachments ${compact ? 'ai-attachments--compact' : ''}`} onPaste={onPaste} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); add([...event.dataTransfer.files]); }}>
    <input ref={input} hidden type="file" multiple accept={imageOnly ? 'image/png,image/jpeg,image/webp' : FILE_ATTACHMENT_ACCEPT} aria-label={t('Reference files')} disabled={disabled || reading} onChange={event => { add([...event.target.files]); event.target.value = ''; }} />
    <button type="button" className={`btn ${compact ? 'btn-ghost btn-xs' : 'btn-outline btn-sm'}`} disabled={disabled || reading || attachments.length >= FILE_ATTACHMENT_LIMITS.count} onClick={() => input.current.click()}><Paperclip size={15} />{t(reading ? 'Reading files…' : compact ? 'Add reference' : 'Attach images or documents')}</button>
    {!compact && <small>{t('PNG, JPEG, WebP, PDF or UTF-8 text · up to 4 files · images/PDF 4 MiB each · text 256 KiB each')}</small>}
    {!compact && promptRef && <small>{t('Paste an image into the prompt with Ctrl+V or ⌘V.')}</small>}
    {attachments.length > 0 && <ul className="ai-attachment-list">{attachments.map(item => <li key={item.id}>{item.mime.startsWith('image/') ? <img src={item.dataUrl} alt={item.name} /> : <FileText size={24} aria-hidden="true" />}<div><span>{item.name}</span><small>{item.mime === 'application/pdf' ? 'PDF' : item.mime.startsWith('image/') ? t('Image reference') : t('Text document')}</small>{allowProjectAssets && item.mime.startsWith('image/') && <label><input type="checkbox" checked={Boolean(item.useOnPage)} disabled={disabled} onChange={event => onChange(attachments.map(value => value.id === item.id ? { ...value, useOnPage: event.target.checked } : value))} />{t('Use on page')}</label>}</div><button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t('Remove reference {name}', { name: item.name })} disabled={disabled || reading} onClick={() => onChange(attachments.filter(value => value.id !== item.id))}><X size={14} /></button></li>)}</ul>}
    {showDisclosure && attachments.length > 0 && <p className="field-help">{t('Reference files are sent to OpenRouter and the selected provider for this edit. PDF processing may use provider credits. Attachments provide context and are not added to your project.')}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
