import { AbortError, ValidationError, readZipProject, throwIfAborted } from '@trafficops/template-editor-core';

export function readArchive(bytes, signal) {
  throwIfAborted(signal);
  if (typeof Worker === 'undefined') return Promise.resolve(readZipProject(bytes));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../archive.worker.js', import.meta.url), { type: 'module' });
    let timer;
    const finish = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new AbortError());
    worker.onmessage = ({ data }) => data.error ? finish(new ValidationError(data.error)) : finish(null, data);
    worker.onerror = event => finish(new ValidationError(event.message || 'Could not read the archive.'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new ValidationError('The archive took too long to read.')), 15000);
    worker.postMessage(bytes);
  });
}
