import language from '@trafficops/template-language';

export const TPL_PLAIN_LANGUAGE_ID = 'trafficops-tpl-plain';
export const TPL_LANGUAGE_IDS = Object.freeze(Object.fromEntries(Object.entries(language.DIALECT_PROFILES).map(([id, profile]) => [id, profile.php ? 'trafficops-tpl-trusted' : 'trafficops-tpl'])));

// Never call the legacy normalizer for unknown input: its fallback enables PHP.
export function dialectId(descriptor) {
  return descriptor?.schema === 1 && Object.hasOwn(TPL_LANGUAGE_IDS, descriptor.id) ? descriptor.id : null;
}
export function dialectProfile(descriptor) {
  const id = dialectId(descriptor);
  return id ? language.DIALECT_PROFILES[id] : null;
}
export function modelLanguage(path, descriptor, fallback = 'plaintext') {
  if (!/\.tpl(?:\.(?:html|php|txt))?$/i.test(path)) return fallback;
  const id = dialectId(descriptor);
  return id ? TPL_LANGUAGE_IDS[id] : TPL_PLAIN_LANGUAGE_ID;
}
export function templateFile(path, descriptor) {
  const profile = dialectProfile(descriptor);
  return Boolean(profile && (profile.php ? /\.tpl(?:\.(?:html|php|txt))?$/i : /\.tpl(?:\.html)?$/i).test(path));
}
