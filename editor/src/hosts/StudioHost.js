// @ts-check
import { readArchive } from './read-archive.js';
import { translateStudio } from '@trafficops/template-editor-shell/translation';
import { ConflictError, PolicyError, runOperation, createZip, validateProject } from '@trafficops/template-editor-core';
import { generateProject, generateEditorPreview } from '@trafficops/template-runtime';
import { readDirectoryProject, readProjectMetadata, readProjectSettings, readProjectSidecar, projectSnapshotEqual } from '../directory-projects.js';
import { createConversationPort } from '../studio-conversations.js';
import { projectMetadata, saveProjectToDirectory, contentSnapshotHash } from '../portable-project.js';
import { studioDialect } from '../studio-dialect.js';
import { starterProject } from '../starter.js';
import { createStudioAnalyzer, assertStudioExport, knownValues } from './studio-analyzer.js';

/**
 * One folder or ZIP workspace per host session. Browser chrome owns the choice
 * of folder; all editing, analysis and persistence cross these same ports.
 * @param {{directory?: FileSystemDirectoryHandle, projectId?:string, kind?:'landing'|'template', name?:string, createdAt?:number, appliedAiRuns?:string[], isDirectoryEnabled?:()=>boolean, initial?: import('@trafficops/template-editor-core').ImportedProject & {name?:string}, language?:string, messages?:Record<string,string>, ai?:import('@trafficops/template-editor-core').AiPort, recovery?:(state:import('@trafficops/template-editor-core').ProjectState)=>Promise<void>}} options
 * @returns {import('@trafficops/template-editor-core').EditorHost}
 */
