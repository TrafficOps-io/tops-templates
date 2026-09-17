import { registerSW } from 'virtual:pwa-register';

export function registerPwa() {
  let update = () => Promise.resolve();
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('trafficops-pwa-update', { detail: { update: () => update(true) } }));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('trafficops-pwa-offline-ready'));
    },
  });
}
