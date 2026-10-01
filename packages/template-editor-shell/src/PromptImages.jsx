import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { readImageAttachments } from './ai-attachments.js';
import { useStudioText } from './studio-i18n.js';
import { useImagePaste } from './use-image-paste.js';

export default function PromptImages({ attachments, onChange, onBusyChange, promptRef, referencesOnly = false, disabled = false }) {
  const input = useRef(null), readingRef = useRef(false), t = useStudioText();
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  async function add(files) {
    if (disabled || readingRef.current || !files.length) return;
    readingRef.current = true; setReading(true); onBusyChange?.(true); setError('');
    try { onChange(await readImageAttachments(files, attachments)); } catch (cause) { setError(t(cause.message)); } finally { readingRef.current = false; setReading(false); onBusyChange?.(false); }
  }
  const onPaste = useImagePaste(promptRef, add, disabled || reading);
  return <div className="ai-attachments" onPaste={onPaste} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); add([...event.dataTransfer.files]); }}>
    <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={t('Reference images')} disabled={disabled || reading} onChange={event => { add([...event.target.files]); event.target.value = ''; }} />
    <button type="button" className="btn btn-outline btn-sm" disabled={disabled || reading || attachments.length >= 4} onClick={() => input.current.click()}><ImagePlus size={15} />{t(reading ? 'Reading images…' : 'Attach images')}</button>
    <small>{t('Screenshots, design references or photos · up to 4 images, 4 MiB each')}</small>
    {promptRef && <small>{t('Paste an image into the prompt with Ctrl+V or ⌘V.')}</small>}
    {attachments.length > 0 && <ul className="ai-attachment-list">{attachments.map(item => <li key={item.id}><img src={item.dataUrl} alt={item.name} /><div><span>{item.name}</span>{!referencesOnly && <label><input type="checkbox" checked={item.useOnPage} disabled={disabled || reading} onChange={event => onChange(attachments.map(value => value.id === item.id ? { ...value, useOnPage: event.target.checked } : value))} />{t('Use on page')}</label>}</div><button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t('Remove image {name}', { name: item.name })} disabled={disabled || reading} onClick={() => onChange(attachments.filter(value => value.id !== item.id))}><X size={14} /></button></li>)}</ul>}
    {attachments.length > 0 && <p className="field-help">{t(referencesOnly ? 'Attached images are references only for selected-block edits. They do not become project assets.' : 'Attached images are sent to the selected AI provider. Choose a text model with image input. Only images marked “Use on page” become project assets when you apply the draft.')}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
