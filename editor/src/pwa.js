const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 60 * 1000;
const listeners = new Set();
let state = { offlineReady: false, update: null, error: null };
let activeLifecycle;

export function getPwaState() { return state; }

// Replay readiness to React even when registration finished before it mounted.
export function subscribePwa(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function registerPwa({
  windowImpl = globalThis.window,
  loadRegister = () => import('virtual:pwa-register').then(module => module.registerSW),
  now = Date.now,
} = {}) {
  if (activeLifecycle) return activeLifecycle;
  let disposed = false, registration, timer, checkInFlight, activationInFlight;
  let lastCheck = -Infinity, activationRequested = false, workerActivated = false;
  let updateWorker;
  const document = windowImpl?.document;
  const publish = patch => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const emit = (name, detail) => {
    if (!disposed) windowImpl?.dispatchEvent(new windowImpl.CustomEvent(name, { detail }));
  };
  const reportError = (cause, operation) => {
    const error = { operation, message: cause instanceof Error ? cause.message : String(cause) };
    publish({ error });
    emit('trafficops-pwa-error', { error });
  };
  const offlineReady = () => {
    publish({ offlineReady: true });
    emit('trafficops-pwa-offline-ready');
  };
  const applyUpdate = () => {
    if (disposed) return Promise.reject(new Error('Studio update registration has stopped.'));
    if (activationInFlight) return activationInFlight;
    activationInFlight = Promise.resolve().then(async () => {
      activationRequested = true;
      if (workerActivated) windowImpl.location.reload();
      else await updateWorker(true);
    }).catch(cause => {
      activationRequested = false;
      reportError(cause, 'update');
      throw cause;
    }).finally(() => { activationInFlight = null; });
    return activationInFlight;
  };
  const updateReady = () => {
    publish({ update: applyUpdate, error: null });
    emit('trafficops-pwa-update', { update: applyUpdate });
  };
  async function checkForUpdate() {
    if (disposed || !registration || windowImpl.navigator.onLine === false || document?.visibilityState === 'hidden') return false;
    if (checkInFlight) return checkInFlight;
    if (now() - lastCheck < MIN_CHECK_INTERVAL_MS) return false;
    lastCheck = now();
    checkInFlight = Promise.resolve().then(() => registration.update()).then(() => {
      if (state.error?.operation === 'check') publish({ error: null });
      return true;
    }).catch(cause => { reportError(cause, 'check'); return false; }).finally(() => { checkInFlight = null; });
    return checkInFlight;
  }
  const lifecycle = {
    ready: null,
    checkForUpdate,
    dispose() {
      disposed = true;
      if (timer !== undefined) windowImpl.clearInterval(timer);
      windowImpl?.removeEventListener('online', checkForUpdate);
      windowImpl?.removeEventListener('focus', checkForUpdate);
      document?.removeEventListener('visibilitychange', checkForUpdate);
      if (activeLifecycle === lifecycle) activeLifecycle = undefined;
    },
  };
  activeLifecycle = lifecycle;
  publish({ offlineReady: false, update: null, error: null });
  if (!windowImpl || !('serviceWorker' in windowImpl.navigator)) {
    lifecycle.ready = Promise.resolve();
    return lifecycle;
  }
  lifecycle.ready = Promise.resolve().then(loadRegister).then(registerSW => {
    if (disposed) return;
    updateWorker = registerSW({
      immediate: true,
      onNeedRefresh: updateReady,
      onOfflineReady: offlineReady,
      onNeedReload() {
        if (disposed) return;
        workerActivated = true;
        // Updating another window must never reload this one's unsaved work.
        if (activationRequested) windowImpl.location.reload();
        else updateReady();
      },
      onRegisteredSW(_url, value) {
        if (disposed || !value) return;
        registration = value;
        lastCheck = now(); // Registration itself already checks for an update.
        if (value.active) offlineReady();
        if (timer !== undefined) windowImpl.clearInterval(timer);
        timer = windowImpl.setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
        windowImpl.addEventListener('online', checkForUpdate);
        windowImpl.addEventListener('focus', checkForUpdate);
        document?.addEventListener('visibilitychange', checkForUpdate);
      },
      onRegisterError: cause => reportError(cause, 'register'),
    });
  }).catch(cause => reportError(cause, 'register'));
  return lifecycle;
}
