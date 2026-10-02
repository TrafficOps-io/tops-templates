import tokens from '@trafficops/studio-tokens/tokens.json' with { type: 'json' };

export const THEME_KEY = 'studio-theme';
export const THEMES = ['system', 'light', 'dark'];
const names = { light: 'studio-light', dark: 'studio-dark' };
const environment = () => ({ document: globalThis.document, localStorage: globalThis.localStorage });
// The browser paints the title bar (and the window-controls overlay) with theme-color: it follows the toolbar surface.
const surfaces = { light: tokens.themes['studio-light'].surface, dark: tokens.themes['studio-dark'].surface };
function syncThemeColor(theme, env) {
  for (const meta of env.document?.querySelectorAll?.('meta[name="theme-color"]') || []) {
    const scheme = meta.media?.includes('dark') ? 'dark' : 'light';
    meta.content = surfaces[theme === 'system' ? scheme : theme];
  }
}

export function readTheme(env = environment()) {
  try { const value = env.localStorage?.getItem(THEME_KEY); return THEMES.includes(value) ? value : 'system'; } catch { return 'system'; }
}
export function applyTheme(theme, env = environment()) {
  const root = env.document?.documentElement; if (!root) return;
  syncThemeColor(theme, env);
  if (theme === 'system') { root.removeAttribute('data-theme'); try { env.localStorage?.removeItem(THEME_KEY); } catch { /* storage optional */ } return; }
  root.setAttribute('data-theme', names[theme]);
  try { env.localStorage?.setItem(THEME_KEY, theme); } catch { /* storage optional */ }
}
