import { useId, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';

export default function PathInput({ value, onChange, folders, label, placeholder }) {
  const id = useId();
  const input = useRef(null);
  const [open, setOpen] = useState(true);
  const [highlighted, setHighlighted] = useState(null);
  const prefix = value.toLowerCase();
  const suggestions = folders.map(folder => `${folder}/`).filter(path => path.toLowerCase().startsWith(prefix) && path !== value);
  const expanded = open && suggestions.length > 0;
  const activeIndex = expanded ? suggestions.indexOf(highlighted) : -1;

  function choose(path) {
    onChange(path);
    setHighlighted(null);
    setOpen(true);
    input.current.focus();
  }

  function keyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      const index = event.key === 'ArrowDown'
        ? (activeIndex + 1) % suggestions.length
        : (activeIndex <= 0 ? suggestions.length : activeIndex) - 1;
      setHighlighted(suggestions[index]);
      requestAnimationFrame(() => document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' }));
    } else if (expanded && ((event.key === 'Enter' && activeIndex >= 0) || (event.key === 'Tab' && !event.shiftKey))) {
      event.preventDefault();
      choose(suggestions[Math.max(0, activeIndex)]);
    } else if (expanded && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setHighlighted(null);
    }
  }

  return <div className="field path-field">
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} autoFocus className="input input-bordered w-full" value={value}
      onChange={event => { onChange(event.target.value); setHighlighted(null); setOpen(true); }}
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setHighlighted(null); }} onKeyDown={keyDown}
      placeholder={placeholder} required autoComplete="off" autoCapitalize="none" spellCheck={false}
      role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-options` : undefined}
      aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
      aria-describedby={`${id}-help`} />
    {expanded && <div className="path-suggestions">
      <div className="path-suggestions-heading">Existing folders</div>
      <div id={`${id}-options`} role="listbox" aria-label="Existing project folders" className="path-suggestions-list">
        {suggestions.map((path, index) => <div key={path} id={`${id}-option-${index}`} role="option"
          aria-selected={index === activeIndex} className="path-suggestion" title={path}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(path)}>
          <FolderOpen size={15} aria-hidden="true" /><span>{path}</span>
        </div>)}
      </div>
    </div>}
    <p id={`${id}-help`} className="field-help">{expanded ? '↑ ↓ to choose · Tab to complete · Esc to hide. ' : ''}Choose an existing folder or type a new relative path.</p>
  </div>;
}
