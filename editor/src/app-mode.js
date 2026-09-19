const confirmedAppWindows = new WeakSet();

export function installedDisplayMode(environment = globalThis.window) {
  if (!environment) return false;
  const matches = mode => Boolean(environment.matchMedia?.(`(display-mode: ${mode})`)?.matches);
  if (matches('standalone') || matches('minimal-ui') || environment.navigator?.standalone === true) {
    confirmedAppWindows.add(environment);
    return true;
  }
  if (matches('browser')) {
    confirmedAppWindows.delete(environment);
    return false;
  }
  // Fullscreen can continue a confirmed app session, but cannot establish one.
  if (matches('fullscreen')) return confirmedAppWindows.has(environment);
  confirmedAppWindows.delete(environment);
  return false;
}

export function watchDisplayMode(callback, environment = window) {
  installedDisplayMode(environment);
  const queries = ['standalone', 'minimal-ui', 'fullscreen', 'browser'].map(mode => environment.matchMedia(`(display-mode: ${mode})`));
  const update = () => callback(installedDisplayMode(environment));
  queries.forEach(query => query.addEventListener('change', update));
  environment.addEventListener('appinstalled', update);
  return () => {
    queries.forEach(query => query.removeEventListener('change', update));
    environment.removeEventListener('appinstalled', update);
  };
}
