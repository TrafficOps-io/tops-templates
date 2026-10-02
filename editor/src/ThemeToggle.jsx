import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Menu } from '@trafficops/studio-ui/primitives';
import { applyTheme, readTheme, THEMES } from './theme.js';
import { useStudioText } from '@trafficops/template-editor-shell/studio-i18n';

const icons = { system: Monitor, light: Sun, dark: Moon };
const labels = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

// The editor More menu and library Theme menu share the same labelled choices.
export function ThemeMenuItems({ close, onChange }) {
  const t = useStudioText(), [theme, setTheme] = useState(readTheme);
  return THEMES.map(value => { const Icon = icons[value]; return <button key={value} type="button" role="menuitemradio" aria-checked={theme === value} aria-label={t(labels[value])} onClick={() => { applyTheme(value); setTheme(value); onChange?.(value); close?.(); }}><Icon size={15} aria-hidden="true" /><span>{t(labels[value])}</span></button>; });
}

export default function ThemeToggle() {
  const t = useStudioText(), [theme, setTheme] = useState(readTheme), Icon = icons[theme];
  return <Menu label={t('Theme')} className="theme-toggle" triggerClassName="btn btn-ghost btn-sm" trigger={<><Icon size={16} aria-hidden="true" /><span className="theme-toggle-label">{t('Theme')}</span></>}>
    {({ close }) => <ThemeMenuItems close={close} onChange={setTheme} />}
  </Menu>;
}
