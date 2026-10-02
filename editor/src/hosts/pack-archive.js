import { AbortError, ValidationError, createZip, throwIfAborted } from '@trafficops/template-editor-core';
import { archiveReadTimeout } from './read-archive.js';

const sizeOf = value => typeof value === 'string' ? value.length : value?.byteLength || 0;

/** createZip(files, options) in the archive worker; on the main thread where Worker is unavailable. Only the
 *  `transfer` buffers move to the worker: pass buffers the caller owns, never the editor state's.
 *  @param {Record<string, string | Uint8Array>} files @param {any} [options] @param {{ signal?: AbortSignal, transfer?: ArrayBuffer[] }} [control]
 *  @returns {Promise<Uint8Array>} */
export async function packArchive(files, options = {}, { signal, transfer = [] } = {}) {
  throwIfAborted(signal);
  if (typeof Worker === 'undefined') {
    try { return createZip(files, options); } catch (error) { throw new ValidationError(error.message, { cause: error }); }
  }
  const size = [...Object.values(files), ...(options.conversationFiles?.blobs?.values() || [])].reduce((sum, value) => sum + sizeOf(value), 0);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../archive.worker.js', import.meta.url), { type: 'module' });
    let timer;
    const finish = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new AbortError());
    worker.onmessage = ({ data }) => data.error ? finish(new ValidationError(data.error)) : finish(null, data.bytes);
    worker.onerror = event => finish(new ValidationError(event.message || 'Could not create the archive.'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new ValidationError('Creating the archive took too long.')), archiveReadTimeout(size));
    worker.postMessage({ type: 'pack', files, options }, [...new Set(transfer)]);
  });
}
