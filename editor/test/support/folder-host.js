import { createFolderHost } from '../../src/hosts/FolderHost.js';
import { createProjectInRoot } from '../../src/storage/project-root.js';
import { MemoryDirectoryHandle } from './fs-access.js';

/** A fresh in-memory project folder. No files leaves it empty, so a host opens the in-memory starter. */
export async function memoryProject({ files, folders, values, name = 'Project', kind = 'landing' } = {}) {
  const root = new MemoryDirectoryHandle('project');
  return { root, meta: await createProjectInRoot(root, { name, kind, files, folders, values }) };
}

/** A FolderHost over a fresh in-memory project folder. */
export async function memoryFolderHost({ files, folders, values, name, kind, ...options } = {}) {
  const { root, meta } = await memoryProject({ files, folders, values, name, kind });
  return createFolderHost({ root, meta, ...options });
}
