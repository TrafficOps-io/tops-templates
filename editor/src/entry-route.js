import { installedDisplayMode } from './app-mode.js';

// Keep the existing manifest start URL and bookmarked settings page working.
// A normal visit stays a website even when this origin has local projects.
export function isStudioEntry(environment = globalThis.window) {
  if (!environment) return false;
  return installedDisplayMode(environment)
    || new URLSearchParams(environment.location.search).get('studio') === '1'
    || environment.location.hash === '#settings';
}
