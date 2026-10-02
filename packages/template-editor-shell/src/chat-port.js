import { PolicyError } from '@trafficops/template-editor-core';
import { conflictToParts, runToParts, runToState } from './chat-cards.js';
import { addFileMention, addSectionMention } from './conversation-mentions.js';
import { blockScopeBaseMatches, previewSectionOptions, previewSelectionMatches } from './preview-selection.js';
import { FILE_ATTACHMENT_ACCEPT, FILE_ATTACHMENT_LIMITS, readFileAiAttachments } from './file-ai-attachments.js';

const uuid = () => globalThis.crypto?.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const iso = value => new Date(value ?? Date.now()).toISOString();
const attachmentBytes = a => a.text ? new TextEncoder().encode(a.text).length : Math.floor(((a.dataUrl || '').split(',')[1] || '').length * 3 / 4);
// Ссылки рантайма: { kind: 'section', id, page, label } или файл { path, kind: 'text' | 'binary' }.
const toMentionTarget = item => item?.kind === 'section'
  ? { kind: 'section', id: `${item.page}:${item.id}`, label: item.label || item.id, detail: item.page }
  : { kind: 'file', id: typeof item === 'string' ? item : item.path, label: typeof item === 'string' ? item : item.path };
const sectionId = section => `${section.page}:${section.id}`;

/**
 * Черновик рана для «Keep draft in editor»: кладётся в проект без валидации. Невалидный черновик блочного рана
 * отвергается — applyProjectDraft заменил бы весь проект снимком момента выделения (как скрывал кнопку AiRunSummary).
 */
export function keptDraft(run, { locale, t }) {
  const draft = run?.result || run?.checkpoint; if (!draft?.files) return null;
  if ((run.scope?.kind === 'block' || draft.editScope) && draft.valid !== true) throw new Error(t('Completed block changes are retained. Continue generation to validate and review them before applying.'));
  return { files: draft.files, values: draft.values || {}, locale: run.locale || locale, mode: run.mode === 'create' ? 'create' : 'edit' };
}

/**
 * ChatPort над сессией conversation-runtime. `context()` возвращает актуальные state, locale, sectionFrame,
 * settings, onApplyRun(run, { allowStaleContext }), onPreviewDraft(draft | null), onKeepDraft(run), onOpenFile(path), onOpenSection(target), t.
 * Возвращает { port, registerBlockScope, invalidateConflicts, refresh }: три последних — внутренний API адаптера, в ChatPort их нет.
 */
