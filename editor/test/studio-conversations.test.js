import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationPort, loadConversationDocument, saveConversationDocument, cloneConversationDocument, readDirectoryConversations } from '../src/studio-conversations.js';
import { readProjectMetadata, writeProjectMetadata, writeProjectSidecar } from '../src/directory-projects.js';
import { encodePortablePayload, decodePortablePayload, validateConversationDocument } from '@trafficops/template-editor-core';
import { MemoryDirectoryHandle } from './support/fs-access.js';
import { installConversationStorage } from './support/conversation-idb.js';

const document = (projectId = 'one') => ({ schema: 1, projectId, revision: 0, threads: [{ id: 'thread-one', title: 'A', messages: [{ id: 'message-one', role: 'user', runId: 'run-one', parts: [{ type: 'text', text: 'Make it blue' }] }] }], runs: [{ id: 'run-one', threadId: 'thread-one', messageId: 'message-one', state: 'running', owner: { sessionId: 'old', fence: 1 }, base: { files: { 'image.png': new Uint8Array([0, 128, 255]) } } }] });

test('conversation persistence separates content revisions, detaches bytes, broadcasts and rejects stale writers', async t => {
  installConversationStorage(t);
  const first = createConversationPort({ projectId: 'one' }), second = createConversationPort({ projectId: 'one' });
  assert.equal((await first.load()).revision, 0);
  const events = [], unsubscribe = second.subscribe(value => events.push(value));
  t.after(unsubscribe);
  const draft = document(), saved = await first.save(draft, { expectedRevision: 0 });
  draft.runs[0].base.files['image.png'][0] = 99;
  assert.equal(saved.revision, 1);
  assert.equal((await second.load()).runs[0].base.files['image.png'][0], 0);
  assert.equal(events.length, 1);
  await assert.rejects(second.save(document(), { expectedRevision: 0 }), error => error.code === 'conflict');
  assert.equal((await first.load()).revision, 1);
});

test('save waits for commit and commit-time quota failure rolls back a successful put', async t => {
  const control = installConversationStorage(t);
  control.holdCommit = true;
  let settled = false;
  const pending = saveConversationDocument(document()).then(value => { settled = true; return value; });
  while (!control.commit) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); control.commit();
  assert.equal((await pending).revision, 1);
  control.nextCommitError = Object.assign(new Error('Quota'), { name: 'QuotaExceededError' });
  await assert.rejects(saveConversationDocument({ ...document(), revision: 1 }, { expectedRevision: 1 }), /Quota/);
  assert.equal((await loadConversationDocument('one')).revision, 1);
});

test('portable bytes round trip and schema limits reject ambiguous or unsafe history', () => {
  assert.deepEqual(decodePortablePayload(encodePortablePayload(document())), document());
  const circular = document(); circular.extra = circular;
  assert.throws(() => validateConversationDocument(circular), /circular/);
  assert.throws(() => validateConversationDocument({ ...document(), extra: { callback() {} } }), /JSON/);
  assert.throws(() => validateConversationDocument({ ...document(), threads: Array.from({ length: 101 }, (_, i) => ({ id: `t${i}` })) }), /100 threads/);
  assert.throws(() => validateConversationDocument({ ...document(), runs: [document().runs[0], document().runs[0]] }), /Duplicate/);
  assert.throws(() => decodePortablePayload('{"$trafficopsBytes":"bad=" ,"other":1}'), /binary/);
  const attachment = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;
  assert.equal(validateConversationDocument({ ...document(), attachments: [{ dataUrl: attachment }] }).attachments[0].dataUrl, attachment);
  assert.throws(() => validateConversationDocument({ ...document(), source: 'x'.repeat(2 * 1024 * 1024 + 1) }), /size limit/);
});

test('copy remaps thread/run/message references, detaches bytes and interrupts remote owners', () => {
  let next = 0;
  const source = document();
  source.runs[0].projectId = 'one'; source.runs[0].base.projectId = 'one'; source.runs[0].rebaseFrom = 'run-one';
  source.runs[0].base.translations = { en: { items: [{ id: 'run-one', projectId: 'one' }] } };
  const copy = cloneConversationDocument(source, 'copy', { newId: () => `copy-${++next}` });
  assert.equal(copy.projectId, 'copy'); assert.equal(copy.revision, 0);
  assert.notEqual(copy.threads[0].id, 'thread-one');
  assert.equal(copy.runs[0].threadId, copy.threads[0].id);
  assert.equal(copy.runs[0].messageId, copy.threads[0].messages[0].id);
  assert.equal(copy.threads[0].messages[0].runId, copy.runs[0].id);
  assert.equal(copy.runs[0].state, 'interrupted'); assert.equal(copy.runs[0].owner, undefined);
  assert.equal(copy.runs[0].projectId, 'copy'); assert.equal(copy.runs[0].base.projectId, 'copy');
  assert.equal(copy.runs[0].rebaseFrom, copy.runs[0].id);
  assert.deepEqual(copy.runs[0].base.translations, source.runs[0].base.translations);
  copy.runs[0].base.files['image.png'][0] = 10;
  assert.equal(document().runs[0].base.files['image.png'][0], 0);
});

test('folder history mirrors every save, keeps local recovery on write errors and retries on reload', async t => {
  installConversationStorage(t);
  const directory = new MemoryDirectoryHandle('one', { 'index.tpl': 'hello' });
  await writeProjectMetadata(directory, { schema: 1, projectId: 'one', kind: 'landing', name: 'One', contentRevision: 4 });
  const port = createConversationPort({ projectId: 'one', directory });
  const saved = await port.save(document(), { expectedRevision: 0 });
  assert.equal((await readDirectoryConversations(directory, 'one')).revision, 1);
  assert.equal((await readProjectMetadata(directory)).contentRevision, 4);
  const file = await (await directory.getDirectoryHandle('.trafficops')).getFileHandle('conversations.json');
  const writable = file.createWritable.bind(file);
  file.createWritable = async () => { throw new Error('Disk disconnected'); };
  const retained = await port.save({ ...saved, threads: [{ ...saved.threads[0], title: 'Retained locally' }] }, { expectedRevision: 1 });
  assert.match(retained.storageWarning, /disconnected/);
  assert.equal((await loadConversationDocument('one')).revision, 2);
  assert.equal((await readDirectoryConversations(directory, 'one')).revision, 1);
  file.createWritable = writable;
  assert.equal((await port.load()).revision, 2);
  assert.equal((await readDirectoryConversations(directory, 'one')).threads[0].title, 'Retained locally');
  assert.equal((await readProjectMetadata(directory)).metadataRevision, 2);
});

test('newer external folder history never replaces an unsaved local recovery', async t => {
  installConversationStorage(t);
  const directory = new MemoryDirectoryHandle('one');
  const port = createConversationPort({ projectId: 'one', directory });
  const directoryWriter = directory.getDirectoryHandle.bind(directory);
  directory.getDirectoryHandle = async (...args) => { if (args[1]?.create) throw new Error('Disk offline'); return directoryWriter(...args); };
  const retained = await port.save(document());
  assert.equal(retained.revision, 1);
  directory.getDirectoryHandle = directoryWriter;
  await writeProjectSidecar(directory, 'conversations.json', encodePortablePayload({ ...document(), revision: 5 }));
  const reopened = await port.load();
  assert.equal(reopened.revision, 1);
  assert.match(reopened.storageWarning, /recovery/);
  assert.equal((await loadConversationDocument('one')).revision, 1);
});
