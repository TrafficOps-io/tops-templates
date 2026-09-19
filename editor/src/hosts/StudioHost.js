// @ts-check
import { readArchive } from './read-archive.js';
import { translateStudio } from '@trafficops/template-editor-shell/translation';
import { ConflictError, PolicyError, runOperation, createZip, validateProject } from '@trafficops/template-editor-core';
import { generateProject } from '@trafficops/template-runtime';
import { readDirectoryProject, readProjectSettings, syncDirectoryProject, writeProjectSettings } from '../directory-projects.js';
import { studioDialect } from '../studio-dialect.js';
import { starterProject } from '../starter.js';
import { createStudioAnalyzer, assertStudioExport, knownValues } from './studio-analyzer.js';

/**
 * One folder or ZIP workspace per host session. Browser chrome owns the choice
 * of folder; all editing, analysis and persistence cross these same ports.
 * @param {{directory?: FileSystemDirectoryHandle, isDirectoryEnabled?:()=>boolean, initial?: import('@trafficops/template-editor-core').ImportedProject & {name?:string}, language?:string, messages?:Record<string,string>, ai?:import('@trafficops/template-editor-core').AiPort, recovery?:(state:import('@trafficops/template-editor-core').ProjectState)=>Promise<void>}} options
 * @returns {import('@trafficops/template-editor-core').EditorHost}
 */
export function createStudioHost({ directory, isDirectoryEnabled = () => true, initial, language = 'en', messages = {}, ai, recovery } = {}) {
  const t = text => messages[text] || translateStudio(text, language);
  const clone = value => structuredClone(value);
  let state = null, savedDisk = null, savedSettings = {}, revision = 0, queue = Promise.resolve();
  function assertDirectoryEnabled() {
    if (directory && !isDirectoryEnabled()) throw new PolicyError('Folder access is available only in the installed Studio app.');
  }
  const capabilities = Object.freeze({ inlinePreview: true, preview: false, lifecycle: false, ai: Boolean(ai), locales: false, entrypoint: false, autosave: Boolean(directory), sourceExport: true, htmlExport: true });
  /** @returns {Promise<import('@trafficops/template-editor-core').ProjectState>} */
  async function open(refresh = false) {
    assertDirectoryEnabled();
    if (state && (!directory || !refresh)) return clone(state);
    let snapshot = directory ? await readDirectoryProject(directory) : initial || { files: starterProject(), folders: ['images'], settings: {} };
    assertDirectoryEnabled();
    if (directory && !Object.keys(snapshot.files).length) {
      snapshot = await syncDirectoryProject(directory, snapshot, { files: starterProject(true), folders: [] });
      assertDirectoryEnabled();
    }
    const settings = directory ? await readProjectSettings(directory) : snapshot.settings || {};
    assertDirectoryEnabled();
    savedDisk = { files: snapshot.files, folders: snapshot.folders || [] };
    savedSettings = settings;
    state = { name: directory?.name || initial?.name || t('Untitled project'), revision: ++revision, files: snapshot.files, folders: snapshot.folders || [], entrypoint: null,
      locale: language, translations: { [language]: savedSettings }, status: directory ? t('Saved to folder') : t('Local project'),
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
          if (directory) {
            const diskSettings = await readProjectSettings(directory);
            assertDirectoryEnabled();
            if (JSON.stringify(diskSettings) !== JSON.stringify(savedSettings)) throw new ConflictError('Project values changed outside Studio. Reload the folder before saving.');
            await syncDirectoryProject(directory, savedDisk, next);
            assertDirectoryEnabled();
            await writeProjectSettings(directory, settings);
            assertDirectoryEnabled();
          }
          const saved = { ...clone(next), revision: ++revision };
          if (recovery) await recovery(saved);
          state = saved; savedDisk = { files: clone(next.files), folders: [...next.folders] }; savedSettings = clone(settings);
          return clone(state);
        }, 'validation'));
        queue = task; return task;
      }, 'validation');
    },
    import(bytes, { signal } = {}) { return runOperation(signal, () => readArchive(bytes, signal), 'validation'); },
    export(next, { signal, format, locale, history }) {
      return runOperation(signal, () => {
        if (history) throw new PolicyError('Local projects have no published history.');
        let files = next.files;
        if (format === 'html') {
          const analysis = assertStudioExport(next, locale);
          files = generateProject(next.files, knownValues(analysis.definition.sections.flatMap(section => section.fields), next.translations[locale]), { locale });
        }
        return { name: `${next.name || 'project'}-${format}.zip`, mime: 'application/zip', bytes: createZip(files, { generated: format === 'html', directories: next.folders, ...(format === 'source' ? { settings: next.translations[locale] } : {}) }) };
      }, 'validation');
    },
  };
  return { language, messages, capabilities, dialect: studioDialect, project, analyzer: createStudioAnalyzer(), ...(ai ? { ai } : {}) };
}
