/** Optional editor extensions are explicit at each entry point. */
export function normalizeEditorCapabilities(value = {}) {
  const ai = value?.ai;
  return Object.freeze({
    ai: ai && typeof ai.Panel === 'function'
      ? Object.freeze({ Panel: ai.Panel, label: String(ai.label || 'Generate with AI'), requiresDefinition: ai.requiresDefinition !== false })
      : null,
  });
}
