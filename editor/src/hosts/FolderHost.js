// @ts-check
import { packArchive } from './pack-archive.js';
import { readArchive } from './read-archive.js';
import { translateStudio } from '@trafficops/template-editor-shell/translation';
import { BLOB_TAG, CONVERSATION_LIMITS, ConflictError, HISTORY_BLOBS, HISTORY_LIMIT_MESSAGES, LIMITS, PolicyError, ValidationError, byteSize, createZip, createStoreConversationPort, projectFolders, runOperation, validatePortableMetadata, validateProject } from '@trafficops/template-editor-core';
import { generateProject, generateEditorPreview } from '@trafficops/template-runtime';
import { createDirectoryConversationStore } from '../storage/directory-conversation-store.js';
import { projectSnapshotEqual, readProjectTree, syncProjectTree } from '../storage/files.js';
import { claimPendingAi, readProjectMeta, readValues, resolvePendingAi, updateProjectMeta, writeValues } from '../storage/project-meta.js';
import { createProjectInRoot } from '../storage/project-root.js';
import { studioDialect } from '../studio-dialect.js';
import { starterProject } from '../starter.js';
import { createStudioAnalyzer, assertStudioExport, knownValues } from './studio-analyzer.js';

const clone = value => structuredClone(value);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// The project.json fields Studio owns while a project is open. pendingAi and metadataRevision are excluded: a claimed
// brief or a store-owned counter is not a change outside Studio.
const tracked = meta => JSON.stringify([meta.projectId, meta.kind, meta.name, meta.contentRevision ?? 0, meta.appliedAiRuns || [], meta.sourceTemplateId ?? null]);
const encoder = new TextEncoder(), OS_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
// sha → size, from every blob reference in a split value.
function blobSizes(value, found = new Map()) {
  if (Array.isArray(value)) for (const item of value) blobSizes(item, found);
  else if (value && typeof value === 'object') {
    if (Object.hasOwn(value, BLOB_TAG)) found.set(value[BLOB_TAG], Math.max(found.get(value[BLOB_TAG]) || 0, value.size || 0));
    else for (const child of Object.values(value)) blobSizes(child, found);
  }
  return found;
}
const withoutBrief = ({ pendingAi: _brief, pendingAiError: _error, ...meta }) => meta;
/** @type {(root: FileSystemDirectoryHandle, options: { projectId: string }) => any} */
const directoryStore = /** @type {any} */ (createDirectoryConversationStore);
/** @type {(root: FileSystemDirectoryHandle, options: object) => Promise<any>} */
const createProject = /** @type {any} */ (createProjectInRoot);

/**
 * One project folder (a user folder or an OPFS root) per host session. Async: a pending AI brief in project.json is
 * resolved during creation, because the conversation runtime reads `host.ai.initialRequest` synchronously once its
 * session is ready.
 * @param {{ root: FileSystemDirectoryHandle, meta?: { projectId: string, kind?: 'landing' | 'template', name?: string } | null, language?: string, messages?: Record<string, string>,
 *   ai?: import('@trafficops/template-editor-core').AiPort, createProjectRoot?: (options: { kind: 'template', name: string }) => Promise<FileSystemDirectoryHandle | null>,
 *   onProjectCreated?: (meta: object, root: FileSystemDirectoryHandle) => unknown, now?: () => number }} options
 *   createProjectRoot: App-provided; called synchronously by the "Save as template" action, before any await, so a
 *   folder picker keeps the click's user activation. Resolving null cancels the action.
 * @returns {Promise<import('@trafficops/template-editor-core').EditorHost>}
 */
