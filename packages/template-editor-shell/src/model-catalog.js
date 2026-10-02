// Public OpenRouter model catalog for the ModelPicker of AiSettings (spec 2.4, 2.6).
// The catalog is fetched without credentials, at most once per session: a module-level promise plus a
// sessionStorage copy with a 10-minute TTL. Records are kept language-neutral; options are built per render.
import { localizedText } from './agent-steps.js';

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const AUTO_MODEL = 'openrouter/auto';
const CACHE_KEY = 'trafficops-openrouter-models', RECENT_KEY = 'trafficops-ai-recent-models', TTL_MS = 10 * 60 * 1000, RECENT_LIMIT = 5;
export const RECOMMENDED_MODELS = Object.freeze({
  text: [AUTO_MODEL, 'google/gemini-2.5-flash', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini'],
  image: ['google/gemini-2.5-flash-image', 'openai/gpt-5-image-mini'],
});

/** English source → [ru, uk] (the host translator wins when it knows a key). */
export const CATALOG_MESSAGES = Object.freeze({
  'Does not support tools — the agent cannot change the project': ['Не поддерживает инструменты — агент не сможет менять проект', 'Не підтримує інструменти — агент не зможе змінювати проєкт'],
  'OpenRouter picks a model for each request': ['OpenRouter выбирает модель для каждого запроса', 'OpenRouter обирає модель для кожного запиту'],
  'Not in the OpenRouter catalog': ['Нет в каталоге OpenRouter', 'Немає в каталозі OpenRouter'],
  'No image model': ['Без модели изображений', 'Без моделі зображень'],
  'Image generation is off': ['Генерация изображений выключена', 'Генерацію зображень вимкнено'],
  'Enter model ID': ['Ввести ID модели', 'Ввести ID моделі'],
  'Choose from catalog': ['Выбрать из каталога', 'Обрати з каталогу'],
  'Loading models…': ['Загружаю модели…', 'Завантажую моделі…'],
  'The OpenRouter model catalog is unavailable. Enter the model ID.': ['Каталог моделей OpenRouter недоступен. Введите ID модели.', 'Каталог моделей OpenRouter недоступний. Введіть ID моделі.'],
});
export const catalogText = (key, values = {}, options = {}) => localizedText(CATALOG_MESSAGES, key, values, options);

const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
/** OpenRouter /models entry → compact record; null for an entry without an id. */
export function compactModel(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) return null;
  const contextLength = [entry.context_length, entry.top_provider?.context_length].find(value => Number.isFinite(value) && value > 0);
  return { id: entry.id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.id, ...(contextLength ? { contextLength } : {}),
    prompt: entry.pricing?.prompt ?? null, completion: entry.pricing?.completion ?? null,
    input: strings(entry.architecture?.input_modalities), output: strings(entry.architecture?.output_modalities), parameters: strings(entry.supported_parameters) };
}

const perToken = value => { const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(number) && number >= 0 ? number : null; };
/** "$ per token" string → "$ per 1M tokens" text: '0.000003' → '$3', '0.00000015' → '$0.15'; unknown or negative → ''. */
export function pricePerMillion(value) {
  const price = perToken(value);
  return price === null ? '' : `$${Number((price * 1e6).toPrecision(3))}`;
}
// "Google: Gemini 2.5 Flash" → "Gemini 2.5 Flash": the developer is the group heading already.
const displayName = model => model.name.includes(': ') ? model.name.slice(model.name.indexOf(': ') + 2) : model.name;

/** Compact record → ModelOption of @trafficops/studio-ui ModelPicker. kind: 'text' | 'image'. */
export function modelOption(model, kind, options = {}) {
  const tools = model.parameters.includes('tools'), free = perToken(model.prompt) === 0 && perToken(model.completion) === 0;
  const badges = [tools && 'tools', model.input.includes('image') && 'vision', model.input.includes('audio') && 'audio',
    (model.parameters.includes('reasoning') || model.parameters.includes('include_reasoning')) && 'reasoning', free && 'free'].filter(Boolean);
  const input = pricePerMillion(model.prompt), output = pricePerMillion(model.completion);
  const auto = model.id === AUTO_MODEL;
  return { id: model.id, name: displayName(model), ...(model.contextLength ? { contextLength: model.contextLength } : {}),
    ...(!auto && (input || output) ? { price: { ...(input ? { input } : {}), ...(output ? { output } : {}), unit: '/ 1M' } } : {}),
    ...(auto ? { group: 'OpenRouter', description: catalogText('OpenRouter picks a model for each request', {}, options) } : {}),
    ...(badges.length ? { badges } : {}),
    ...(kind === 'text' && !tools && !auto ? { disabledReason: catalogText('Does not support tools — the agent cannot change the project', {}, options) } : {}) };
}

