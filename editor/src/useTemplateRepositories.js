import { useEffect, useRef, useState } from 'react';
import { DEFAULT_REPOSITORIES, REPOSITORIES_KEY, fetchRepositoryIndex, readRepositories, repositoryUrl, saveRepositories } from './template-repositories.js';

export function useTemplateRepositories() {
  const [initial] = useState(() => {
    try { return { repositories: readRepositories(localStorage, location.href), error: '' }; }
    catch { return { repositories: readRepositories({ getItem: () => null }, location.href), error: 'Saved repositories could not be read. Changes will replace the saved list.' }; }
  });
  const [repositories, setRepositories] = useState(initial.repositories), [error, setError] = useState(initial.error);
  const records = useRef(repositories), requests = useRef(new Map());
  const canPersist = useRef(!initial.error);
  function commit(next, persist = true) {
    if (persist) {
      try { saveRepositories(localStorage, next); canPersist.current = true; setError(''); }
      catch { throw new Error('Repositories could not be saved in this browser. Check available storage and browser permissions.'); }
    }
    records.current = next; setRepositories(next);
  }
  async function refresh(id) {
    const record = records.current.find(item => item.id === id);
    if (!record) return;
    requests.current.get(id)?.abort();
    const controller = new AbortController(); requests.current.set(id, controller);
    commit(records.current.map(item => item.id === id ? { ...item, loading: true, error: '' } : item), false);
    try {
      const catalog = await fetchRepositoryIndex(record.url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const next = records.current.map(item => item.id === id ? { ...item, catalog, index: catalog.index, resolvedUrl: catalog.resolvedUrl, updatedAt: Date.now(), loading: false, error: '' } : item);
      try { commit(next, canPersist.current); }
      catch (cause) { commit(next, false); setError(`${cause.message} The refreshed catalog is available for this session.`); }
    } catch (cause) {
      if (!controller.signal.aborted) commit(records.current.map(item => item.id === id ? { ...item, loading: false, error: cause.message } : item), false);
    } finally { if (requests.current.get(id) === controller) requests.current.delete(id); }
  }
  async function add(input) {
    const url = repositoryUrl(input);
    if (records.current.some(item => item.url === url)) throw new Error('This repository is already added.');
    if (records.current.length >= 50) throw new Error('You can add up to 50 repositories.');
    const catalog = await fetchRepositoryIndex(url);
    if (records.current.some(item => item.url === url)) throw new Error('This repository is already added.');
    const builtin = DEFAULT_REPOSITORIES.some(entry => url === repositoryUrl(entry.path, location.href));
    commit([...records.current, { id: crypto.randomUUID(), url, builtin, enabled: true, catalog, index: catalog.index, resolvedUrl: catalog.resolvedUrl, updatedAt: Date.now() }]);
  }
  function enable(id, enabled) {
    commit(records.current.map(item => item.id === id ? { ...item, enabled, loading: false } : item));
    requests.current.get(id)?.abort(); requests.current.delete(id);
    if (enabled) refresh(id);
  }
  async function remove(id) {
    commit(records.current.filter(item => item.id !== id));
    requests.current.get(id)?.abort(); requests.current.delete(id);
    try { await globalThis.caches?.delete(`trafficops-template-repository-${id}`); } catch { /* Best-effort cache cleanup. */ }
  }
  useEffect(() => {
    for (const record of records.current) if (record.enabled) refresh(record.id);
    const sync = event => {
      if (event.key !== REPOSITORIES_KEY && event.key !== null) return;
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
      try { commit(readRepositories(localStorage, location.href), false); canPersist.current = true; setError(''); }
      catch { setError('Repositories changed in another tab but could not be read. Reload to try again.'); }
    };
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('storage', sync); for (const controller of requests.current.values()) controller.abort(); requests.current.clear(); };
  }, []);
  return { repositories, error, add, refresh, enable, remove };
}
