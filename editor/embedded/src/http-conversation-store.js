// @ts-check
import { ConflictError, ValidationError, normalizeError, runOperation, sha256Hex } from '@trafficops/template-editor-core';

const MISSING_BLOB = 'A conversation attachment is missing on the server.', TOO_LARGE = 'The dialogue exceeds the server limit.';
// The protocol's id alphabet keeps every path segment URL-safe; runtime ids (UUIDs, initial-*-<len>-<hash>) conform.
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/, SHA256 = /^[a-f0-9]{64}$/;
const threadPath = id => { if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new ValidationError('Dialogue IDs sent to the host must use letters, digits, "-" or "_".'); return `conversations/${id}`; };
const blobPath = sha => { if (typeof sha !== 'string' || !SHA256.test(sha)) throw new ValidationError('A conversation attachment hash must be 64 lowercase hex digits.'); return `conversation-blobs/${sha}`; };

/** ConversationStore over the host's HTTP conversation contract. Hosts own blob GC, and HTTP has no cross-tab signal,
 *  so there is no watch and no collectGarbage.
 * @param {{endpoint:string, csrf:string, fetchImpl?:typeof fetch}} options
 * @returns {import('@trafficops/template-editor-core').ConversationStore} */
export function createHttpConversationStore({ endpoint, csrf, fetchImpl = globalThis.fetch }) {
  const base = endpoint.replace(/\/+$/, '');
  /** @param {string} path @param {{method?:string, body?:BodyInit, type?:string, accept?:string, revision?:number, signal?:AbortSignal, missing?:string}} options */
  async function request(path, { method = 'GET', body, type, accept = 'application/json', revision, signal, missing } = {}) {
    const response = await runOperation(signal, () => fetchImpl(`${base}/${path}`, { method, credentials: 'same-origin', signal,
      headers: { Accept: accept, 'X-CSRF-TOKEN': csrf, ...(type ? { 'Content-Type': type } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}) },
      ...(body !== undefined ? { body } : {}) }));
    if (response.ok || (method === 'DELETE' && response.status === 404)) return response;
    const payload = await runOperation(signal, () => response.json().catch(() => ({})));
    const message = payload.message || payload.error?.message || Object.values(payload.errors || {}).flat().join(' ') || '';
    const details = { status: response.status, diagnostics: payload.diagnostics || [] };
    if (response.status === 409) throw new ConflictError(message || undefined, details);
    if (response.status === 422) throw new ValidationError(message || undefined, details);
    if (response.status === 413) throw Object.assign(new Error(message || TOO_LARGE), { status: 413 });
    if (response.status === 404 && missing) throw Object.assign(new Error(missing), { status: 404 });
    throw normalizeError(Object.assign(new Error(message || 'The request failed. Try again.'), { status: response.status, payload }));
  }
  return {
    async listThreads({ signal } = {}) {
      const response = await request('conversations', { signal }), payload = await runOperation(signal, () => response.json());
      if (!Array.isArray(payload?.threads)) throw new Error('The server returned an invalid conversation list.');
      return payload.threads;
    },
    async writeThread(value, { expectedRevision, signal }) {
      const response = await request(threadPath(value.id), { method: 'PUT', body: JSON.stringify(value), type: 'application/json', revision: expectedRevision, signal });
      const { revision } = await runOperation(signal, () => response.json());
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('The server returned an invalid conversation revision.');
      return { revision };
    },
    async deleteThread(id, { expectedRevision, signal }) {
      await request(threadPath(id), { method: 'DELETE', revision: expectedRevision, signal });
    },
    async putBlob(sha256, bytes, { signal } = {}) {
      await request(blobPath(sha256), { method: 'PUT', body: new Uint8Array(bytes), type: 'application/octet-stream', signal });
    },
    async getBlob(sha256, { signal } = {}) {
      const response = await request(blobPath(sha256), { accept: 'application/octet-stream', signal, missing: MISSING_BLOB });
      const bytes = new Uint8Array(await runOperation(signal, () => response.arrayBuffer()));
      if (await sha256Hex(bytes) !== sha256) throw new Error('A conversation attachment is damaged on the server.');
      return bytes;
    },
  };
}
