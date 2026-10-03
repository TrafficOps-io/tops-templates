// Capture before React (and before the lazy workspace) mounts. An install event is single-use.
let prompt = null;
const listeners = new Set();
const publish = value => { prompt = value; listeners.forEach(listener => listener()); };
export const getInstallPrompt = () => prompt;
export const subscribeInstall = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export function captureInstall(environment = window) {
  const available = event => { event.preventDefault(); publish(event); };
  const installed = () => publish(null);
  environment.addEventListener('beforeinstallprompt', available);
  environment.addEventListener('appinstalled', installed);
  return () => {
    environment.removeEventListener('beforeinstallprompt', available);
    environment.removeEventListener('appinstalled', installed);
  };
}

export async function installStudio() {
  const event = prompt;
  if (!event) return null;
  publish(null);
  // Call synchronously from the click to preserve transient user activation.
  const result = await event.prompt();
  return event.userChoice ? await event.userChoice : result;
}
