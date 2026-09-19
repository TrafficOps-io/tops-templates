import { ChevronDown, Globe2, Plus, Star, Trash2 } from 'lucide-react';
import Menu from './Menu.jsx';
import { useStudioText } from './studio-i18n.js';
import { localeActions } from './locale-actions.js';
export default function LocaleMenu({ locales, value, defaultLocale, issues = {}, disabled, onSelect, onAdd, onMakeDefault, onRemove }) {
  const t = useStudioText(), actions = localeActions({ locales, value, defaultLocale, disabled });
  return <Menu className="locale-menu" label={t('Manage languages')} triggerClassName="locale-menu-trigger" trigger={<><Globe2 size={14} /><span data-active-locale={value}>{value.toUpperCase()}</span><ChevronDown size={12} /></>}>
    {({ close }) => <>{locales.map(locale => <button key={locale} role="menuitem" type="button" aria-current={locale === value ? 'true' : undefined} onClick={() => { onSelect(locale); close(); }}><span>{locale.toUpperCase()}</span>{locale === defaultLocale && <Star size={12} aria-label={t('Default language')} />}{issues[locale] > 0 && <span className="locale-issues">{issues[locale]}</span>}</button>)}<hr />
      <button role="menuitem" type="button" disabled={!actions.canAdd} onClick={() => { close(); onAdd(); }}><Plus size={13} />{t('Add language')}</button>
      {actions.showMakeDefault && <button role="menuitem" type="button" disabled={!actions.canMutate} onClick={() => { close(); onMakeDefault(); }}><Star size={13} />{t('Make default')}</button>}
      {actions.showRemove && <button role="menuitem" type="button" disabled={!actions.canMutate} onClick={() => { close(); onRemove(); }}><Trash2 size={13} />{t('Remove language')}</button>}
    </>}
  </Menu>;
}
