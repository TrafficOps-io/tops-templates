import { readZip } from './project.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ files: readZip(new Uint8Array(data)) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
