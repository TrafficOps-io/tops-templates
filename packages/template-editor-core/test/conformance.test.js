import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, runHostConformance, runOperation, ConflictError, PolicyError } from '../src/index.js';

const knownIds = ['third-party-v1'];
function host({ ai = false, conversations } = {}) {
  let state = { name: 'Conformance', revision: 1, files: { 'index.html': '<h1>x</h1>' }, folders: [], locale: 'en', translations: { en: {} }, entrypoint: 'index.html', status: '', actions: [], history: [], availability: { inlinePreview: false, externalPreview: false, ai } };
  return {
    language: 'en', messages: {}, dialect: { schema: 1, id: 'third-party-v1', limits: LIMITS, allowedEntrypoints: ['index.html'] },
    capabilities: Object.freeze({ inlinePreview: false, preview: false, lifecycle: false, ai, locales: false, entrypoint: false, autosave: false, sourceExport: false, htmlExport: false }),
    project: {
      open: ({ signal } = {}) => runOperation(signal, () => structuredClone(state)),
      save: (next, { signal } = {}) => runOperation(signal, () => { if (next.revision !== state.revision) throw new ConflictError(); state = { ...structuredClone(next), revision: state.revision + 1 }; return structuredClone(state); }),
      import: (_bytes, { signal } = {}) => runOperation(signal, () => { throw new PolicyError(); }),
      export: (_next, { signal } = {}) => runOperation(signal, () => { throw new PolicyError(); }),
    },
    analyzer: {
      analyze: (next, { signal } = {}) => runOperation(signal, async () => ({ definition: null, entrypoint: next.entrypoint, pages: ['index.html'], sourceDiagnostics: [], diagnostics: [], previewAvailable: false })),
      render: (_next, { signal }) => runOperation(signal, () => { throw new PolicyError(); }),
    },
    ...(ai ? { ai: { begin: async () => ({}), finish: async () => {}, settings: { owner: 'host', load: async () => ({}), test: async () => ({}) } } } : {}),
    ...(conversations ? { conversations } : {}),
  };
}
const port = { projectId: 'p', load: async () => ({ schema: 1, revision: 0, threads: [], runs: [] }), save: async document => document };

test('AI hosts without a conversations port are rejected', async () => {
  await assert.rejects(runHostConformance(() => host({ ai: true }), { knownIds }), /ai hosts must provide a conversations port/);
  await assert.rejects(runHostConformance(() => host({ ai: true, conversations: { projectId: 'p', load: port.load } }), { knownIds }), /conversations port/);
});

test('AI hosts with conversations load/save and non-AI hosts without them conform', async () => {
  assert.ok((await runHostConformance(() => host({ ai: true, conversations: port }), { knownIds })).checks.includes('shape'));
  assert.ok((await runHostConformance(() => host(), { knownIds })).checks.includes('shape'));
});
