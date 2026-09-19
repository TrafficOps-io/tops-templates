import messages from './studio-translations.json' with { type: 'json' };
export function translateStudio(text, language = 'en', values = {}) {
  const index = language === 'ru' ? 0 : language === 'uk' ? 1 : -1;
  const translated = index < 0 ? text : messages[text]?.[index] ?? text;
  return translated.replace(/\{([A-Za-z]+)\}/g, (match, key) => values[key] ?? match);
}
