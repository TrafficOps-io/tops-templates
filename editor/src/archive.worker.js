import { readZipProject } from './project.js';
self.onmessage = ({ data }) => {
  try { self.postMessage(readZipProject(new Uint8Array(data))); }
  catch (error) { self.postMessage({ error: error.message }); }
};
