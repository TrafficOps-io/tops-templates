import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import { MODEL_BADGES, availableFilters, buildModelSections, formatContextLength, modelGroup, modelRows, showsInherit, stepRow } from './model-picker.js';

export { formatContextLength, developerName, modelGroup, buildModelSections, filterModels } from './model-picker.js';

const PAGE = 200; // options rendered in "All" before "Show more" (keeps 400+ models fast without virtualisation)
const SECTION_LABELS = { recent: 'Recent', recommended: 'Recommended', all: 'All models' };
const BADGE_LABELS = { tools: 'Tools', vision: 'Vision', audio: 'Audio', reasoning: 'Reasoning', free: 'Free' };
const FILTER_LABELS = { tools: 'Uses tools', vision: 'Sees images', audio: 'Hears audio', free: 'Free models' };
const POPOVER_HEIGHT = 420, GAP = 4, NONE = [];

const priceText = (price, t) => [price?.input && t('In {price}', { price: price.input }), price?.output && t('Out {price}', { price: price.output })].filter(Boolean).join(' · ');

// ModelPicker — a model choice for settings rows and the chat composer.
// value: string | null (null — the inherit row); options: ModelOption[] (see model-picker.js); onChange(id | null);
// recentIds?, recommendedIds? — ids kept by the product; inherit?: { label, detail? } — the row with value null;
// placeholder?, disabled?, compact? (trigger shows only the name — composer toolbar), label? (accessible name, default "Model"),
// portalContainer? — render the popover there with fixed positioning (hosts whose ancestors clip overflow); inline otherwise.
// Keyboard: the search field keeps focus, ↑↓ move through the options (role="listbox", aria-activedescendant,
// aria-selected on the active one), Enter picks, Escape closes and returns focus to the trigger. A disabledReason row is
// reachable but not selectable and shows its reason.
export default function ModelPicker({ value = null, options = NONE, onChange, recentIds = NONE, recommendedIds = NONE, inherit, placeholder, disabled = false, compact = false, label, portalContainer, className = '' }) {
  const t = useStudioText(), id = useId(), listId = `${id}-list`;
  const root = useRef(null), trigger = useRef(null), popup = useRef(null), list = useRef(null), search = useRef(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [filters, setFilters] = useState([]), [limit, setLimit] = useState(PAGE);
  const [active, setActive] = useState(-1), [position, setPosition] = useState(null);
  const name = label || t('Model');
  const current = value == null ? null : options.find(option => option.id === value);

  const chips = useMemo(() => availableFilters(options), [options]);
  const view = useMemo(() => open ? buildModelSections(options, { query, filters, recentIds, recommendedIds, limit }) : { sections: [], total: 0, hidden: 0 },
    [open, options, query, filters, recentIds, recommendedIds, limit]);
  const inheritShown = open && showsInherit(inherit, query);
  const rows = useMemo(() => modelRows(view.sections, inheritShown), [view, inheritShown]);
  const optionId = index => `${id}-option-${index}`;

  // Active row: the current value when the list (re)builds, otherwise the first row.
  useEffect(() => {
    if (!open) return;
    const at = rows.findIndex(row => (row.option ? row.option.id === value : value == null && row.key === 'inherit'));
    setActive(query || filters.length ? (rows.length ? 0 : -1) : at >= 0 ? at : rows.length ? 0 : -1);
  }, [open, query, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Placement: below the trigger, or above when there is more room there (the chat composer sits at the bottom).
  useLayoutEffect(() => {
    if (!open || !trigger.current) return undefined;
    const win = trigger.current.ownerDocument.defaultView;
    const measure = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const below = win.innerHeight - rect.bottom, above = rect.top;
      const up = below < POPOVER_HEIGHT && above > below;
      const width = Math.min(26 * 16, win.innerWidth - 16);
      const end = rect.left + width > win.innerWidth - 8;
      setPosition({ up, end, maxHeight: Math.max(160, Math.min(POPOVER_HEIGHT, (up ? above : below) - 16)), rect, width, viewportWidth: win.innerWidth, viewportHeight: win.innerHeight });
    };
    measure();
    win.addEventListener('resize', measure);
    win.addEventListener('scroll', measure, true);
    return () => { win.removeEventListener('resize', measure); win.removeEventListener('scroll', measure, true); };
  }, [open]);

  // Focus the search only once the popover is placed, and without scrolling: autoFocus on mount scrolled the
  // chat column towards a popover that had not been positioned yet.
  useEffect(() => { if (open && position) search.current?.focus({ preventScroll: true }); }, [open, Boolean(position)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the active option visible inside the list without scrolling the page.
  useLayoutEffect(() => {
    const element = list.current, option = element?.querySelector('[aria-selected="true"]');
    if (!option) return;
    if (option.offsetTop < element.scrollTop) element.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > element.scrollTop + element.clientHeight) element.scrollTop = option.offsetTop + option.offsetHeight - element.clientHeight;
  });

  useEffect(() => {
    if (!open) return undefined;
    const document = root.current.ownerDocument;
    const dismiss = event => { const path = event.composedPath(); if (!path.includes(root.current) && !path.includes(popup.current)) close(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function show() { if (disabled) return; setQuery(''); setLimit(PAGE); setOpen(true); }
  function close(restore = true) { setOpen(false); setPosition(null); if (restore) trigger.current?.focus(); }
  function select(row) {
    if (!row || row.disabled) return;
    onChange?.(row.option ? row.option.id : null);
    close();
  }
  function keyDown(event) {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setActive(index => stepRow(rows, index, event.key === 'ArrowDown' ? 1 : -1)); return; }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); select(rows[active]); }
  }
  // Focus leaving the picker (trigger and popover; React bubbles portal events to the root) closes it.
  // Checked after the event: focus moving into a portal popover lands before its ref is attached.
  function blur(event) {
    if (!open || !event.relatedTarget) return;
    setTimeout(() => {
      const focused = root.current?.getRootNode().activeElement ?? root.current?.ownerDocument.activeElement;
      if (focused && focused !== root.current?.ownerDocument.body && !root.current?.contains(focused) && !popup.current?.contains(focused)) close(false);
    }, 0);
  }
  const toggleFilter = filter => setFilters(list => (list.includes(filter) ? list.filter(item => item !== filter) : [...list, filter]));

  const triggerName = current?.name ?? (value == null ? inherit?.label : value) ?? placeholder ?? t('Choose a model');
  const triggerDetail = compact ? '' : current ? [current.provider || modelGroup(current), priceText(current.price, t)].filter(Boolean).join(' · ') : value == null ? inherit?.detail : '';

  let index = -1;
  const renderRow = (row, content) => {
    index += 1;
    const position = index, selected = position === active;
    const isCurrent = row.option ? row.option.id === value : value == null;
    return <div key={row.key} id={optionId(position)} role="option" aria-selected={selected} aria-disabled={row.disabled || undefined} data-current={isCurrent || undefined}
      className="studio-model-option" onMouseDown={event => event.preventDefault()} onMouseMove={() => { if (!selected) setActive(position); }} onClick={() => select(row)}>
      {content}
      {isCurrent && <Check size={14} aria-hidden="true" className="studio-model-option-check" />}
    </div>;
  };
  const optionContent = option => {
    const context = formatContextLength(option.contextLength), price = priceText(option.price, t);
    return <span className="studio-model-option-body" title={option.description || undefined}>
      <span className="studio-model-option-head">
        <span className="studio-model-option-name">{option.name}</span>
        {option.badges?.length > 0 && <span className="studio-model-badges">{MODEL_BADGES.filter(badge => option.badges.includes(badge)).map(badge => <span key={badge} className={`studio-model-badge studio-model-badge-${badge}`}>{t(BADGE_LABELS[badge])}</span>)}</span>}
      </span>
      <span className="studio-model-option-meta">
        <span className="studio-model-option-id">{option.id}</span>
        {context && <span>{t('{value} context', { value: context })}</span>}
        {price && <span>{price}{option.price?.unit ? ` ${option.price.unit}` : ''}</span>}
      </span>
      {option.disabledReason && <span className="studio-model-option-reason">{option.disabledReason}</span>}
    </span>;
  };

  const style = position && (portalContainer
    ? { position: 'fixed', width: position.width, maxHeight: position.maxHeight, left: Math.max(8, Math.min(position.rect.left, position.viewportWidth - position.width - 8)),
      ...(position.up ? { bottom: position.viewportHeight - position.rect.top + GAP } : { top: position.rect.bottom + GAP }) }
    : { maxHeight: position.maxHeight });
  const popover = open && <div ref={popup} className="studio-popover studio-model-popover" data-placement={position?.up ? 'top' : 'bottom'} data-align={position?.end ? 'end' : 'start'}
    data-portal={portalContainer ? '' : undefined} style={style ?? undefined} onKeyDown={keyDown}>
    <div className="studio-model-search">
      <Search size={14} aria-hidden="true" />
      <input ref={search} type="search" value={query} placeholder={t('Search models')} aria-label={t('Search models')}
        role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={rows[active] ? optionId(active) : undefined}
        onChange={event => { setQuery(event.target.value); setLimit(PAGE); }} />
    </div>
    {chips.length > 0 && <div role="group" aria-label={t('Model filters')} className="studio-model-filters">
      {chips.map(filter => <button key={filter} type="button" className="studio-model-filter" aria-pressed={filters.includes(filter)} onClick={() => { toggleFilter(filter); setLimit(PAGE); }}>{t(FILTER_LABELS[filter])}</button>)}
    </div>}
    {rows.length > 0 ? <div ref={list} id={listId} role="listbox" aria-label={name} className="studio-model-list">
      {inheritShown && renderRow(rows[0], <span className="studio-model-option-body">
        <span className="studio-model-option-head"><span className="studio-model-option-name">{inherit.label}</span></span>
        {inherit.detail && <span className="studio-model-option-meta"><span>{inherit.detail}</span></span>}
      </span>)}
      {view.sections.map(section => <div key={section.key} role="group" aria-label={t(SECTION_LABELS[section.key])} className="studio-model-section">
        <div className="studio-model-heading" aria-hidden="true">{t(SECTION_LABELS[section.key])}</div>
        {section.groups.map(group => section.key === 'all'
          ? <div key={group.label} role="group" aria-label={group.label} className="studio-model-group">
            <div className="studio-model-subheading" aria-hidden="true">{group.label}</div>
            {group.items.map(option => renderRow({ key: `${section.key}:${option.id}`, option, disabled: Boolean(option.disabledReason) }, optionContent(option)))}
          </div>
          : group.items.map(option => renderRow({ key: `${section.key}:${option.id}`, option, disabled: Boolean(option.disabledReason) }, optionContent(option))))}
      </div>)}
    </div> : <p role="status" className="studio-model-empty">{t('No models match')}</p>}
    {view.hidden > 0 && <button type="button" className="studio-model-more" onClick={() => setLimit(value => value + PAGE)}>{t('Show {count} more', { count: Math.min(PAGE, view.hidden) })}</button>}
  </div>;

  return <div ref={root} className={`studio-model-picker${compact ? ' studio-model-picker-compact' : ''} ${className}`.trim()} onBlur={blur}>
    <button ref={trigger} type="button" className="studio-model-trigger" disabled={disabled} aria-label={`${name}: ${triggerName}`} title={compact ? triggerName : undefined}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      onClick={() => (open ? close() : show())}
      onKeyDown={event => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); show(); } }}>
      <span className="studio-model-trigger-text">
        <span className="studio-model-trigger-name">{triggerName}</span>
        {triggerDetail && <span className="studio-model-trigger-detail">{triggerDetail}</span>}
      </span>
      <ChevronDown size={14} aria-hidden="true" className="studio-model-trigger-icon" />
    </button>
    {popover && (portalContainer ? createPortal(popover, portalContainer) : popover)}
  </div>;
}
