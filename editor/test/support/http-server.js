import { ConflictError, encodeProject, decodeProject, createZip, readZipProject, runOperation } from '@trafficops/template-editor-core';
import { createStudioAnalyzer } from '../../src/hosts/studio-analyzer.js';
import { studioDialect } from '../../src/studio-dialect.js';
import { starterProject } from '../../src/starter.js';

// A protocol mock, not an HttpHost replacement: all requests traverse fetch,
// JSON/base64 serialization, Response parsing and HTTP status normalization.
export function httpServer({ kind = 'page', aiEnabled = false } = {}) {
  const calls = []; let failure = null;
  let state = { name: 'Server project', files: starterProject(), folders: ['images'], revision: 1, locale: 'en', translations: { en: { title: 'Hello' } }, entrypoint: 'index.html',
    kind, status: 'draft', revisions: [], versions: [], draftHistory: [], previewEnabled: true, aiEnabled, dialect: studioDialect, canSaveTemplate: kind === 'page' };
  const analyzer = createStudioAnalyzer();
  const json = (value, status = 200) => Response.json(value, { status });
  const snapshot = async () => ({ ...structuredClone(state), files: encodeProject(state.files), ...await analyzer.analyze(state) });
  const fetchImpl = (url, init = {}) => runOperation(init.signal, async () => {
    const action = new URL(url).pathname.split('/').at(-1);
    calls.push({ url: String(url), init });
    if (failure) { const next = failure; failure = null; if (next instanceof Error) throw next; return json(next.body || { message: 'Injected failure' }, next.status); }
    const wire = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const input = wire.files ? { ...wire, files: decodeProject(wire.files) } : state;
    if (init.method === 'GET' && action === 'project') return json(await snapshot());
    if (action === 'settings') return json({ configured: true, model: 'test/model', imageModel: '' });
    if (action === 'start') return json({ run: 'opaque-session-token', timeoutMs: 900000 });
    if (['finish', 'check', 'revoke'].includes(action)) return json({ ok: true });
    if (action === 'chat') return json({ choices: [] });
    if (action === 'import') {
      try { const imported = readZipProject(new Uint8Array(await init.body.get('archive').arrayBuffer())); return json({ files: encodeProject(imported.files), folders: imported.folders, values: imported.settings }); }
      catch (error) { return json({ message: error.message }, 422); }
    }
    if (action === 'download') return new Response(createZip(input.files, { directories: input.folders, settings: input.translations[input.locale] }));
    if (action === 'validate') return json(await analyzer.analyze(input));
    if (action === 'render') return json({ files: encodeProject(await analyzer.render(input, { locale: wire.editingLocale })) });
    if (action === 'preview' || action === 'history-preview') return json({ id: 'preview-1', url: 'https://content.test/preview/index.html' });
    if (action === 'ai-kickoff') return json({ started: true });
    if (['save', 'publish', 'version', 'restore', 'unpublish', 'save-template'].includes(action)) {
      if (wire.revision !== state.revision) return json({ message: 'Conflict' }, 409);
      if (['save', 'publish', 'version', 'save-template'].includes(action)) state = { ...state, ...input };
      state.revision++;
      if (action === 'publish') { state.status = 'published'; state.revisions = [{ id: 'publication-1', number: 1, createdAt: '2026-09-18', current: true, locales: ['en'] }]; }
      if (action === 'unpublish') state.status = 'draft';
      return json({ ...await snapshot(), ...(action === 'save-template' ? { notice: 'Saved to your team.' } : {}) });
    }
    return json({ message: `Unhandled mock route ${action}` }, 404);
  });
  return { fetchImpl, calls, fail(value) { failure = value; }, state: () => state };
}
