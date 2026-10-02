import { createZip, readZipProject } from './project.js';
// Read: { bytes, history } or, from older callers, the bare bytes. Binary files and blobs are transferred back.
// Pack: { type: 'pack', files, options } → { bytes } (createZip), transferred back.
self.onmessage = ({ data }) => {
  try {
    if (data?.type === 'pack') {
      const bytes = createZip(data.files, data.options);
      self.postMessage({ bytes }, [bytes.buffer]);
      return;
    }
    const { bytes, history = false } = data instanceof Uint8Array || data instanceof ArrayBuffer ? { bytes: data } : data;
    const result = readZipProject(new Uint8Array(bytes), { history: history === true });
    const buffers = new Set([...Object.values(result.files), ...(result.conversationFiles?.blobs.values() || [])].filter(value => value instanceof Uint8Array).map(value => value.buffer));
    self.postMessage(result, [...buffers]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
