import { AbortError, ValidationError, readZipProject, throwIfAborted } from '@trafficops/template-editor-core';

/** 15 s, or 1 s per 2 MiB for large editable ZIPs. */
export const archiveReadTimeout = length => Math.max(15000, length / (2 * 1024 * 1024) * 1000);

/** history: Studio's editable-project import (512 MiB, `.trafficops/conversations/**`); see readZipProject.
 *  With a worker, `bytes` is transferred (detached): copy it first if you still need it. A view over part of a larger
 *  buffer is copied instead, so unrelated data is never detached.
 *  @param {Uint8Array} bytes @param {{ history?: boolean, signal?: AbortSignal }} [options] */
export async function readArchive(bytes, { history = false, signal } = {}) {
  throwIfAborted(signal);
  if (typeof Worker === 'undefined') {
    try { return readZipProject(bytes, { history }); } catch (error) { throw new ValidationError(error.message, { cause: error }); }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../archive.worker.js', import.meta.url), { type: 'module' });
    let timer;
    const finish = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new AbortError());
    worker.onmessage = ({ data }) => data.error ? finish(new ValidationError(data.error)) : finish(null, data);
    worker.onerror = event => finish(new ValidationError(event.message || 'Could not read the archive.'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new ValidationError('The archive took too long to read.')), archiveReadTimeout(bytes.length));
    const input = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    worker.postMessage({ bytes: input, history }, [input.buffer]);
  });
}