export function createStudioHost({ directory, projectId, kind = 'landing', name, createdAt = Date.now(), appliedAiRuns = [], isDirectoryEnabled = () => true, initial, language = 'en', messages = {}, ai, recovery } = {}) {
  const t = text => messages[text] || translateStudio(text, language);
  const clone = value => structuredClone(value);
  let state = null, savedDisk = null, savedSettings = {}, revision = 0, queue = Promise.resolve(), opening = null;
  let identity = projectId || initial?.metadata?.projectId || crypto.randomUUID(), diskMetadata = null, conversationPort = null;
  const port = () => conversationPort ||= createConversationPort({ projectId: identity, directory, kind: diskMetadata?.kind || kind, name: state?.name || name || directory?.name || initial?.name || 'Project' });
  const conversations = { get projectId() { return identity; }, async load() { await open(); return port().load(); }, async save(document, options) { await open(); return port().save(document, options); }, subscribe(listener) { return port().subscribe(listener); } };
  function assertDirectoryEnabled() {
    if (directory && !isDirectoryEnabled()) throw new PolicyError('Folder access is available only in the installed Studio app.');
  }
  const capabilities = Object.freeze({ inlinePreview: true, preview: false, lifecycle: false, ai: Boolean(ai), locales: false, entrypoint: false, autosave: Boolean(directory), sourceExport: true, htmlExport: true });
  /** @returns {Promise<import('@trafficops/template-editor-core').ProjectState>} */
  async function open(refresh = false) {
    assertDirectoryEnabled();
    // The conversation port and editor open this host concurrently. Share the
    // pending disk read so both receive the same content revision and baseline.
    if (opening) return clone(await opening);
    if (state && (!directory || !refresh)) return clone(state);
    const task = readState(refresh);
    opening = task;
    try { return clone(await task); }
    finally { if (opening === task) opening = null; }
  }
  /** @returns {Promise<import('@trafficops/template-editor-core').ProjectState>} */
  async function readState(refresh = false) {
    assertDirectoryEnabled();
    if (state && (!directory || !refresh)) return clone(state);
    let snapshot = directory ? await readDirectoryProject(directory) : initial || { files: starterProject(), folders: ['images'], settings: {} };
    assertDirectoryEnabled();
    diskMetadata = directory ? await readProjectMetadata(directory) : initial?.metadata || null;
    if (diskMetadata && projectId && diskMetadata.projectId !== projectId) throw new ConflictError('The folder belongs to a different project.');
    if (diskMetadata && !projectId && diskMetadata.projectId !== identity) { identity = diskMetadata.projectId; conversationPort = null; }
    const settings = directory ? await readProjectSettings(directory) : snapshot.settings || {};
    assertDirectoryEnabled();
    savedDisk = { files: snapshot.files, folders: snapshot.folders || [] };
    savedSettings = settings;
    // Empty folders get an editable starter in memory, but opening never writes to disk.
    const emptyDirectory = directory && !Object.keys(snapshot.files).length;
    state = { projectId: identity, name: name || diskMetadata?.name || directory?.name || initial?.name || t('Untitled project'), revision: ++revision, contentRevision: diskMetadata?.contentRevision || 0,
      appliedAiRuns: [...(diskMetadata?.appliedAiRuns || appliedAiRuns)], files: emptyDirectory ? starterProject(true) : snapshot.files, folders: snapshot.folders || [], entrypoint: null,
      locale: language, translations: { [language]: savedSettings }, status: emptyDirectory ? t('Unsaved project') : directory ? t('Saved to folder') : t('Local project'),
      availability: { inlinePreview: true, externalPreview: false, ai: Boolean(ai) }, actions: [], history: [] };
    return clone(state);
  }
  /** @type {import('@trafficops/template-editor-core').ProjectPort} */
  const project = {
    open({ signal } = {}) { return runOperation(signal, () => open(true)); },
    save(next, { signal } = {}) {
      return runOperation(signal, () => {
        assertDirectoryEnabled();
        // Serialize disk writes. A failed/conflicting write leaves the baseline intact.
        const task = queue.catch(() => {}).then(() => runOperation(signal, async () => {
          assertDirectoryEnabled();
          await open();
          assertDirectoryEnabled();
          if (next.revision !== state.revision) throw new ConflictError();
          validateProject(next.files);
          const settings = next.translations[next.locale] || {};
          const nextContentRevision = (state.contentRevision || 0) + Number(!projectSnapshotEqual(savedDisk, next) || JSON.stringify(savedSettings) !== JSON.stringify(settings));
          if (directory) {
            const currentMetadata = await readProjectMetadata(directory);
            assertDirectoryEnabled();
            const contentMetadata = value => value ? Object.fromEntries(Object.keys(value).filter(key => key !== 'metadataRevision').sort().map(key => [key, value[key]])) : null;
            const historyInitialized = !diskMetadata && currentMetadata?.projectId === identity && !currentMetadata.contentRevision;
            const journalText = await readProjectSidecar(directory, 'transfer.json');
            const journal = journalText ? JSON.parse(journalText) : null;
            const targetHash = journal?.state === 'writing' ? await contentSnapshotHash({ files: next.files, folders: next.folders, settings }) : null;
            const ownPendingWrite = journal?.projectId === identity && journal.state === 'writing' && journal.contentHash === targetHash && journal.sourceHash === await contentSnapshotHash({ ...savedDisk, settings: savedSettings });
            const targetMetadata = projectMetadata({ id: identity, kind: diskMetadata?.kind || kind, name: next.name, createdAt: diskMetadata?.createdAt || createdAt,
              contentRevision: nextContentRevision, appliedAiRuns: next.appliedAiRuns || [], ...(diskMetadata?.sourceTemplateId ? { sourceTemplateId: diskMetadata.sourceTemplateId } : {}) });
            const completedOwnMetadata = ownPendingWrite && JSON.stringify(contentMetadata(currentMetadata)) === JSON.stringify(contentMetadata({ ...targetMetadata, contentHash: targetHash }));
            if (!historyInitialized && !completedOwnMetadata && JSON.stringify(contentMetadata(currentMetadata)) !== JSON.stringify(contentMetadata(diskMetadata))) throw new ConflictError('Project metadata changed outside Studio. Reload the folder before saving.');
            const diskSettings = await readProjectSettings(directory);
            assertDirectoryEnabled();
            if (!ownPendingWrite && JSON.stringify(diskSettings) !== JSON.stringify(savedSettings)) throw new ConflictError('Project values changed outside Studio. Reload the folder before saving.');
            const currentHistory = await port().load();
            const result = await saveProjectToDirectory({ record: { id: identity, kind: diskMetadata?.kind || kind, name: next.name, files: next.files, folders: next.folders, settings,
              createdAt: diskMetadata?.createdAt || createdAt, contentRevision: nextContentRevision, metadataRevision: currentHistory.revision, appliedAiRuns: next.appliedAiRuns || [],
              ...(diskMetadata?.sourceTemplateId ? { sourceTemplateId: diskMetadata.sourceTemplateId } : {}) },
              handle: directory, expectedSnapshot: { ...savedDisk, settings: savedSettings } });
            diskMetadata = result.metadata;
            assertDirectoryEnabled();
          }
          const saved = { ...clone(next), projectId: identity, contentRevision: nextContentRevision,
            status: directory ? t('Saved to folder') : next.status, revision: ++revision };
          if (recovery) await recovery(saved);
          state = saved; savedDisk = { files: clone(next.files), folders: [...next.folders] }; savedSettings = clone(settings);
          return clone(state);
        }, 'validation'));
        queue = task; return task;
      }, 'validation');
    },
    import(bytes, { signal } = {}) { return runOperation(signal, () => readArchive(bytes, { signal }), 'validation'); },
    export(next, { signal, format, locale, history, includeHistory }) {
      return runOperation(signal, async () => {
        if (history) throw new PolicyError('Local projects have no published history.');
        let files = next.files;
        if (format === 'html') {
          const analysis = assertStudioExport(next, locale);
          files = generateProject(next.files, knownValues(analysis.definition.sections.flatMap(section => section.fields), next.translations[locale]), { locale });
        }
        const document = format === 'source' && includeHistory !== false && (!directory || isDirectoryEnabled()) ? await conversations.load() : undefined;
        return { name: `${next.name || 'project'}-${format}.zip`, mime: 'application/zip', bytes: createZip(files, { generated: format === 'html', directories: next.folders,
          ...(format === 'source' ? { settings: next.translations[locale], metadata: projectMetadata({ id: next.projectId || identity, kind: diskMetadata?.kind || kind, name: next.name,
            createdAt: diskMetadata?.createdAt || createdAt, contentRevision: next.contentRevision || 0, metadataRevision: document?.revision || 0, appliedAiRuns: next.appliedAiRuns || [],
            ...(diskMetadata?.sourceTemplateId ? { sourceTemplateId: diskMetadata.sourceTemplateId } : {}) }),
            ...(document && (document.threads.length || document.runs.length) ? { conversations: document } : {}) } : {}) }) };
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
  return { language, messages, capabilities, dialect: studioDialect, project, analyzer, livePreview, conversations, ...(ai ? { ai } : {}) };
}
