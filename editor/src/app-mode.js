export function installedDisplayMode(environment = globalThis.window) {
  return Boolean(environment && (environment.matchMedia?.('(display-mode: standalone)').matches
    || environment.matchMedia?.('(display-mode: fullscreen)').matches
    || environment.matchMedia?.('(display-mode: minimal-ui)').matches
    || environment.navigator?.standalone === true));
}

export function watchDisplayMode(callback, environment = window) {
  const queries = ['standalone', 'fullscreen', 'minimal-ui'].map(mode => environment.matchMedia(`(display-mode: ${mode})`));
  const update = () => callback(installedDisplayMode(environment));
  queries.forEach(query => query.addEventListener('change', update));
  environment.addEventListener('appinstalled', update);
  return () => {
    queries.forEach(query => query.removeEventListener('change', update));
    environment.removeEventListener('appinstalled', update);
  };
}
