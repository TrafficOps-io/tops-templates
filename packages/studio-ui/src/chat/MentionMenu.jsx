import { useLayoutEffect, useRef, useState } from 'react';
import { AtSign, FileText, Image as ImageIcon, Layers, Music, Clapperboard } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import { MENTION_GROUP_LABELS, mentionKey } from './mentions.js';

const ICONS = { section: Layers, scene: Clapperboard, track: Music, file: FileText, asset: ImageIcon, field: AtSign };

export const optionId = (id, index) => `${id}-mention-${index}`;

// Popover frame above the composer inside the chat panel (no portal). The composer renders the role="listbox"
// element through children(listRef) and keeps the keyboard (aria-activedescendant on its input points at optionId(id, active)).
// The frame measures the free space up to the .studio-chat top and keeps the active option visible without scrolling the page.
// anchor — ref to the composer root; active — index of the active option (scroll follow-up).
export default function MentionMenu({ anchor, active, children }) {
  const list = useRef(null), [space, setSpace] = useState(null);
  useLayoutEffect(() => {
    const composer = anchor?.current;
    if (!composer) return undefined;
    const panel = composer.closest('.studio-chat');
    const measure = () => setSpace(Math.max(0, composer.getBoundingClientRect().top - Math.max(0, panel?.getBoundingClientRect().top ?? 0) - 8));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(composer); if (panel) observer?.observe(panel);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [anchor]);
  useLayoutEffect(() => {
    const element = list.current, option = element?.querySelector('[aria-selected="true"]');
    if (!option) return;
    if (option.offsetTop < element.scrollTop) element.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > element.scrollTop + element.clientHeight) element.scrollTop = option.offsetTop + option.offsetHeight - element.clientHeight;
  });
  return <div className="studio-mention-menu" style={space === null ? undefined : { '--studio-mention-space': `${space}px` }}>{children(list)}</div>;
}

// Options of the listbox: role="group" per kind (aria-label Sections, Scenes, …), role="option" items numbered across groups.
export function MentionOptions({ id, groups, active, onSelect, onHover }) {
  const t = useStudioText();
  if (!groups.length) return <p role="status" className="studio-mention-menu-empty">{t('No matching references')}</p>;
  let index = -1;
  return groups.map(group => <div key={group.kind} role="group" aria-label={t(MENTION_GROUP_LABELS[group.kind])} className="studio-mention-menu-group">
    <div className="studio-mention-menu-heading" aria-hidden="true">{t(MENTION_GROUP_LABELS[group.kind])}</div>
    {group.items.map(target => {
      index += 1;
      const position = index, Icon = ICONS[target.kind] ?? AtSign;
      return <div key={mentionKey(target)} id={optionId(id, position)} role="option" aria-selected={position === active} className="studio-mention-menu-option"
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover?.(position)} onClick={() => onSelect(target)}>
        <Icon size={14} aria-hidden="true" className="studio-mention-menu-icon" />
        <span className="studio-mention-menu-label">{target.label}</span>
        {target.detail && <span className="studio-mention-menu-detail">{target.detail}</span>}
      </div>;
    })}
  </div>);
}
