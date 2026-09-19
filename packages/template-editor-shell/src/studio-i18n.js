import { useStudioHost } from './host-context.js';
import { translateStudio } from './translation.js';
export { translateStudio } from './translation.js';
export function useStudioText() {
  const host = useStudioHost();
  return (text, values = {}) => {
    const translated = host?.messages?.[text] ?? translateStudio(text, host?.language);
    return translated.replace(/\{([A-Za-z]+)\}/g, (match, key) => values[key] ?? match);
  };
}
