export function localeActions({ locales, value, defaultLocale, disabled }) {
  return { canAdd: !disabled && locales.length < 10, showMakeDefault: value !== defaultLocale, showRemove: value !== defaultLocale, canMutate: !disabled };
}
