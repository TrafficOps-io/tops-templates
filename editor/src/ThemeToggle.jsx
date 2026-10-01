import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme, THEMES } from './theme.js';
import { useStudioText } from '@trafficops/template-editor-shell/studio-i18n';

const icons = { system: Monitor, light: Sun, dark: Moon };
const labels = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
export default function ThemeToggle() {
  const t = useStudioText(), [theme, setTheme] = useState(readTheme);
  return <div className="theme-toggle" role="radiogroup" aria-label={t('Theme')}>
    {THEMES.map(value => { const Icon = icons[value]; return <button key={value} type="button" role="radio" aria-checked={theme === value} aria-label={t(labels[value])} title={t(labels[value])} className="btn btn-ghost btn-sm" onClick={() => { applyTheme(value); setTheme(value); }}><Icon size={16} aria-hidden="true" /></button>; })}
  </div>;
}
