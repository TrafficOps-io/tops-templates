import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePortableHistory, transferFileChanges, sameProjectSnapshot } from '../src/project-transfer.js';

test('continuing a portable backup adds history without replacing a live local run', () => {
  const local = { schema: 1, projectId: 'project-one', revision: 8, threads: [{ id: 'thread-one', title: 'Current title', messages: [{ id: 'msg-one', createdAt: 1, prompt: 'Current request' }] }], runs: [{ id: 'run-one', threadId: 'thread-one', state: 'running', owner: { sessionId: 'local-owner' } }] };
  const backup = { schema: 1, projectId: 'project-one', revision: 4, threads: [{ id: 'thread-one', title: 'Old title', messages: [{ id: 'msg-one', prompt: 'Old request' }, { id: 'msg-two', createdAt: 2, prompt: 'Imported reply' }] }], runs: [{ id: 'run-one', state: 'interrupted' }, { id: 'run-two', state: 'ready', result: { files: { 'img.png': new Uint8Array([1, 2, 3]) } } }] };
  const merged = mergePortableHistory(local, backup);
  assert.equal(merged.revision, 8);
  assert.equal(merged.threads[0].title, 'Current title');
  assert.equal(merged.threads[0].messages[0].prompt, 'Current request');
  assert.equal(merged.threads[0].messages.length, 2);
  assert.equal(merged.runs[0].state, 'running');
  assert.equal(merged.runs[0].owner.sessionId, 'local-owner');
  assert.deepEqual(merged.runs[1].result.files['img.png'], new Uint8Array([1, 2, 3]));
  merged.runs[1].result.files['img.png'][0] = 7;
  assert.equal(backup.runs[1].result.files['img.png'][0], 1);
  assert.throws(() => mergePortableHistory(local, { ...backup, projectId: 'different-project' }), /another project/);
});

test('folder review reports binary changes, removals and added files', () => {
  const previous = { files: { 'index.tpl': 'same', 'removed.css': 'body {}', 'img.png': new Uint8Array([1, 2]) }, folders: ['images'], settings: { content: { title: 'one' } } };
  const next = { files: { 'index.tpl': 'same', 'added.css': 'h1 {}', 'img.png': new Uint8Array([1, 3]) }, folders: ['images'], settings: { content: { title: 'one' } } };
  assert.deepEqual(transferFileChanges(previous, next), [{ path: 'added.css', status: 'Added' }, { path: 'img.png', status: 'Changed' }, { path: 'removed.css', status: 'Deleted' }]);
  assert.equal(sameProjectSnapshot(previous, structuredClone(previous)), true);
  assert.equal(sameProjectSnapshot(previous, next), false);
  assert.equal(sameProjectSnapshot(previous, { ...previous, settings: { content: { title: 'two' } } }), false);
});
