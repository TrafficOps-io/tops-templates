// In-memory indexedDB for storage tests. Reuses the transactional fixture in conversation-idb.js
// (open + upgrade on first open, keyPath stores, get/getAll/put/delete, oncomplete/onabort, fault injection).
import { conversationIndexedDB, installConversationStorage } from './conversation-idb.js';
import { MemoryDirectoryHandle, MemoryFileHandle } from './fs-access.js';

// structuredClone, except MemoryHandle instances stay by reference: browsers clone FileSystemHandle natively, and a
// plain clone would strip a MemoryHandle's methods and identity.
export function cloneKeepingHandles(value) {
  if (value instanceof MemoryDirectoryHandle || value instanceof MemoryFileHandle) return value;
  if (Array.isArray(value)) return value.map(cloneKeepingHandles);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, cloneKeepingHandles(item)]));
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneKeepingHandles(item)]));
  return structuredClone(value);
}

export const memoryIndexedDB = () => conversationIndexedDB({ clone: cloneKeepingHandles });

// Installs globalThis.indexedDB, restores the previous global in t.after, returns the fixture control
// ({ nextCommitError, holdCommit, commit, closed }).
export function installMemoryIndexedDB(t) { return installConversationStorage(t, { clone: cloneKeepingHandles }); }
