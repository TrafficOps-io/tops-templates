import test from 'node:test';
import { conversationStoreContract } from '../src/conversation-store-contract.js';
import { createMemoryConversationStore } from '../src/memory-conversation-store.js';

for (const contract of conversationStoreContract) test(`memory store: ${contract.name}`, () => contract.run(options => createMemoryConversationStore(options)));
