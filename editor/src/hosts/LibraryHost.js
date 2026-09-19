// @ts-check
import { ConflictError, PolicyError, ValidationError, runOperation, throwIfAborted } from '@trafficops/template-editor-core';
import { translateStudio } from '@trafficops/template-editor-shell/translation';
import { createStudioHost } from './StudioHost.js';
import { cloneStudioProject, getStudioProject, saveStudioProject, validateStudioProject } from '../studio-library.js';

/** @typedef {ReturnType<typeof validateStudioProject>} LibraryRecord */
const defaultStorage = { get: getStudioProject, save: saveStudioProject };

/**
 * Local library persistence with the same compiler, archives and AI ports as
 * folder projects. A host owns one record; template copies get separate IDs.
 * @param {{record:LibraryRecord, ai?:import('@trafficops/template-editor-core').AiPort, autoStart?:boolean, language?:string, messages?:Record<string,string>, onSaved?:(record:LibraryRecord)=>unknown, storage?:typeof defaultStorage}} options
 * @returns {import('@trafficops/template-editor-core').EditorHost}
 */
export function createLibraryHost({ record, ai, autoStart = false, language = 'en', messages = {}, onSaved, storage = defaultStorage }) {
  const base = createStudioHost({ language, messages, ai });
  const t = text => messages[text] || translateStudio(text, language);
  const id = record.id;
  let metadata = structuredClone(record), stateRevision = record.revision, storageRevision = record.revision;
  let queue = Promise.resolve();
  const creationRevision = record.revision;

  // Serialize claim/open/save within a host; the database's expected revision
  // also protects against another tab, deletion and stale gallery operations.
  function enqueue(signal, operation) {
    const task = queue.catch(() => {}).then(() => runOperation(signal, operation));
    queue = task;
    return task;
  }
  function notify(saved) {
    // A refresh callback cannot turn a durable write into a failed save.
    try { Promise.resolve(onSaved?.(structuredClone(saved))).catch(() => {}); } catch { /* View may have unmounted. */ }
  }
  /** @returns {import('@trafficops/template-editor-core').ProjectState} */
  function unpack(saved, revision = saved.revision) {
    return {
      name: saved.name, revision, files: structuredClone(saved.files), folders: [...saved.folders], entrypoint: null,
      locale: language, translations: { [language]: structuredClone(saved.settings) },
      status: `${t(saved.kind === 'template' ? 'Template' : 'Landing')} · ${t('Saved on this device')}`,
      availability: { inlinePreview: true, externalPreview: false, ai: Boolean(ai) },
      actions: saved.kind === 'landing' ? [{ id: 'save-template', label: t('Save as template'), intent: 'secondary',
        input: { label: t('Template name'), value: saved.name, maxLength: 200,
          help: t('Creates an independent template from your current files and field values.') } }] : [],
      history: [],
    };
  }
  function snapshot(next, current) {
    try {
      const settings = next.translations?.[next.locale];
      if (!settings) throw new Error('Project field values are missing.');
      return validateStudioProject({ ...current, name: next.name, files: next.files, folders: next.folders, settings });
    } catch (error) { throw new ValidationError(error.message, { cause: error }); }
  }
  async function matchingRecord(next) {
    if (next.revision !== stateRevision) throw new ConflictError();
    const current = await storage.get(id);
    if (!current || current.revision !== storageRevision) throw new ConflictError();
    return current;
  }
  /** @type {import('@trafficops/template-editor-core').ProjectPort} */
  const project = {
    ...base.project,
    open({ signal } = {}) {
      return enqueue(signal, async () => {
        const current = await storage.get(id);
        if (!current) throw new PolicyError(t('This Studio project no longer exists. Return to your projects.'));
        metadata = current; stateRevision = current.revision; storageRevision = current.revision;
        return unpack(current);
      });
    },
    save(next, { signal } = {}) {
      return enqueue(signal, async () => {
        const current = await matchingRecord(next);
        const pending = snapshot(next, current);
        // Saving working edits cancels any unattended creation request, while
        // retaining the brief for an explicit retry in the assistant.
        if (pending.aiPrompt) pending.aiStarted = true;
        throwIfAborted(signal);
        const saved = await storage.save(pending, { expectedRevision: storageRevision });
        metadata = saved; stateRevision = saved.revision; storageRevision = saved.revision;
        notify(saved);
        return unpack(saved);
      });
    },
  };
  /** @type {import('@trafficops/template-editor-core').LifecyclePort} */
  const lifecycle = {
    run(action, next, { signal, inputValue }) {
      return enqueue(signal, async () => {
        if (action !== 'save-template' || metadata.kind !== 'landing') throw new PolicyError(t('This action is unavailable.'));
        const current = await matchingRecord(next);
        let copy;
        try {
          if (typeof inputValue !== 'string' || !inputValue.trim()) throw new Error('Enter a template name.');
          copy = cloneStudioProject(snapshot(next, current), { kind: 'template', name: inputValue });
        }
        catch (error) { throw new ValidationError(error.message, { cause: error }); }
        throwIfAborted(signal);
        const saved = await storage.save(copy, { expectedRevision: null });
        notify(saved);
        // Only the copy was persisted. Keep the source's unsaved-state marker
        // and files intact until its normal autosave succeeds.
        return { state: structuredClone(next), persisted: false, notice: t('Template saved on this device.') };
      });
    },
  };
  /** @type {import('@trafficops/template-editor-core').AiPort | undefined} */
  const assistant = ai && { ...ai, ...(record.aiPrompt ? { initialRequest: {
    id, prompt: record.aiPrompt, mode: autoStart && !record.aiStarted ? 'create' : 'edit', autoStart: Boolean(autoStart && !record.aiStarted),
    claim({ signal } = {}) {
      return enqueue(signal, async () => {
        if (!autoStart || metadata.aiStarted || storageRevision !== creationRevision) return false;
        const current = await storage.get(id);
        if (!current || current.aiStarted || current.revision !== creationRevision || current.aiPrompt !== record.aiPrompt) return false;
        throwIfAborted(signal);
        let saved;
        try { saved = await storage.save({ ...current, aiStarted: true }, { expectedRevision: storageRevision }); }
        catch (error) { if (error.code === 'conflict') return false; throw error; }
        // Claim metadata must not invalidate the still-open editor state.
        metadata = saved; storageRevision = saved.revision;
        notify(saved);
        return true;
      });
    },
  } } : {}) };
  return { ...base, capabilities: Object.freeze({ ...base.capabilities, autosave: true, lifecycle: true }), project, lifecycle,
    ...(assistant ? { ai: assistant } : {}) };
}
