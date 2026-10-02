import { readZipProject } from './project.js';
// Message: { bytes, history } or, from older callers, the bare bytes. Binary files and blobs are transferred back.
self.onmessage = ({ data }) => {
  try {
    const { bytes, history = false } = data instanceof Uint8Array || data instanceof ArrayBuffer ? { bytes: data } : data;
    const result = readZipProject(new Uint8Array(bytes), { history: history === true });
    const buffers = new Set([...Object.values(result.files), ...(result.conversationFiles?.blobs.values() || [])].filter(value => value instanceof Uint8Array).map(value => value.buffer));
    self.postMessage(result, [...buffers]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
