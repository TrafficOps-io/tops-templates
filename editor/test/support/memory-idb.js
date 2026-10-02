// In-memory indexedDB for storage tests: open + upgrade on first open, keyPath stores, get/getAll/put/delete,
// oncomplete/onabort, and fault injection. Request success precedes the durable commit.
import { MemoryDirectoryHandle, MemoryFileHandle } from './fs-access.js';

function fixtureIndexedDB({ clone = structuredClone } = {}) {
  const databases = new Map();
  const control = { nextCommitError: null, holdCommit: false, commit: null, closed: 0 };
  return { control, open(name) {
    const request = {};
    queueMicrotask(() => {
      const fresh = !databases.has(name);
      if (fresh) databases.set(name, { stores: new Map(), queue: [], active: false });
      const state = databases.get(name);
      const drain = () => { if (!state.active && state.queue.length) { state.active = true; state.queue.shift()(); } };
      const db = {
        objectStoreNames: { contains: key => state.stores.has(key) },
        createObjectStore(key, options = {}) { state.stores.set(key, { keyPath: options.keyPath, values: new Map() }); },
        close() { control.closed++; },
        transaction(keys, mode) {
          let view, pending = 0, stopped = false, started = false, queued = false;
          const waiting = [];
          const tx = { error: null, abort() { if (stopped) return; stopped = true; queueMicrotask(() => { tx.onabort?.(); state.active = false; drain(); }); }, objectStore(key) {
            if (!keys.includes(key)) throw new Error('Missing fixture store');
            const action = operation => {
              const query = {}; pending++;
              const run = () => queueMicrotask(() => {
                if (stopped) return;
                try { query.result = clone(operation(view.get(key))); query.onsuccess?.(); }
                catch (error) { query.error = tx.error = error; query.onerror?.(); tx.abort(); }
                pending--; finish();
              });
              if (started) run(); else waiting.push(run);
              return query;
            };
            return {
              get: id => action(store => store.values.get(id)),
              getAll: () => action(store => [...store.values.values()]),
              put(value, id) { const saved = clone(value); return action(store => { if (mode !== 'readwrite') throw new Error('Readonly fixture transaction'); const key = store.keyPath ? saved[store.keyPath] : id; store.values.set(key, saved); return key; }); },
              delete: id => action(store => { store.values.delete(id); }),
            };
          } };
          function finish() {
            if (pending || stopped || queued) return;
            queued = true;
            setImmediate(() => {
              queued = false;
              if (pending || stopped) return;
              const commit = () => {
                if (stopped) return;
                if (control.nextCommitError && mode === 'readwrite') { tx.error = control.nextCommitError; control.nextCommitError = null; tx.abort(); return; }
                stopped = true;
                if (mode === 'readwrite') for (const [key, value] of view) state.stores.set(key, value);
                tx.oncomplete?.(); state.active = false; drain();
              };
              if (control.holdCommit && mode === 'readwrite') { control.holdCommit = false; control.commit = commit; } else commit();
            });
          }
          state.queue.push(() => {
            view = new Map(keys.map(key => [key, clone(state.stores.get(key))]));
            started = true; waiting.forEach(run => run()); finish();
          });
          queueMicrotask(drain);
          return tx;
        },
      };
      request.result = db;
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
}

// structuredClone, except MemoryHandle instances stay by reference: browsers clone FileSystemHandle natively, and a
// plain clone would strip a MemoryHandle's methods and identity.
export function cloneKeepingHandles(value) {
  if (value instanceof MemoryDirectoryHandle || value instanceof MemoryFileHandle) return value;
  if (Array.isArray(value)) return value.map(cloneKeepingHandles);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, cloneKeepingHandles(item)]));
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneKeepingHandles(item)]));
  return structuredClone(value);
}

export const memoryIndexedDB = () => fixtureIndexedDB({ clone: cloneKeepingHandles });

// Installs globalThis.indexedDB, restores the previous global in t.after, returns the fixture control
// ({ nextCommitError, holdCommit, commit, closed }).
export function installMemoryIndexedDB(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const fixture = memoryIndexedDB();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fixture });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; });
  return fixture.control;
}
