import messages from './studio-translations.json' with { type: 'json' };
export const interpolate = (text, values = {}) => text.replace(/\{([A-Za-z]+)\}/g, (match, key) => values[key] ?? match);
export function translateStudio(text, language = 'en', values = {}) {
  const index = language === 'ru' ? 0 : language === 'uk' ? 1 : -1;
  return interpolate(index < 0 ? text : messages[text]?.[index] ?? text, values);
}
