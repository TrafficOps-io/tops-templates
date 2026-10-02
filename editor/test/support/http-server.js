import { ConflictError, encodeProject, decodeProject, createZip, readZipProject, runOperation, createMemoryConversationStore, sha256Hex, CONVERSATION_LIMITS } from '@trafficops/template-editor-core';
import { createStudioAnalyzer } from '../../src/hosts/studio-analyzer.js';
import { studioDialect } from '../../src/studio-dialect.js';
import { starterProject } from '../../src/starter.js';

// A protocol mock, not an HttpHost replacement: all requests traverse fetch,
// JSON/base64 serialization, Response parsing and HTTP status normalization.
export function httpServer({ kind = 'page', aiEnabled = false, conversationsEnabled } = {}) {
  const calls = []; let failure = null;
  const conversations = createMemoryConversationStore();
  let state = { name: 'Server project', files: starterProject(), folders: ['images'], revision: 1, locale: 'en', translations: { en: { title: 'Hello' } }, entrypoint: 'index.html',
    kind, status: 'draft', revisions: [], versions: [], draftHistory: [], previewEnabled: true, aiEnabled, ...(conversationsEnabled !== undefined ? { conversationsEnabled } : {}), dialect: studioDialect, canSaveTemplate: kind === 'page' };
  const analyzer = createStudioAnalyzer();
  const json = (value, status = 200) => Response.json(value, { status });
  const snapshot = async () => ({ ...structuredClone(state), files: encodeProject(state.files), ...await analyzer.analyze(state) });
  // The host conversation contract, backed by the reference memory store.
  async function conversationRoute(collection, id, init) {
    const method = init.method || 'GET', match = /^"(\d+)"$/.exec(init.headers?.['If-Match'] || ''), expectedRevision = match ? Number(match[1]) : null;
    const body = init.body === undefined ? new Uint8Array() : new Uint8Array(await new Response(init.body).arrayBuffer());
    const fail = error => json({ message: error.message }, error.code === 'conflict' ? 409 : 422);
    if (collection === 'conversations' && id === undefined && method === 'GET') return json({ threads: await conversations.listThreads() });
    if (collection === 'conversations' && id !== undefined && ['PUT', 'DELETE'].includes(method)) {
      if (expectedRevision === null) return json({ message: 'If-Match with the thread revision is required.' }, 428);
      if (method === 'DELETE') { try { await conversations.deleteThread(id, { expectedRevision }); return new Response(null, { status: 204 }); } catch (error) { return fail(error); } }
      if (body.byteLength > CONVERSATION_LIMITS.threadEncoded) return json({ message: 'A dialogue exceeds 16 MiB. Start a new dialogue or remove old results.' }, 413);
      let thread; try { thread = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ message: 'The dialogue is not valid JSON.' }, 422); }
      if (thread?.id !== id) return json({ message: 'The dialogue id does not match its path.' }, 422);
      try { return json(await conversations.writeThread(thread, { expectedRevision })); } catch (error) { return fail(error); }
    }
    if (collection === 'conversation-blobs' && id !== undefined && method === 'PUT') {
      if (body.byteLength > CONVERSATION_LIMITS.blob) return json({ message: 'A conversation attachment exceeds 24 MiB.' }, 413);
      if (await sha256Hex(body) !== id) return json({ message: 'The conversation attachment does not match its hash.' }, 422);
      const existed = await conversations.getBlob(id).then(() => true, () => false);
      await conversations.putBlob(id, body); return new Response(null, { status: existed ? 200 : 201 });
    }
    if (collection === 'conversation-blobs' && id !== undefined && method === 'GET') {
      try { return new Response(await conversations.getBlob(id), { headers: { 'Content-Type': 'application/octet-stream' } }); } catch { return json({ message: 'Not found' }, 404); }
    }
    return json({ message: `Unhandled conversation route ${method} ${collection}` }, 405);
  }
  const fetchImpl = (url, init = {}) => runOperation(init.signal, async () => {
    const segments = new URL(url).pathname.split('/'), action = segments.at(-1);
    calls.push({ url: String(url), init });
    if (failure) { const next = failure; failure = null; if (next instanceof Error) throw next; return json(next.body || { message: 'Injected failure' }, next.status); }
    if (action === 'conversations') return conversationRoute(action, undefined, init);
    if (['conversations', 'conversation-blobs'].includes(segments.at(-2))) return conversationRoute(segments.at(-2), decodeURIComponent(action), init);
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
  return { fetchImpl, calls, conversations, fail(value) { failure = value; }, state: () => state };
}
