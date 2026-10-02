// An explicit per-run choice takes precedence over the configured model.
export function resolveImageGeneration(choice, settings) {
  return typeof choice === 'boolean' ? choice : Boolean(settings?.imageModel?.trim());
}
