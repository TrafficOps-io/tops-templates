// Pure helpers behind ModelPicker: search, filters, sections and formatting. No React and no JSX here, so Node tests
// import this module directly.
//
// ModelOption: { id, name, provider?, group?, description?, contextLength?, price?: { input?, output?, unit? } (strings
// formatted by the product), badges?: ('tools' | 'vision' | 'audio' | 'reasoning' | 'free')[], disabledReason? }.

export const MODEL_BADGES = ['tools', 'vision', 'audio', 'reasoning', 'free'];
/** Filter chips above the list, in this order; a chip is shown only when some option carries its badge. */
export const MODEL_FILTERS = ['tools', 'vision', 'audio', 'free'];
/** Recent models shown at most. */
export const RECENT_LIMIT = 5;

/** 950 → "950", 8192 → "8K", 131072 → "131K", 1048576 → "1M", 1500000 → "1.5M"; not a positive number → "". */
export function formatContextLength(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return '';
  if (tokens < 1000) return String(Math.round(tokens));
  const thousands = Math.round(tokens / 1000);
  if (thousands < 1000) return `${thousands}K`;
  const millions = tokens / 1e6, rounded = Math.round(millions);
  return `${Math.abs(millions - rounded) < 0.1 || millions >= 10 ? rounded : millions.toFixed(1)}M`;
}

// Developer names for OpenRouter-style ids ("openai/gpt-4o" → OpenAI); unknown prefixes are capitalised.
const DEVELOPERS = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'meta-llama': 'Meta', meta: 'Meta', mistralai: 'Mistral', mistral: 'Mistral',
  'x-ai': 'xAI', xai: 'xAI', deepseek: 'DeepSeek', qwen: 'Qwen', cohere: 'Cohere', perplexity: 'Perplexity', amazon: 'Amazon',
  microsoft: 'Microsoft', nvidia: 'NVIDIA', moonshotai: 'Moonshot AI', 'z-ai': 'Z.ai', minimax: 'MiniMax', 'black-forest-labs': 'Black Forest Labs',
  elevenlabs: 'ElevenLabs', stability: 'Stability AI', stabilityai: 'Stability AI', ai21: 'AI21', inflection: 'Inflection', nousresearch: 'Nous Research',
};
export function developerName(id) {
  const prefix = String(id ?? '').split('/')[0];
  if (!prefix || prefix === id) return '';
  return DEVELOPERS[prefix.toLowerCase()] ?? prefix.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
/** Group heading of an option in "All": option.group, else the developer from the id prefix, else provider, else "Other". */
export const modelGroup = option => option.group || developerName(option.id) || option.provider || 'Other';

const haystack = option => [option.name, option.id, option.provider, option.group, developerName(option.id), option.description].filter(Boolean).join(' ').toLowerCase();
/** Every whitespace-separated word of the query occurs in the name, id, provider, group or description (case-insensitive). */
export function matchesQuery(option, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = haystack(option);
  return words.every(word => text.includes(word));
}
/** Options matching the query and carrying every filter badge; the order is kept. */
export function filterModels(options, { query = '', filters = [] } = {}) {
  return (options ?? []).filter(option => matchesQuery(option, query) && filters.every(filter => option.badges?.includes(filter)));
}
/** Filters worth a chip: those some option carries. */
export const availableFilters = options => MODEL_FILTERS.filter(filter => (options ?? []).some(option => option.badges?.includes(filter)));

/**
 * Sections of the list: "recent" (up to RECENT_LIMIT, in recentIds order) and "recommended" (recommendedIds order) while
 * the query is empty, then "all" grouped by modelGroup in order of first appearance. Filters apply to every section; ids
 * missing from options are skipped. "all" renders at most limit options (render cost with hundreds of models).
 * Returns { sections: { key, groups: { label, items }[] }[], total — options matching, hidden — matching but not rendered }.
 */
export function buildModelSections(options, { query = '', filters = [], recentIds = [], recommendedIds = [], limit = Infinity } = {}) {
  const matched = filterModels(options, { query, filters });
  const byId = new Map(matched.map(option => [option.id, option]));
  const pick = ids => [...new Set(ids ?? [])].map(id => byId.get(id)).filter(Boolean);
  const searching = String(query ?? '').trim() !== '';
  const sections = [];
  const recent = searching ? [] : pick(recentIds).slice(0, RECENT_LIMIT);
  if (recent.length) sections.push({ key: 'recent', groups: [{ label: '', items: recent }] });
  const recommended = searching ? [] : pick(recommendedIds);
  if (recommended.length) sections.push({ key: 'recommended', groups: [{ label: '', items: recommended }] });
  const shown = matched.slice(0, Math.max(0, limit));
  const groups = new Map();
  for (const option of shown) {
    const label = modelGroup(option);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(option);
  }
  if (shown.length) sections.push({ key: 'all', groups: [...groups].map(([label, items]) => ({ label, items })) });
  return { sections, total: matched.length, hidden: matched.length - shown.length };
}

/** The inherit row is shown unless a query is typed that matches neither its label nor its detail. */
export function showsInherit(inherit, query) {
  if (!inherit) return false;
  return matchesQuery({ name: inherit.label, description: inherit.detail }, query);
}

/**
 * Keyboard rows in visual order: the inherit row (key 'inherit', option null) and every rendered option keyed
 * `${section}:${id}` (an option may appear in Recent and in All). disabled — option.disabledReason is set.
 */
export function modelRows(sections, inheritShown = false) {
  const rows = inheritShown ? [{ key: 'inherit', option: null, disabled: false }] : [];
  for (const section of sections) for (const group of section.groups) for (const option of group.items) rows.push({ key: `${section.key}:${option.id}`, option, disabled: Boolean(option.disabledReason) });
  return rows;
}

/** Next row index from current by step (±1), wrapping around; -1 when there are no rows. */
export function stepRow(rows, current, step) {
  if (!rows.length) return -1;
  return ((current < 0 ? (step > 0 ? -1 : 0) : current) + step + rows.length) % rows.length;
}