export function createChatPort(session, context) {
  const listeners = new Set(), conflicts = new Map(), blockScopes = new Map(), pendingThreads = new Map(), streams = new Set(), messageStores = new Map();
  let disposed = false, revision = 0;
  const notify = () => { if (disposed) return; revision++; for (const listener of [...listeners]) listener(); };
  const unsubscribe = session.subscribe(notify);
  const document = () => session.getSnapshot();
  // Внутренняя подписка без значения; ReadableStore порта оборачивает её и передаёт значение (контракт).
  const subscribe = listener => { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); };
  // Снимок кэшируется до следующего изменения: get() обязан быть стабильным для useSyncExternalStore.
  const store = read => {
    let cache = null;
    const get = () => {
      const doc = document();
      if (!cache || cache.doc !== doc || cache.revision !== revision) cache = { doc, revision, value: read() };
      return cache.value;
    };
    return { get, subscribe: fn => subscribe(() => fn(get())) };
  };
  const runsOf = threadId => document().runs.filter(run => run.threadId === threadId);
  const findRun = runId => document().runs.find(run => run.id === runId);

  function assistantMessage(run) {
    const { t, state, locale } = context(), conflict = conflicts.get(run.id);
    // id сообщения ассистента равен id рана — инвариант контракта RunState.id === message.id
    return { id: run.id, role: 'assistant', createdAt: iso(run.createdAt ?? run.updatedAt), parts: [...runToParts(run, t), ...(conflict ? conflictToParts(run.id, conflict, state, locale, t) : [])], status: runToState(run, t) };
  }
  function messagesOf(threadId) {
    const thread = document().threads.find(item => item.id === threadId); if (!thread) return [];
    const runs = runsOf(threadId), out = [];
    for (const message of thread.messages) {
      if (message.role !== 'user') continue;
      out.push({ id: message.id, role: 'user', createdAt: iso(message.createdAt), parts: [{ type: 'text', text: message.prompt || message.text || '' }], mentions: (message.mentions || []).map(toMentionTarget), attachments: (message.attachments || []).map(a => ({ id: a.id, name: a.name, type: a.mime?.startsWith('image/') ? 'image' : 'document', bytes: attachmentBytes(a), ...(a.dataUrl ? { url: a.dataUrl } : {}) })) });
      // Матч только по messageId: уточнения (queued-clarification, runId занятого рана) не порождают сообщений ассистента.
      const run = runs.find(value => value.messageId === message.id);
      if (run) out.push(assistantMessage(run));
    }
    return out;
  }
  const threadsNow = () => {
    const { t } = context(), real = document().threads;
    for (const id of pendingThreads.keys()) if (real.some(item => item.id === id)) pendingThreads.delete(id);
    const mapped = real.map(item => ({ id: item.id, title: item.title, createdAt: iso(item.createdAt ?? item.updatedAt), updatedAt: iso(item.updatedAt), archived: Boolean(item.archived) }));
    return [...[...pendingThreads.values()].map(thread => ({ ...thread, title: t('New conversation') })), ...mapped];
  };
  const threads = store(threadsNow);

  // Горячий поток: подписка при вызове, буфер, дифф по ранам. Все открытые потоки закрываются в dispose().
  function events(threadId) {
    const queue = [], waiters = [], seen = new Map();
    let closed = false;
    const push = event => { if (closed) return; queue.push(event); waiters.shift()?.(); };
    // status сравнивается по state/phase (не по updatedAt): снимок статуса не содержит времени
    const snapshotOf = run => {
      const { t } = context();
      return { status: JSON.stringify(runToState(run, t)), parts: new Map(runToParts(run, t).filter(part => part.type === 'tool-call').map(part => [part.toolCallId, part])), conflict: conflicts.get(run.id) };
    };
    const emitDiff = () => {
      const { t, state, locale } = context();
      for (const run of runsOf(threadId)) {
        const previous = seen.get(run.id), current = snapshotOf(run), messageId = run.id;
        if (!previous || previous.status !== current.status) push({ type: 'status', messageId, status: runToState(run, t) });
        for (const [toolCallId, part] of current.parts) {
          const before = previous?.parts.get(toolCallId);
          if (!before) push({ type: 'part-start', messageId, part });
          else if (JSON.stringify(before.result) !== JSON.stringify(part.result)) push({ type: 'part-update', messageId, toolCallId, result: part.result });
        }
        // Конфликт идёт через тот же эмиттер: повторный part-start с тем же toolCallId заменяет карточку.
        if (current.conflict && current.conflict !== previous?.conflict) for (const part of conflictToParts(run.id, current.conflict, state, locale, t)) push({ type: 'part-start', messageId, part });
        seen.set(run.id, current);
      }
    };
    for (const run of runsOf(threadId)) seen.set(run.id, snapshotOf(run)); // стартовое состояние уже отрисовано через messages()
    const off = subscribe(emitDiff);
    const close = () => { closed = true; off(); streams.delete(close); while (waiters.length) waiters.shift()(); };
    if (disposed) close(); else streams.add(close);
    return { [Symbol.asyncIterator]() { return {
      async next() { while (!queue.length && !closed) await new Promise(resolve => waiters.push(resolve)); return queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true }; },
      async return() { close(); queue.length = 0; return { value: undefined, done: true }; },
    }; } };
  }
  function sectionsOf(state, locale, sectionFrame) {
    return sectionFrame && previewSelectionMatches(sectionFrame, { files: state.files, values: sectionFrame.sourceSnapshot?.values, locale }) ? previewSectionOptions(sectionFrame) : [];
  }
  function mentionTargets(query = '', kind) {
    const { state, locale, sectionFrame } = context(), needle = String(query || '').toLocaleLowerCase(), out = [];
    if (!kind || kind === 'section') out.push(...sectionsOf(state, locale, sectionFrame).map(section => ({ kind: 'section', id: sectionId(section), label: section.label, detail: section.page })));
    if (!kind || kind === 'file') out.push(...Object.keys(state.files || {}).sort((a, b) => a.localeCompare(b)).map(path => ({ kind: 'file', id: path, label: path })));
    if (!kind || kind === 'field') for (const section of state.analysis?.definition?.sections || []) for (const field of section.fields || []) out.push({ kind: 'field', id: `field:${section.id}.${field.name}`, label: field.label || field.name, detail: section.label || section.id });
    return out.filter(item => `${item.label} ${item.id}`.toLocaleLowerCase().includes(needle)).slice(0, 50);
  }

  const port = {
    threads,
    messages(threadId) {
      if (!messageStores.has(threadId)) messageStores.set(threadId, store(() => messagesOf(threadId)));
      return messageStores.get(threadId);
    },
    events,
    async send(threadId, input) {
      const { state, locale, sectionFrame, settings, t } = context();
      if (!settings?.configured) throw new PolicyError(t('Connect your key in Settings to start.'));
      const text = (input.text || '').trim(), files = input.attachments || [];
      if (!text && !files.length) throw new PolicyError(t('Type a message or attach a file.'));
      // File[] контракта → форма рантайма { id, name, mime, dataUrl | text } с лимитами и валидацией file-ai-attachments.js
      const attachments = files.length ? await readFileAiAttachments(files) : [];
      const sections = sectionsOf(state, locale, sectionFrame);
      let mentions = [];
      for (const target of input.mentions || []) {
        if (target.kind === 'file') mentions = addFileMention(mentions, target.id);
        else if (target.kind === 'section') { const section = sections.find(item => sectionId(item) === target.id); if (section) mentions = addSectionMention(mentions, section); }
      }
      const scope = input.scope?.kind === 'block' ? { kind: 'block', editScope: blockScopes.get(input.scope.targetId) }
        : input.scope?.kind === 'file' ? { kind: 'file', path: input.scope.targetId } : { kind: input.scope?.kind || 'project' };
      // Выделение блоков сделано по снимку проекта: после правок или смены языка его нужно выделить заново.
      const editScope = scope.kind === 'block' ? scope.editScope : null;
      if (editScope && ((editScope.locale && editScope.locale !== locale) || !blockScopeBaseMatches(editScope, { files: state.files, rawValues: state.translations?.[editScope.locale || locale] || {} })))
        throw new PolicyError(t('The selected preview is outdated. Refresh preview and select the blocks again.'));
      const fieldNotes = (input.mentions || []).filter(target => target.kind === 'field').map(target => `@${target.label}`).join(' ');
      // Рантайм требует непустой prompt; сообщение «только вложения» получает нейтральную формулировку.
      const body = text || t('Use the attached files as reference.');
      await session.submit({ threadId, prompt: fieldNotes ? `${body}\n(${fieldNotes})` : body, attachments, mentions, scope, snapshot: state, locale, sectionFrame, generateImages: input.generateImages, ...(input.mode ? { mode: input.mode } : {}) });
      pendingThreads.delete(threadId); notify();
    },
    async stop(runId) { await session.stop(runId); },
    async discard(runId) { conflicts.delete(runId); await session.discard(runId); notify(); },
    async apply(runId, { allowStaleContext = false } = {}) {
      const run = findRun(runId); if (!run) throw new Error(context().t('This result no longer exists.'));
      try { const saved = await context().onApplyRun(run, { allowStaleContext }); await session.markApplied(runId, saved?.revision); conflicts.delete(runId); notify(); }
      catch (error) { if (error?.code === 'conflict') { conflicts.set(runId, error); notify(); return; } throw error; }
    },
    async previewDraft(runId) {
      const run = runId ? findRun(runId) : null, draft = run?.result || run?.checkpoint;
      context().onPreviewDraft?.(run && draft ? { ...draft, locale: run.locale, runId: run.id } : null); // форма useEditorProject.js previewConversationDraft
    },
    async answer(questionId, value) {
      const runId = String(questionId).replace(/^conflict:/, '');
      if (value === 'rebase') { conflicts.delete(runId); const { state, locale } = context(); await session.continue(runId, { snapshot: state, locale, rebase: true }); notify(); }
      else if (value === 'reviewed') await port.apply(runId, { allowStaleContext: true });
    },
    async continueRun(runId, prompt) { const { state, locale } = context(); await session.continue(runId, { prompt: prompt || undefined, snapshot: state, locale }); notify(); },
    async keepDraft(runId) { const run = findRun(runId); if (run) await context().onKeepDraft?.(run); notify(); },
    async createThread() {
      const now = new Date().toISOString(), thread = { id: uuid(), title: context().t('New conversation'), createdAt: now, updatedAt: now, archived: false };
      pendingThreads.set(thread.id, thread); notify(); return thread;
    },
    async renameThread(threadId, title) { await session.rename(threadId, title); },
    async archiveThread(threadId, archived) { await session.archive(threadId, archived); },
    async deleteThread(threadId) { messageStores.delete(threadId); if (pendingThreads.delete(threadId)) { notify(); return; } await session.deleteThread(threadId); },
    mentionTargets,
    openTarget(target) { if (target.kind === 'file') context().onOpenFile?.(target.id); else context().onOpenSection?.(target); },
    attachmentLimits: { count: FILE_ATTACHMENT_LIMITS.count, bytesPerFile: FILE_ATTACHMENT_LIMITS.bytes, bytesTotal: FILE_ATTACHMENT_LIMITS.total, accept: FILE_ATTACHMENT_ACCEPT },
    get capabilities() { const { settings, onKeepDraft } = context(); return { scopes: ['project', 'file', 'block', 'content', 'discussion'], cost: false, previewDraft: true, generateImages: Boolean(settings?.imageModel), conflictReview: true, keepDraft: Boolean(onKeepDraft) }; },
    dispose() { for (const close of [...streams]) close(); disposed = true; unsubscribe(); listeners.clear(); messageStores.clear(); },
  };
  return {
    port,
    registerBlockScope(key, editScope) { blockScopes.set(key, editScope); },
    invalidateConflicts() { if (conflicts.size) { conflicts.clear(); notify(); } },
    // Смена языка интерфейса: t() из context() уже новый, но кэш снимков держит старые подписи — сбросить и уведомить.
    refresh() { notify(); },
  };
}