export async function createFolderHost({ root, meta, language = 'en', messages = {}, ai, createProjectRoot, onProjectCreated, now = Date.now }) {
  const t = (text, values) => messages[text] || translateStudio(text, language, values);
  const initialMeta = /** @type {any} */ (await readProjectMeta(root));
  const projectId = meta?.projectId ?? initialMeta?.projectId;
  if (!projectId) throw new ValidationError('This folder is not a Studio project.');
  // unrecorded: content was written but project.json has not counted it yet (its write failed); the next save does.
  /** @type {any} */ let state = null, diskMeta = null, savedDisk = null, savedValues = {};
  let briefWarning = '', revision = 0, queue = /** @type {Promise<any>} */ (Promise.resolve()), opening = /** @type {Promise<any> | null} */ (null), unrecorded = false;
  const kind = () => (diskMeta || initialMeta || meta)?.kind || 'landing';
  const store = directoryStore(root, { projectId });
  const conversations = createStoreConversationPort(store, { projectId });
  const capabilities = Object.freeze({ inlinePreview: true, preview: false, lifecycle: true, ai: Boolean(ai), locales: false, entrypoint: false, autosave: true, sourceExport: true, htmlExport: true });
  const actions = () => kind() === 'landing' && createProjectRoot ? [{ id: 'save-template', label: t('Save as template'), intent: /** @type {const} */ ('secondary'),
    input: { label: t('Template name'), value: state?.name || '', maxLength: 200, help: t('Creates an independent template from your current files and field values.') } }] : [];

  // project.json reads as missing. A folder that is gone or no longer permitted (listing it fails) or emptied
  // completely is access loss, reported by its error name so the App can offer to reconnect; otherwise a conflict.
  async function missingMeta(message) {
    for await (const name of root.keys()) if (!OS_FILES.has(name)) return new ConflictError(message);
    return new DOMException('The project folder is no longer available.', 'NotFoundError');
  }
  // Serialized with saves. Re-reading an unchanged folder keeps the revision, so a second reader (the conversation
  // runtime opens the project for an initial request) never makes the editor's state stale.
  async function readState() {
    const tree = await readProjectTree(root), values = await readValues(root), disk = /** @type {any} */ (await readProjectMeta(root));
    if (!disk) throw await missingMeta('The project metadata is missing from the folder.');
    if (disk.projectId !== projectId) throw new ConflictError('The folder belongs to a different project.');
    const current = withoutBrief(disk);
    if (state && projectSnapshotEqual(savedDisk, tree) && sameJson(values, savedValues) && tracked(current) === tracked(diskMeta)) { diskMeta = current; return state; }
    diskMeta = current; savedDisk = tree; savedValues = values;
    // An empty folder gets an editable starter in memory; opening never writes to disk.
    const empty = !Object.keys(tree.files).length;
    state = { projectId, name: current.name || t('Untitled project'), revision: ++revision, contentRevision: current.contentRevision || 0, appliedAiRuns: [...(current.appliedAiRuns || [])],
      files: empty ? starterProject(true) : tree.files, folders: [...tree.folders], entrypoint: null, locale: language, translations: { [language]: clone(values) },
      status: [empty ? t('Unsaved project') : t('Saved to folder'), briefWarning].filter(Boolean).join(' · '), availability: { inlinePreview: true, externalPreview: false, ai: Boolean(ai) }, actions: [], history: [] };
    state.actions = actions();
    return state;
  }
  function open() {
    if (opening) return opening.then(clone);
    const task = queue.catch(() => {}).then(readState);
    opening = queue = task;
    task.finally(() => { if (opening === task) opening = null; }).catch(() => {});
    return task.then(clone);
  }

  /** @type {import('@trafficops/template-editor-core').ProjectPort} */
  const project = {
    open({ signal } = {}) { return runOperation(signal, open, 'validation'); },
    save(next, { signal } = {}) {
      return runOperation(signal, () => {
        // Disk writes are serialized. A failed or conflicting write leaves the baseline intact.
        const task = queue.catch(() => {}).then(() => runOperation(signal, async () => {
          if (!state) await readState();
          if (next.revision !== state.revision) throw new ConflictError();
          validateProject(next.files);
          let folders;
          try { folders = projectFolders(next.files, next.folders); } catch (error) { throw new ValidationError(error.message, { cause: error }); }
          const values = next.translations?.[next.locale] || {}, tree = { files: next.files, folders };
          const filesChanged = !projectSnapshotEqual(savedDisk, tree), valuesChanged = !sameJson(values, savedValues);
          const contentRevision = (diskMeta.contentRevision || 0) + Number(filesChanged || valuesChanged || unrecorded);
          let target;
          try { target = validatePortableMetadata({ ...diskMeta, name: next.name, contentRevision, appliedAiRuns: next.appliedAiRuns || [] }); } catch (error) { throw new ValidationError(error.message, { cause: error }); }
          const disk = /** @type {any} */ (await readProjectMeta(root));
          if (!disk) throw await missingMeta('Project metadata changed outside Studio. Reload the folder before saving.');
          if (tracked(withoutBrief(disk)) !== tracked(diskMeta)) throw new ConflictError('Project metadata changed outside Studio. Reload the folder before saving.');
          if (!sameJson(await readValues(root), savedValues)) throw new ConflictError('Project values changed outside Studio. Reload the folder before saving.');
          try {
            if (filesChanged) { unrecorded = true; await syncProjectTree(root, savedDisk, tree); }
            if (valuesChanged) { unrecorded = true; await writeValues(root, values); }
            if (tracked(target) !== tracked(diskMeta)) diskMeta = withoutBrief(await updateProjectMeta(root, projectId, { name: target.name, contentRevision, appliedAiRuns: target.appliedAiRuns }));
          } catch (error) {
            // The folder may now hold part of this save: the next open rebuilds the baseline from disk.
            if (unrecorded) state = null;
            throw error;
          }
          unrecorded = false;
          savedDisk = { files: clone(next.files), folders: [...folders] }; savedValues = clone(values);
          state = { ...clone(next), folders: [...folders], projectId, name: diskMeta.name, contentRevision, status: t('Saved to folder'), revision: ++revision };
          state.actions = actions();
          return clone(state);
        }, 'validation'));
        queue = task; return task;
      }, 'validation');
    },
    import(bytes, { signal } = {}) { return runOperation(signal, () => readArchive(bytes, { history: true, signal }), 'validation'); },
    export(next, { signal, format, locale, history, includeHistory }) {
      return runOperation(signal, async () => {
        if (history) throw new PolicyError('Local projects have no published history.');
        let files = next.files;
        if (format === 'html') {
          const analysis = assertStudioExport(next, locale);
          files = generateProject(next.files, knownValues(analysis.definition.sections.flatMap(section => section.fields), next.translations[locale]), { locale });
          return { name: `${next.name || 'project'}-${format}.zip`, mime: 'application/zip', bytes: createZip(files, { generated: true, directories: next.folders }) };
        }
        const current = diskMeta || withoutBrief(initialMeta || { projectId, kind: kind(), name: next.name });
        const metadata = { schema: /** @type {const} */ (1), projectId, kind: kind(), name: next.name, contentRevision: next.contentRevision || 0, metadataRevision: current.metadataRevision || 0,
          appliedAiRuns: next.appliedAiRuns || [], ...(current.createdAt === undefined ? {} : { createdAt: current.createdAt }), ...(current.sourceTemplateId === undefined ? {} : { sourceTemplateId: current.sourceTemplateId }) };
        const conversationFiles = includeHistory === false ? null : await historyFiles(files);
        const options = { directories: next.folders, settings: next.translations[locale], metadata, ...(conversationFiles?.threads.length ? { conversationFiles } : {}) };
        // History exports can be large: packed in the archive worker. Only the blob buffers read for this export move.
        const bytes = conversationFiles && options.conversationFiles ? await packArchive(files, options, { signal, transfer: [...conversationFiles.blobs.values()].map(blob => blob.buffer) }) : createZip(files, options);
        return { name: `${next.name || 'project'}-${format}.zip`, mime: 'application/zip', bytes };
      }, 'validation');
    },
  };
  // The folder's split dialogue files and the blobs they reference, as stored: no join and no re-split.
  // Limits are checked from the listing's references first, so an oversize export fails before any blob is read.
  async function historyFiles(files) {
    const threads = await store.listThreads();
    if (threads.some(thread => thread.damaged)) throw new ValidationError('A dialogue file in this folder is damaged. Export without history, or repair the folder first.');
    if (threads.length > CONVERSATION_LIMITS.threads) throw new ValidationError(HISTORY_LIMIT_MESSAGES.threads);
    const sizes = new Map();
    for (const thread of threads) blobSizes(thread, sizes);
    if (sizes.size > HISTORY_BLOBS) throw new ValidationError(HISTORY_LIMIT_MESSAGES.blobs);
    let history = 0;
    for (const thread of threads) history += encoder.encode(JSON.stringify(thread)).byteLength;
    for (const size of sizes.values()) history += size;
    const user = Object.values(files).reduce((sum, value) => sum + byteSize(value), 0);
    if (history > CONVERSATION_LIMITS.total || history + user > LIMITS.portableArchive) throw new ValidationError(HISTORY_LIMIT_MESSAGES.total);
    const blobs = new Map();
    for (const sha of sizes.keys()) blobs.set(sha, await store.getBlob(sha));
    return { threads, blobs };
  }

  /** @type {import('@trafficops/template-editor-core').LifecyclePort} */
  const lifecycle = {
    run(action, next, { signal, inputValue }) {
      return runOperation(signal, async () => {
        if (action !== 'save-template' || kind() !== 'landing' || !createProjectRoot) throw new PolicyError(t('This action is unavailable.'));
        if (typeof inputValue !== 'string' || !inputValue.trim()) throw new ValidationError(t('Enter a template name.'));
        const name = inputValue.trim(), files = clone(next.files), folders = [...next.folders], values = clone(next.translations?.[next.locale] || {});
        validateProject(files);
        // First await of the click flow: the App may open a folder picker here.
        let target;
        try { target = await createProjectRoot({ kind: 'template', name }); } catch (error) { if (error?.name !== 'AbortError') throw error; }
        if (!target) return { state: clone(next), persisted: false, notice: '' };
        const created = await createProject(target, { kind: 'template', name, files, folders, values, now });
        // The template is written; a failing App callback cannot turn that into a failed action.
        try { Promise.resolve(onProjectCreated?.(created, target)).catch(() => {}); } catch { /* View may have unmounted. */ }
        // Only the copy was persisted; the source keeps its unsaved state until its own autosave.
        return { state: clone(next), persisted: false, notice: t('Template saved.') };
      }, 'validation');
    },
  };

  const analyzer = createStudioAnalyzer();
  /** @type {import('@trafficops/template-editor-core').LivePreviewPort} */
  const livePreview = {
    render(next, { signal, locale, page }) {
      return runOperation(signal, async () => {
        // Plain HTML assets retain their input insertion order in generated
        // files. The analyzer's page order is the canonical order shown by the
        // editor (index.html first, then naturally sorted page names).
        const analysis = await analyzer.analyze(next, { signal });
        if (!analysis.definition) throw new PolicyError('No valid page is available for preview.');
        const traced = ai ? generateEditorPreview(next.files, knownValues(analysis.definition.sections.flatMap(section => section.fields), next.translations[locale]), { locale }, { draft: true }) : null;
        const files = traced?.files || await analyzer.render(next, { signal, locale });
        const selected = [page, analysis.entrypoint, ...analysis.pages].find(path => path?.endsWith('.html') && Object.hasOwn(files, path));
        if (!selected) throw new PolicyError('No page is available for preview.');
        const { buildInteractivePreview } = await import('../preview/interactive-preview.js');
        const byId = new Map(traced?.blockInstances.map(item => [item.id, item]) || []);
        const selectionPages = traced && Object.fromEntries(Object.keys(files).filter(path => /\.html?$/i.test(path)).map(path => [path, traced.blockInstances.filter(instance => instance.page === path).map(instance => {
          const ancestorIds = [];
          let parent = byId.get(instance.parentId);
          while (parent && !ancestorIds.includes(parent.id)) { ancestorIds.push(parent.id); parent = byId.get(parent.parentId); }
          return { id: instance.id, label: instance.label, ancestorIds };
        })]));
        const frame = buildInteractivePreview(files, selected, selectionPages ? { selection: { pages: selectionPages } } : undefined);
        return { html: frame.html, page: selected, readyToken: frame.readyToken, dispose: frame.dispose,
          ...(traced && frame.selection ? { selection: { ...frame.selection, blockSources: traced.blockSources, blockInstances: traced.blockInstances, valueUses: traced.valueUses } } : {}) };
      }, 'validation');
    },
  };

  // The shell shows the opened state's status; the details go to the console.
  function warnBrief(detail) {
    briefWarning = t('The saved AI request could not be started.');
    console.warn(`TrafficOps Studio: the pending AI request was not started: ${detail}`);
  }
  // A brief stored in project.json starts the conversation once: claim() succeeds for exactly one host. A brief that
  // cannot be resolved (missing or invalid attachment) is not offered; the project still opens.
  /** @type {import('@trafficops/template-editor-core').InitialAiRequest | undefined} */
  let initialRequest;
  if (ai && initialMeta?.pendingAiError) warnBrief(initialMeta.pendingAiError);
  if (ai && initialMeta?.pendingAi && initialMeta.projectId === projectId) {
    try {
      const { id, prompt, mode, generateImages, attachments } = await resolvePendingAi(root, initialMeta);
      initialRequest = { id, prompt, mode: mode === 'edit' ? 'edit' : 'create', generateImages, attachments, autoStart: true,
        claim: (/** @type {{ signal?: AbortSignal }} */ { signal } = {}) => runOperation(signal, () => claimPendingAi(root, projectId, id)) };
    } catch (error) { initialRequest = undefined; warnBrief(error?.message); }
  }
  const aiPort = ai && (initialRequest ? { ...ai, initialRequest } : ai);
  return { language, messages, capabilities, dialect: studioDialect, project, analyzer, livePreview, lifecycle, conversations, ...(aiPort ? { ai: aiPort } : {}),
    dispose() { store.close(); } };
}
