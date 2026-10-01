import { useId, useRef } from 'react';
// items: [{ id, label, icon?, badge?, disabled? }]; value: id; onChange(id)
// id задаётся потребителем, когда панели нужно сослаться на вкладку через tabPanelProps(id, itemId)
export default function Tabs({ id: providedId, items, value, onChange, label, variant = 'tabs', className = '' }) {
  const generated = useId(), id = providedId ?? generated, refs = useRef(new Map());
  const enabled = items.filter(item => !item.disabled);
  // roving tab stop: the selected enabled tab, otherwise the first enabled one
  const focusable = enabled.some(item => item.id === value) ? value : enabled[0]?.id;
  function keyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !enabled.length) return;
    event.preventDefault();
    const index = enabled.findIndex(item => item.id === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : index < 0 ? (event.key === 'ArrowRight' ? 0 : enabled.length - 1) : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    onChange(enabled[next].id); refs.current.get(enabled[next].id)?.focus();
  }
  return <div role="tablist" aria-label={label} className={`studio-tabs studio-tabs-${variant} ${className}`} onKeyDown={keyDown}>
    {items.map(item => { const Icon = item.icon, selected = item.id === value; return <button key={item.id} ref={node => refs.current.set(item.id, node)} type="button" role="tab" id={`${id}-${item.id}`} aria-selected={selected} aria-controls={`${id}-${item.id}-panel`} tabIndex={item.id === focusable ? 0 : -1} disabled={item.disabled} className="studio-tab" onClick={() => onChange(item.id)}>
      {Icon && <Icon size={14} aria-hidden="true" />}<span>{item.label}</span>{item.badge != null && <span className="studio-tab-badge">{item.badge}</span>}
    </button>; })}
  </div>;
}
export function Segmented(props) { return <Tabs variant="segmented" {...props} />; }
export function tabPanelProps(tablistId, itemId) { return { role: 'tabpanel', id: `${tablistId}-${itemId}-panel`, 'aria-labelledby': `${tablistId}-${itemId}` }; }
