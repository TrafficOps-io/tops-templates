import { readZipProject } from './project.js';
// Message: { bytes, history } or, from older callers, the bare bytes.
self.onmessage = ({ data }) => {
  try {
    const { bytes, history = false } = data instanceof Uint8Array || data instanceof ArrayBuffer ? { bytes: data } : data;
    self.postMessage(readZipProject(new Uint8Array(bytes), { history: history === true }));
  } catch (error) { self.postMessage({ error: error.message }); }
};
