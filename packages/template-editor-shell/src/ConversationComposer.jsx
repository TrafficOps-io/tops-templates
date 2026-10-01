import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, AtSign, Layers, Search, Settings2, X } from 'lucide-react';
import PromptAttachments from './PromptAttachments.jsx';
import ProjectFileThumbnail from './ProjectFileThumbnail.jsx';
import { useStudioText } from './studio-i18n.js';
import { addFileMention, addSectionMention, matchingMentions, mentionAtCaret, mentionKey, mentionLabel } from './conversation-mentions.js';

export default function ConversationComposer({ prompt, onPromptChange, attachments = [], onAttachmentsChange,
  mentions = [], onMentionsChange, files = {}, sections = [], onSubmit, disabled = false, onBusyChange,
  submitLabel = 'Send message', placeholder = 'What would you like to create or change?',
  scope = { kind: 'project' }, onScopeChange, settings, generateImages = false, onGenerateImagesChange,
  autoFocus = false, imageOnly = false }) {
  const t = useStudioText(), id = useId(), root = useRef(null), input = useRef(null), picker = useRef(null), mentionList = useRef(null), composing = useRef(false), options = useRef(null);
  const [query, setQuery] = useState(null), [selected, setSelected] = useState(0), [reading, setReading] = useState(false);
  const [pickerSpace, setPickerSpace] = useState(null);
  const choices = matchingMentions(files, sections, query?.query, query?.kind);
  const showPicker = Boolean(query && onMentionsChange && !disabled);
  useLayoutEffect(() => {
    if (!showPicker || !root.current) return;
    const composer = root.current, panel = composer.closest('.conversation-panel');
    const measure = () => setPickerSpace(Math.max(0, composer.getBoundingClientRect().top - Math.max(0, panel?.getBoundingClientRect().top || 0) - 8));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer); if (panel) observer.observe(panel);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [showPicker]);
  useLayoutEffect(() => {
    const list = mentionList.current, option = list?.querySelector('[aria-selected="true"]');
    if (!showPicker || !option) return;
    // Keep keyboard selection visible without scrolling the surrounding editor or page.
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [selected, query?.query, showPicker, pickerSpace]);
  function updateQuery(value, caret) { setQuery(onMentionsChange ? mentionAtCaret(value, caret) : null); setSelected(0); }
  function select(item) {
    if (!item || !onMentionsChange || disabled) return;
    onMentionsChange(item.kind === 'section' ? addSectionMention(mentions, item) : addFileMention(mentions, item.path));
    if (query) onPromptChange(prompt.slice(0, query.start) + prompt.slice(query.end));
    const caret = query?.start ?? prompt.length;
    setQuery(null); requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(caret, caret); });
  }
  function submit() { if (!disabled && !reading && prompt.trim()) { setQuery(null); onSubmit?.(); } }
  function keyDown(event) {
    if (composing.current || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (showPicker && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) && !(event.key === 'Enter' && event.shiftKey)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { setQuery(null); input.current?.focus(); }
      else if (event.key === 'Enter') select(choices[selected]);
      else setSelected(value => choices.length ? (value + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length : 0);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  }
  return <div className="conversation-composer" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setQuery(null); if (options.current) options.current.open = false; }
  }}>
    {mentions.length > 0 && <div className="conversation-mentions" aria-label={t('Referenced files and sections')}>{mentions.map(item => {
      const name = mentionLabel(item), path = typeof item === 'string' ? item : item.path, key = mentionKey(item);
      return <span className="conversation-mention" key={key} title={item.kind === 'section' ? `${name} · ${item.page}` : path}>{item.kind === 'section' ? <Layers className="conversation-section-icon" size={16} /> : <ProjectFileThumbnail path={path} value={files[path]} />}<span className="conversation-mention-label">@{name}</span>{onMentionsChange && <button type="button" className="btn btn-ghost btn-xs btn-square" disabled={disabled} aria-label={t('Remove reference {name}', { name })} onClick={() => onMentionsChange(mentions.filter(value => mentionKey(value) !== key))}><X size={12} /></button>}</span>;
    })}</div>}
    <label className="sr-only" htmlFor={`${id}-prompt`}>{t('Message to assistant')}</label>
    <textarea id={`${id}-prompt`} ref={input} className="textarea w-full" value={prompt} maxLength={6000} rows={3}
      placeholder={t(placeholder)} disabled={disabled} autoFocus={autoFocus} onKeyDown={keyDown}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      role="combobox" aria-autocomplete="list" aria-expanded={showPicker} aria-controls={showPicker ? `${id}-mentions` : undefined}
      aria-activedescendant={showPicker && choices[selected] ? `${id}-mention-${selected}` : undefined}
      onChange={event => { onPromptChange(event.target.value); updateQuery(event.target.value, event.target.selectionStart); }}
      onClick={event => updateQuery(prompt, event.target.selectionStart)} />
    {showPicker && <div className="conversation-mention-picker" ref={picker} style={pickerSpace === null ? undefined : { '--mention-picker-space': `${pickerSpace}px` }}>
      {query.manual && <label className="conversation-mention-search"><Search size={14} /><input className="input input-sm" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-mentions`} aria-activedescendant={choices[selected] ? `${id}-mention-${selected}` : undefined} aria-label={t('Search references')} placeholder={t('Search references')} value={query.query} onKeyDown={keyDown} onChange={event => { setQuery({ ...query, query: event.target.value }); setSelected(0); }} /></label>}
      <div className="conversation-mention-list" ref={mentionList} id={`${id}-mentions`} role="listbox" aria-label={t(query.kind === 'file' ? 'Project files' : query.kind === 'section' ? 'Page sections' : 'Files and sections')}>
      {choices.length ? choices.map((item, index) => <button type="button" role="option" id={`${id}-mention-${index}`} aria-label={item.kind === 'section' ? `${t('Section')}: ${item.label} · ${item.page}` : item.path} aria-selected={index === selected} key={mentionKey(item)} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => select(item)}>{item.kind === 'section' ? <span className="conversation-section-thumbnail"><Layers size={18} /></span> : <ProjectFileThumbnail path={item.path} value={files[item.path]} />}<span className="conversation-mention-file"><strong>{item.kind === 'section' ? item.label : item.path.split('/').at(-1)}</strong>{item.kind === 'section' ? <small>{t('Section')} · {item.description}</small> : item.path.includes('/') && <small>{item.path.slice(0, item.path.lastIndexOf('/'))}</small>}</span></button>) : <p role="status">{t(query.kind === 'file' ? 'No matching files' : query.kind === 'section' ? 'No matching sections' : 'No matching references')}</p>}
      </div>
    </div>}
    <div className="conversation-composer-tools">
      {onAttachmentsChange && <PromptAttachments promptRef={input} compact imageOnly={imageOnly} allowProjectAssets={scope.kind === 'project'} attachments={attachments} onChange={onAttachmentsChange}
        onBusyChange={value => { setReading(value); onBusyChange?.(value); }} disabled={disabled} showDisclosure={false} />}
      {onMentionsChange && <button type="button" className="btn btn-ghost btn-xs" disabled={disabled} onClick={() => { const caret = input.current?.selectionStart ?? prompt.length; setQuery({ query: '', kind: 'file', manual: true, start: caret, end: caret }); setSelected(0); input.current?.focus(); }}><AtSign size={14} />{t('File')}</button>}
      {onMentionsChange && <button type="button" className="btn btn-ghost btn-xs conversation-section-trigger" disabled={disabled || !sections.length} onClick={() => { const caret = input.current?.selectionStart ?? prompt.length; setQuery({ query: '', kind: 'section', manual: true, start: caret, end: caret }); setSelected(0); input.current?.focus(); }}><Layers size={14} />{t('Section')}</button>}
      {(onScopeChange || onGenerateImagesChange) && <details className="conversation-options" ref={options} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); options.current.open = false; options.current.querySelector('summary')?.focus(); } }}><summary className="btn btn-ghost btn-xs"><Settings2 size={14} />{t('Tools')}</summary><div>
        {onScopeChange && <label className="field"><span>{t('Assistant task')}</span><select className="select select-sm w-full" value={scope.kind} disabled={disabled || ['file', 'block'].includes(scope.kind)} onChange={event => onScopeChange({ kind: event.target.value })}>{[['project', 'Edit project'], ['content', 'Content only'], ['discussion', 'Discuss without changes'], ...(scope.kind === 'file' ? [['file', 'Selected file']] : []), ...(scope.kind === 'block' ? [['block', 'Selected blocks']] : [])].map(([value, text]) => <option key={value} value={value}>{t(text)}</option>)}</select></label>}
        {onGenerateImagesChange && <label className="ai-image-option"><input type="checkbox" disabled={disabled || !settings?.imageModel} checked={generateImages} onChange={event => onGenerateImagesChange(event.target.checked)} />{t('Generate images requested in the brief')}</label>}
      </div></details>}
      <button type="button" className="btn btn-primary btn-sm btn-square conversation-send" disabled={disabled || reading || !prompt.trim()} onClick={submit} aria-label={t(submitLabel)} title={t(submitLabel)}><ArrowUp size={18} aria-hidden="true" /></button>
    </div>
  </div>;
}
