import { conversationChangedFiles, conversationReferenceLabel } from './conversation-diff.js';
import { retryNotice, stepCard } from './agent-steps.js';
import { localizeAiErrorText } from './ai-provider-errors.js';

const isImage = path => /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(path);
const phaseLabels = { queued: 'Queued', plan: 'Plan', generate: 'Working…', revise: 'Revise', review: 'Review', stopped: 'Stopped', answered: 'Answered', ready: 'Changes ready' };
const activeStates = new Set(['queued', 'running']);
const mime = path => /\.svg$/i.test(path) ? 'image/svg+xml' : /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : /\.gif$/i.test(path) ? 'image/gif' : /\.avif$/i.test(path) ? 'image/avif' : 'image/jpeg';

// base64 чанками по 32768, как conversation-runtime.js:160-161: String.fromCharCode(...bytes) на 4 MiB переполняет стек.
export function toDataUrl(path, bytes) {
  if (!(bytes instanceof Uint8Array)) return undefined;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${mime(path)};base64,${btoa(binary)}`;
}
function lineDiff(before = '', after = '') {
  const a = String(before).split('\n'), b = String(after).split('\n');
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { removed: a.length - start - end, added: b.length - start - end };
}
function valueChanges(before = {}, after = {}, prefix = '') {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]), changes = [];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key, left = before[key], right = after[key];
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) changes.push(...valueChanges(left, right, path));
    else if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ path, before: left, after: right });
  }
  return changes;
}
const card = (id, result) => ({ type: 'tool-call', toolCallId: id, toolName: result.type, result });

// toolCallId строится по пути файла: уникален в пределах сообщения и устойчив между чекпоинтами (индексы — нет).
export function draftCards(runId, base, draft, locale, t = text => text) {
  if (!draft?.files) return [];
  const changed = conversationChangedFiles(base?.files || {}, draft.files), cards = [];
  for (const [path, change] of Object.entries(changed)) {
    const before = base?.files?.[path], after = draft.files[path];
    if (typeof before === 'string' || typeof after === 'string') cards.push(card(`${runId}:diff:${path}`, { type: 'diff', path, before: before ?? '', after: after ?? '', ...lineDiff(before, after) }));
    else if (isImage(path) && change !== 'deleted') cards.push(card(`${runId}:image:${path}`, { type: 'image', name: path, before: toDataUrl(path, before), after: toDataUrl(path, after) }));
    else cards.push(card(`${runId}:file:${path}`, { type: 'file', name: change === 'deleted' ? t('{name} (removed)', { name: path }) : path, bytes: (after ?? before)?.length || 0 }));
  }
  const changes = valueChanges(base?.translations?.[locale] || {}, draft.values || {});
  if (changes.length) cards.push(card(`${runId}:values`, { type: 'values', section: '', changes }));
  return cards;
}
/** Применимость — та же проверка, что в useEditorProject.applyConversationDraft (:105). */
export function applicable(run) {
  const draft = run.result || run.checkpoint;
  return ['ready', 'interrupted'].includes(run.state) && draft?.valid === true && !draft.discussion && !run.recoveredConflict;
}
// Применимый восстановленный interrupted-черновик — 'ready' (Apply/Preview/Discard); неприменимый ready — 'completed'.
// Причина остановки (run.error) — сообщение статуса для failed, interrupted и cancelled, как показывала прежняя панель.
const explained = new Set(['failed', 'interrupted', 'cancelled']);
// language — язык интерфейса для подписей шагов и статуса ретрая, у которых нет перевода в t().
export function runToState(run, t, language) {
  const status = run.state === 'ready' ? (applicable(run) ? 'ready' : 'completed') : run.state === 'interrupted' && applicable(run) ? 'ready' : run.state;
  const active = activeStates.has(run.state);
  const message = explained.has(run.state) && run.error ? localizeAiErrorText(run.error, { t, language }) : active && run.notice?.kind === 'retry' ? retryNotice(run.notice, { t, language })
    : run.phase && active ? t(phaseLabels[run.phase] || run.phase) : undefined;
  return { id: run.id, status, ...(message ? { message } : {}) };
}
/** Шаги агента (вызовы инструментов, подагенты) — карточки step; toolCallId по id вызова, стабилен между снимками. */
export function stepCards(run, t, language) {
  return (Array.isArray(run.steps) ? run.steps : []).filter(step => step && typeof step.id === 'string')
    .map(step => card(`${run.id}:step:${step.id}`, stepCard(step, { t, language })));
}
export function runToParts(run, t, language) {
  // Причина остановки interrupted/cancelled уже в сообщении статуса (runToState) — текстом не дублируется.
  // Пока ран идёт, текст ассистента приходит потоком (text-delta): заглушка в снимке скрыла бы его.
  const draft = run.result || run.checkpoint, error = ['interrupted', 'cancelled'].includes(run.state) ? '' : localizeAiErrorText(run.error, { t, language });
  const text = run.result?.summary || error || (draft && !activeStates.has(run.state) ? t('Changes prepared for review.') : '');
  return [...(text ? [{ type: 'text', text }] : []), ...stepCards(run, t, language), ...draftCards(run.id, run.base, draft, run.locale, t)];
}
export function conflictToParts(runId, conflict, state, locale, t) {
  const overlapping = (conflict.conflicts || []).length > 0, parts = [];
  if (conflict.candidate) parts.push(...draftCards(`${runId}:candidate`, { files: state.files, translations: state.translations }, { files: conflict.candidate.files, values: conflict.candidate.translations?.[locale] || {} }, locale, t));
  const references = [...(conflict.conflicts || []), ...(conflict.staleReadSet || [])].map(item => t(conversationReferenceLabel(item)));
  parts.push(card(`conflict:${runId}`, { type: 'question', kind: 'conflict', questionId: `conflict:${runId}`, text: t(overlapping ? 'Some changes overlap. Continue the conversation with the current project to resolve them.' : 'The project changed while the assistant worked. Review the current files before applying.'), references, options: overlapping ? ['rebase'] : ['reviewed', 'rebase'] }));
  return parts;
}
