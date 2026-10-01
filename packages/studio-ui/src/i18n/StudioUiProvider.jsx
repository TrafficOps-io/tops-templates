import { createContext, useContext } from 'react';
import { translateStudio, interpolate } from './translation.js';

// language, messages (словарь-перекрытие по исходной строке), portalContainer (для слоёв в shadow root)
export const StudioUiContext = createContext(null);
export function StudioUiProvider({ language = 'en', messages, portalContainer, children }) {
  return <StudioUiContext.Provider value={{ language, messages, portalContainer }}>{children}</StudioUiContext.Provider>;
}
export const useStudioUi = () => useContext(StudioUiContext);
export function useStudioText() {
  const context = useStudioUi();
  return (text, values = {}) => interpolate(context?.messages?.[text] ?? translateStudio(text, context?.language), values);
}
export function usePortalContainer() { return useStudioUi()?.portalContainer ?? null; }
