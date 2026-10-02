// In-memory indexedDB for storage tests. Reuses the transactional fixture in conversation-idb.js
// (open + upgrade on first open, keyPath stores, get/getAll/put/delete, oncomplete/onabort, fault injection).
export { conversationIndexedDB as memoryIndexedDB } from './conversation-idb.js';
import { installConversationStorage } from './conversation-idb.js';

// Installs globalThis.indexedDB, restores the previous global in t.after, returns the fixture control
// ({ nextCommitError, holdCommit, commit, closed }).
export function installMemoryIndexedDB(t) { return installConversationStorage(t); }