/**
 * Options of one picker: text — models that answer with text (plus openrouter/auto), image — models that output images.
 * current — the saved id: kept visible even when the catalog does not list it.
 */
export function catalogOptions(models, kind, { current = '', ...options } = {}) {
  const fits = model => kind === 'image' ? model.output.includes('image') : model.output.includes('text') || model.id === AUTO_MODEL;
  const list = (models || []).filter(fits).map(model => modelOption(model, kind, options));
  if (kind === 'text' && !list.some(option => option.id === AUTO_MODEL)) list.unshift(modelOption({ id: AUTO_MODEL, name: 'Auto Router', input: [], output: ['text'], parameters: [] }, kind, options));
  if (current && !list.some(option => option.id === current)) list.unshift({ id: current, name: current, description: catalogText('Not in the OpenRouter catalog', {}, options) });
  return list;
}

let pending = null;
const sessionStore = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };
function readCache(storage, now) {
  try { const value = JSON.parse(storage?.getItem(CACHE_KEY) || 'null'); return value && Array.isArray(value.models) && value.models.length && now - value.at < TTL_MS && value.at <= now ? value.models : null; }
  catch { return null; }
}
/** The cached catalog without a network request, or null. */
export const cachedOpenRouterCatalog = ({ storage = sessionStore(), now = Date.now } = {}) => readCache(storage, now());

export const CATALOG_TIMEOUT_MS = 15000;
/**
 * Compact catalog records; one request per session (failures are not cached, the next call retries).
 * A request that hangs is aborted after timeoutMs, so the settings fall back to free-text model input.
 */
export function loadOpenRouterCatalog({ fetchImpl = (...args) => globalThis.fetch(...args), storage = sessionStore(), now = Date.now, timeoutMs = CATALOG_TIMEOUT_MS } = {}) {
  const cached = readCache(storage, now());
  if (cached) return Promise.resolve(cached);
  if (pending && now() - pending.at < TTL_MS) return pending.promise;
  const controller = new AbortController();
  let timer;
  // Races the work too: a fetch implementation that ignores the signal cannot hang the picker.
  const timedOut = new Promise((_resolve, reject) => { timer = setTimeout(() => {
    const error = new Error(`The OpenRouter model catalog did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    controller.abort(error); reject(error);
  }, timeoutMs); });
  timedOut.catch(() => {});
  const work = (async () => {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, { credentials: 'omit', signal: controller.signal });
    if (!response?.ok) throw new Error(`The OpenRouter model catalog responded with HTTP ${response?.status}.`);
    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data.map(compactModel).filter(Boolean) : [];
    if (!models.length) throw new Error('The OpenRouter model catalog is empty.');
    if (controller.signal.aborted) throw controller.signal.reason;
    try { storage?.setItem(CACHE_KEY, JSON.stringify({ at: now(), models })); } catch { /* Storage full or unavailable: the promise still caches. */ }
    return models;
  })();
  work.catch(() => {});
  const promise = Promise.race([work, timedOut]).finally(() => clearTimeout(timer));
  pending = { at: now(), promise };
  promise.catch(() => { if (pending?.promise === promise) pending = null; });
  return promise;
}
/** Tests: forget the in-memory catalog. */
export function resetOpenRouterCatalog() { pending = null; }

const localStore = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
/** Recently saved model ids of a kind, newest first. */
export function recentModels(kind, storage = localStore()) {
  try { const value = JSON.parse(storage?.getItem(RECENT_KEY) || '{}'); return strings(value?.[kind]).slice(0, RECENT_LIMIT); }
  catch { return []; }
}
export function rememberModel(kind, id, storage = localStore()) {
  if (typeof id !== 'string' || !id.trim()) return recentModels(kind, storage);
  let value = {};
  try { value = JSON.parse(storage?.getItem(RECENT_KEY) || '{}') || {}; } catch { value = {}; }
  const next = [id, ...strings(value[kind]).filter(item => item !== id)].slice(0, RECENT_LIMIT);
  try { storage?.setItem(RECENT_KEY, JSON.stringify({ ...value, [kind]: next })); } catch { /* Not persisted. */ }
  return next;
}
