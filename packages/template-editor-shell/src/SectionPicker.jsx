import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, Search } from 'lucide-react';
import { useStudioText } from './studio-i18n.js';

export default function SectionPicker({ sections, selectedIds, onChange, disabled = false }) {
  const t = useStudioText(), id = useId(), root = useRef(null), trigger = useRef(null), input = useRef(null), list = useRef(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const matches = sections.filter(section => `${section.label} ${section.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const dismiss = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    const option = list.current?.querySelector('[data-active="true"]');
    if (!option) return;
    if (option.offsetTop < list.current.scrollTop) list.current.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.current.scrollTop + list.current.clientHeight) list.current.scrollTop = option.offsetTop + option.offsetHeight - list.current.clientHeight;
  }, [active, query, open]);
  function toggle(section) {
    if (disabled || !section) return;
    onChange(selectedIds.includes(section.id) ? selectedIds.filter(id => id !== section.id) : [...selectedIds, section.id]);
  }
  return <div className="preview-section-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (disabled) return;
      event.preventDefault();
      if (!open) { setQuery(''); setActive(0); setOpen(true); }
      else setActive(value => event.key === 'Home' ? 0 : event.key === 'End' ? matches.length - 1 : matches.length ? (value + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length : 0);
    } else if (event.key === 'Enter' && open) { event.preventDefault(); toggle(matches[active]); }
  }}>
    <button ref={trigger} type="button" className="btn btn-outline btn-sm" aria-label={t('Choose sections')} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-sections` : undefined} disabled={disabled} onClick={() => { setQuery(''); setActive(0); setOpen(value => !value); }}><Layers size={13} />{t('Choose sections')}<ChevronDown size={12} /></button>
    {open && <div className="preview-section-popover"><label className="preview-section-search"><Search size={14} /><input ref={input} className="input input-sm" role="combobox" aria-label={t('Search sections')} placeholder={t('Search sections')} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-sections`} aria-activedescendant={matches[active] ? `${id}-section-${active}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /></label>
      <div ref={list} id={`${id}-sections`} role="listbox" aria-label={t('Page sections')} aria-multiselectable="true" className="preview-section-list">{matches.length ? matches.map((section, index) => <button key={section.id} id={`${id}-section-${index}`} type="button" role="option" tabIndex={-1} aria-label={section.label} aria-selected={selectedIds.includes(section.id)} data-active={index === active} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => toggle(section)}><span className="preview-section-check">{selectedIds.includes(section.id) && <Check size={13} />}</span><span><strong>{section.label}</strong><small>{section.description}</small></span></button>) : <p role="status">{t('No matching sections')}</p>}</div>
    </div>}
  </div>;
}
