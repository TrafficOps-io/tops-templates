export const THEME_KEY = 'studio-theme';
export const THEMES = ['system', 'light', 'dark'];
const names = { light: 'studio-light', dark: 'studio-dark' };
const environment = () => ({ document: globalThis.document, localStorage: globalThis.localStorage });

export function readTheme(env = environment()) {
  try { const value = env.localStorage?.getItem(THEME_KEY); return THEMES.includes(value) ? value : 'system'; } catch { return 'system'; }
}
export function applyTheme(theme, env = environment()) {
  const root = env.document?.documentElement; if (!root) return;
  if (theme === 'system') { root.removeAttribute('data-theme'); try { env.localStorage?.removeItem(THEME_KEY); } catch { /* storage optional */ } return; }
  root.setAttribute('data-theme', names[theme]);
  try { env.localStorage?.setItem(THEME_KEY, theme); } catch { /* storage optional */ }
}
