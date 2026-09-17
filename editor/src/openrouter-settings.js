import { DEFAULT_OPENROUTER_MODEL } from './openrouter-ai.js';

const DATABASE = 'trafficops-template-studio-ai';
const VERSION = 1;
const STORE = 'settings';
const SETTINGS_ID = 'openrouter';

export function normalizeOpenRouterSettings(value = {}) {
  return {
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
    model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : DEFAULT_OPENROUTER_MODEL,
    imageModel: typeof value.imageModel === 'string' ? value.imageModel.trim() : '',
  };
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadOpenRouterSettings() {
  const database = await openDatabase();
  if (!database) return normalizeOpenRouterSettings();
  try {
    const record = await requestResult(database.transaction(STORE, 'readonly').objectStore(STORE).get(SETTINGS_ID));
    return normalizeOpenRouterSettings(record);
  } finally { database.close(); }
}

export async function saveOpenRouterSettings(value) {
  const settings = normalizeOpenRouterSettings(value);
  if (!settings.apiKey) throw new Error('Enter an OpenRouter API key.');
  const database = await openDatabase();
  if (!database) throw new Error('Local browser storage is unavailable.');
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    await requestResult(transaction.objectStore(STORE).put({ id: SETTINGS_ID, ...settings }));
    globalThis.window?.dispatchEvent(new Event('trafficops-ai-settings'));
    return settings;
  } finally { database.close(); }
}

export async function clearOpenRouterSettings() {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    await requestResult(transaction.objectStore(STORE).delete(SETTINGS_ID));
    globalThis.window?.dispatchEvent(new Event('trafficops-ai-settings'));
  } finally { database.close(); }
}
