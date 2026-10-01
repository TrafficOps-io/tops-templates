import { useStudioHost } from './host-context.js';
import { translateStudio, interpolate } from '@trafficops/studio-ui/i18n/translation';
export { translateStudio };
// Хост shell ещё не оборачивается в StudioUiProvider; язык и перекрытие берутся из порта хоста.
// Импорт из подпути без JSX: node --test в shell не загружает StudioUiProvider.jsx.
export function useStudioText() {
  const host = useStudioHost();
  return (text, values = {}) => interpolate(host?.messages?.[text] ?? translateStudio(text, host?.language), values);
}
