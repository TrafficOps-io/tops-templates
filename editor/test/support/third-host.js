// @ts-check
import { ConflictError, PolicyError, runOperation, LIMITS, createZip, readZipProject } from '@trafficops/template-editor-core';

// The third host differs on the shared axes: trusted dialect, opaque revision,
// project-gated inline rendering, no generated export and no lifecycle/AI ports.
/** @returns {import('@trafficops/template-editor-core').EditorHost} */
export function thirdHost() {
  /** @type {import('@trafficops/template-editor-core').ProjectState} */
  let state = { name: 'Opaque revision', revision: 'r:0', files: { 'index.tpl.php': '<?php echo 1; ?>' }, folders: [], locale: 'en', translations: { en: {} }, entrypoint: 'index.php', status: 'Private', actions: [], history: [], availability: { inlinePreview: false, externalPreview: false, ai: false } };
  return {
    language: 'en', messages: {}, dialect: { schema: 1, id: 'fast-landings-v1', limits: LIMITS, allowedEntrypoints: ['index.html', 'index.php'] },
    capabilities: Object.freeze({ inlinePreview: true, preview: false, lifecycle: false, ai: false, locales: false, entrypoint: false, autosave: false, sourceExport: true, htmlExport: false }),
    project: {
      open: ({ signal } = {}) => runOperation(signal, () => structuredClone(state)),
      save: (next, { signal } = {}) => runOperation(signal, () => { if (next.revision !== state.revision) throw new ConflictError(); state = { ...structuredClone(next), revision: `${state.revision}:next` }; return structuredClone(state); }),
      import: (bytes, { signal } = {}) => runOperation(signal, () => readZipProject(bytes), 'validation'),
      export: (next, { signal, format }) => runOperation(signal, () => { if (format !== 'source') throw new PolicyError(); return { name: 'private.zip', mime: 'application/zip', bytes: createZip(next.files) }; }),
    },
    analyzer: {
      analyze: (next, { signal } = {}) => runOperation(signal, async () => ({ definition: null, entrypoint: next.entrypoint, pages: ['index.php'], sourceDiagnostics: [], diagnostics: [], previewAvailable: !String(next.files['index.tpl.php']).includes('<?php') })),
      render: (_next, { signal }) => runOperation(signal, () => { throw new PolicyError('This project requires server execution.'); }),
    },
  };
}
