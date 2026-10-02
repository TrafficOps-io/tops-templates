// Agent activity labels for `step` cards (spec 2.3) and the retry status line.
// The host translator (t) wins when it knows a key; otherwise the shell's own
// Russian/Ukrainian strings below are used, then the English source text.
import { localizeAiErrorText } from './ai-provider-errors.js';

const interpolate = (text, values = {}) => text.replace(/\{([A-Za-z]+)\}/g, (match, key) => values[key] ?? match);

/** English source → [ru, uk]. */
export const STEP_MESSAGES = Object.freeze({
  'Reading {path}': ['Читаю {path}', 'Читаю {path}'],
  'Reading files': ['Читаю файлы', 'Читаю файли'],
  'Listing project files': ['Смотрю список файлов', 'Переглядаю список файлів'],
  'Reading the fields': ['Читаю поля шаблона', 'Читаю поля шаблону'],
  'Writing {path}': ['Пишу {path}', 'Пишу {path}'],
  'Writing a file': ['Пишу файл', 'Пишу файл'],
  'Editing {path}': ['Правлю {path}', 'Редагую {path}'],
  'Editing a file': ['Правлю файл', 'Редагую файл'],
  'Removing {path}': ['Удаляю {path}', 'Видаляю {path}'],
  'Removing a file': ['Удаляю файл', 'Видаляю файл'],
  'Updating fields: {fields}': ['Меняю поля: {fields}', 'Змінюю поля: {fields}'],
  'Updating fields': ['Меняю поля', 'Змінюю поля'],
  'Checking the draft': ['Проверяю черновик', 'Перевіряю чернетку'],
  'Generating image {path}': ['Генерирую изображение {path}', 'Генерую зображення {path}'],
  'Generating image {path} from {count} reference(s)': ['Генерирую {path} по референсам: {count}', 'Генерую {path} за референсами: {count}'],
  'Generating an image': ['Генерирую изображение', 'Генерую зображення'],
  'Subagent planner: plan of changes': ['Подагент planner: план изменений', 'Підагент planner: план змін'],
  'Subagent review: checking the draft': ['Подагент review: проверка черновика', 'Підагент review: перевірка чернетки'],
  'Using a tool': ['Работаю с инструментом', 'Працюю з інструментом'],
  'Provider is busy ({status}), retry {attempt} of {max} in {seconds} s': ['Провайдер перегружен ({status}), повтор {attempt} из {max} через {seconds} с', 'Провайдер перевантажений ({status}), повтор {attempt} з {max} через {seconds} с'],
});

/** Translates a key of a shell dictionary (English source → [ru, uk]): host t() first, then the dictionary, then English. */
export function localizedText(dictionary, key, values = {}, { t, language } = {}) {
  const english = interpolate(key, values);
  const hosted = typeof t === 'function' ? t(key, values) : english;
  if (typeof hosted === 'string' && hosted !== english && hosted !== key) return hosted;
  const index = language === 'ru' ? 0 : language === 'uk' ? 1 : -1;
  const local = index >= 0 ? dictionary[key]?.[index] : undefined;
  return local ? interpolate(local, values) : english;
}

/** Translates a STEP_MESSAGES key: host t() first, then the shell dictionary, then English. */
export const stepText = (key, values = {}, options = {}) => localizedText(STEP_MESSAGES, key, values, options);

const TOOL_LABELS = {
  read_file: ['Reading {path}', 'Reading files'], read_files: ['Reading {path}', 'Reading files'],
  list_files: [null, 'Listing project files'], get_fields: [null, 'Reading the fields'],
  set_file: ['Writing {path}', 'Writing a file'], set_files: ['Writing {path}', 'Writing a file'],
  patch_file: ['Editing {path}', 'Editing a file'], edit_file: ['Editing {path}', 'Editing a file'],
  remove_file: ['Removing {path}', 'Removing a file'], delete_file: ['Removing {path}', 'Removing a file'],
  set_values: [null, 'Updating fields'], validate_draft: [null, 'Checking the draft'],
  generate_image: ['Generating image {path}', 'Generating an image'],
  plan_changes: [null, 'Subagent planner: plan of changes'], review_draft: [null, 'Subagent review: checking the draft'],
};
const AGENTS = { plan_changes: 'planner', review_draft: 'reviewer' };

/** A persisted run step → the `step` result card of port.d.ts. */
export function stepCard(step, options = {}) {
  const [withPath, plain] = TOOL_LABELS[step.tool] || [null, 'Using a tool'];
  const label = step.tool === 'set_values' && step.fields ? stepText('Updating fields: {fields}', { fields: step.fields }, options)
    : step.tool === 'generate_image' && step.path && step.references > 0 ? stepText('Generating image {path} from {count} reference(s)', { path: step.path, count: step.references }, options)
    : withPath && step.path ? stepText(withPath, { path: step.path }, options) : stepText(plain, {}, options);
  return { type: 'step', label, status: ['running', 'done', 'error'].includes(step.status) ? step.status : 'running',
    ...(step.status === 'error' && step.detail ? { detail: localizeAiErrorText(step.detail, options) } : {}), ...(AGENTS[step.tool] ? { agent: AGENTS[step.tool] } : {}) };
}

/** Status line while a provider retry waits (spec 2.2). */
export function retryNotice(notice, options = {}) {
  return stepText('Provider is busy ({status}), retry {attempt} of {max} in {seconds} s', {
    status: notice.statusCode ?? '?', attempt: notice.attempt ?? 1, max: notice.maxAttempts ?? 3, seconds: Math.max(1, Math.round((notice.delayMs || 0) / 1000)) }, options);
}
