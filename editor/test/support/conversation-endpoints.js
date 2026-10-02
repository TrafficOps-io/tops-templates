import { createMemoryConversationStore, sha256Hex, CONVERSATION_LIMITS } from '@trafficops/template-editor-core';

const json = (value, status = 200) => Response.json(value, { status });

/** The host conversation contract (editor/README.md) as a fetch-style handler, backed by any ConversationStore
 *  (the reference memory store by default). `segments` are the path segments after the host endpoint, e.g.
 *  `['conversations', id]`. Returns `undefined` for paths outside the contract so callers can fall through. */
export function conversationHandler(store = createMemoryConversationStore()) {
  async function route(collection, id, request) {
    const method = request.method, match = (request.headers.get('If-Match') || '').match(/^"(\d+)"$/), expectedRevision = match ? Number(match[1]) : null;
    const body = ['GET', 'HEAD'].includes(method) ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
    const fail = error => json({ message: error.message }, error.code === 'conflict' ? 409 : 422);
    if (collection === 'conversations' && id !== undefined && !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return json({ message: 'Dialogue IDs must use letters, digits, "-" or "_".' }, 422);
    if (collection === 'conversation-blobs' && !/^[a-f0-9]{64}$/.test(id)) return json({ message: 'Invalid attachment hash.' }, 422);
    if (collection === 'conversations' && id === undefined && method === 'GET') return json({ threads: await store.listThreads() });
    if (collection === 'conversations' && id !== undefined && ['PUT', 'DELETE'].includes(method)) {
      if (expectedRevision === null) return json({ message: 'If-Match with the thread revision is required.' }, 428);
      if (method === 'DELETE') { try { await store.deleteThread(id, { expectedRevision }); return new Response(null, { status: 204 }); } catch (error) { return fail(error); } }
      if (body.byteLength > CONVERSATION_LIMITS.threadEncoded) return json({ message: 'A dialogue exceeds 16 MiB. Start a new dialogue or remove old results.' }, 413);
      let thread; try { thread = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ message: 'The dialogue is not valid JSON.' }, 422); }
      if (thread?.id !== id) return json({ message: 'The dialogue id does not match its path.' }, 422);
      try { return json(await store.writeThread(thread, { expectedRevision })); } catch (error) { return fail(error); }
    }
    if (collection === 'conversation-blobs' && method === 'PUT') {
      if (body.byteLength > CONVERSATION_LIMITS.blob) return json({ message: 'A conversation attachment exceeds 24 MiB.' }, 413);
      if (await sha256Hex(body) !== id) return json({ message: 'The conversation attachment does not match its hash.' }, 422);
      const existed = await store.getBlob(id).then(() => true, () => false);
      await store.putBlob(id, body); return new Response(null, { status: existed ? 200 : 201 });
    }
    if (collection === 'conversation-blobs' && method === 'GET') {
      try { return new Response(await store.getBlob(id), { headers: { 'Content-Type': 'application/octet-stream' } }); } catch { return json({ message: 'Not found' }, 404); }
    }
    return json({ message: `Unhandled conversation route ${method} ${collection}` }, 405);
  }
  /** @param {Request} request @param {string[]} segments */
  return async function handle(request, [collection, id, ...extra]) {
    if (!['conversations', 'conversation-blobs'].includes(collection)) return undefined;
    if (extra.length || (collection === 'conversation-blobs' && id === undefined)) return json({ message: 'Not found' }, 404);
    return route(collection, id === undefined ? undefined : decodeURIComponent(id), request);
  };
}

/** Adapts a buffered node:http request to a fetch Request, so node servers can reuse fetch-style handlers. */
export function fetchRequest(nodeRequest, body, origin = 'http://localhost') {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  return new Request(new URL(nodeRequest.url, origin), { method: nodeRequest.method, headers, ...(['GET', 'HEAD'].includes(nodeRequest.method) || !body?.length ? {} : { body }) });
}

/** Writes a fetch Response to a node:http response. */
export async function sendResponse(nodeResponse, response) {
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers)); nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}
