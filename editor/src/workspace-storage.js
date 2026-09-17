// A recovery copy also retains ZIP projects and unsaved edits after a restart.
const DATABASE = 'trafficops-landing-workspace';
async function transact(mode, operation) {
  if (typeof indexedDB === 'undefined') { if (mode === 'readwrite') throw new Error('Browser storage is unavailable.'); return null; }
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('workspace', mode);
      const request = operation(transaction.objectStore('workspace'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Could not save the workspace.'));
    });
  } finally { database.close(); }
}
export const loadWorkspace = () => transact('readonly', store => store.get('last'));
export const saveWorkspace = workspace => transact('readwrite', store => store.put(workspace, 'last'));
