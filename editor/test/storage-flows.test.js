import assert from 'node:assert/strict';
import test from 'node:test';
import { accessLost, duplicateDecision, duplicatePermissionPlan, importIdentity, openFolderDecision, pendingEditsApply, reconnectDecision, reopenCandidate, rootDecision, rootReachable, storageLabels } from '../src/storage/flows.js';
import { createProjectMeta } from '../src/storage/project-meta.js';
import { classifyFolder } from '../src/storage/roots.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

const meta = (projectId = 'p1', name = 'Launch') => ({ schema: 1, projectId, kind: 'landing', name, metadataRevision: 0 });
async function projectFolder(name, projectId = 'p1') {
  const root = new MemoryDirectoryHandle(name, { 'index.tpl': 'x' });
  await createProjectMeta(root, meta(projectId));
  return root;
}
const domError = name => Object.assign(new Error(name), { name });

test('rootDecision: an empty folder is used, files offer a subfolder, a project offers to open it, damage is reported', async () => {
  assert.deepEqual(rootDecision(await classifyFolder(new MemoryDirectoryHandle('a', { '.DS_Store': 'x' }))), { action: 'use' });
  assert.deepEqual(rootDecision(await classifyFolder(new MemoryDirectoryHandle('a', { 'notes.txt': 'x' }))), { action: 'offer-subfolder' });
  const decision = rootDecision(await classifyFolder(await projectFolder('a')));
  assert.equal(decision.action, 'offer-open');
  assert.equal(decision.meta.projectId, 'p1');
  assert.deepEqual(rootDecision({ status: 'project', meta: null, error: 'bad json' }), { action: 'damaged', error: 'bad json' });
  assert.throws(() => rootDecision({ status: 'other' }), TypeError);
});

test('openFolderDecision: project opens, files are adopted, empty gets a blank project', async () => {
  assert.deepEqual(openFolderDecision({ status: 'empty' }), { action: 'blank' });
  assert.deepEqual(openFolderDecision({ status: 'files' }), { action: 'adopt' });
  assert.deepEqual(openFolderDecision({ status: 'project', meta: meta() }), { action: 'open', meta: meta() });
  assert.equal(openFolderDecision({ status: 'project', meta: null }).action, 'damaged');
  assert.throws(() => openFolderDecision(undefined), TypeError);
});

test('reconnectDecision requires a project folder with the same projectId', () => {
  assert.deepEqual(reconnectDecision('p1', { status: 'project', meta: meta('p1') }), { ok: true, meta: meta('p1') });
  assert.match(reconnectDecision('p1', { status: 'project', meta: meta('p2') }).message, /different project/);
  assert.match(reconnectDecision('p1', { status: 'files' }).message, /not a Studio project/);
  assert.match(reconnectDecision('p1', { status: 'empty' }).message, /not a Studio project/);
  assert.match(reconnectDecision('p1', { status: 'project', meta: null, error: 'bad' }).message, /cannot be read: bad/);
});

test('importIdentity keeps an unknown projectId, copies a known one under a new id, and ids archives without metadata (D1)', () => {
  const newId = () => 'fresh';
  assert.deepEqual(importIdentity({ projectId: 'p1' }, ['p2'], { newId }), { projectId: 'p1', copy: false });
  assert.deepEqual(importIdentity({ projectId: 'p1' }, new Set(['p1']), { newId }), { projectId: 'fresh', copy: true });
  assert.deepEqual(importIdentity(null, ['p1'], { newId }), { projectId: 'fresh', copy: false });
  assert.deepEqual(importIdentity({ projectId: '' }, [], { newId }), { projectId: 'fresh', copy: false });
  assert.equal(importIdentity({ projectId: 'p1' }, undefined).projectId, 'p1');
  assert.match(importIdentity(null, []).projectId, /^[0-9a-f-]{36}$/);
});

test('duplicateDecision: a different, accessible folder with the same projectId is a copy', async () => {
  const original = await projectFolder('original'), copy = await projectFolder('copy');
  const known = { projectId: 'p1', name: 'Launch', handle: original };
  assert.deepEqual(await duplicateDecision(null, copy), { action: 'open' });
  assert.deepEqual(await duplicateDecision(known, original), { action: 'open' }, 'the same folder is not a copy');
  assert.deepEqual(await duplicateDecision(known, copy), { action: 'make-independent', original: known });
  // Without access to the original, nothing proves it still exists: open (and rebind).
  original.permission = 'prompt';
  assert.deepEqual(await duplicateDecision(known, copy), { action: 'open' });
  original.permission = 'granted';
  // The original was moved or deleted (its handle throws), or now holds another project.
  assert.deepEqual(await duplicateDecision(known, copy, { readMeta: async () => { throw domError('NotFoundError'); } }), { action: 'open' });
  assert.deepEqual(await duplicateDecision(known, copy, { readMeta: async () => meta('p9') }), { action: 'open' });
  // A stale handle whose isSameEntry rejects falls through to the access and content checks.
  const stale = { projectId: 'p1', handle: { isSameEntry: async () => { throw domError('NotFoundError'); } } };
  assert.deepEqual(await duplicateDecision(stale, copy, { access: async () => 'granted', readMeta: async () => { throw domError('NotFoundError'); } }), { action: 'open' });
});

test('duplicatePermissionPlan gives every prompt its own click (D8)', () => {
  assert.deepEqual(duplicatePermissionPlan('granted'), { steps: ['pick-destination'] });
  assert.deepEqual(duplicatePermissionPlan('prompt'), { steps: ['grant-source', 'pick-destination'] });
  assert.deepEqual(duplicatePermissionPlan('denied', 'folder'), { steps: ['grant-source', 'pick-destination'] });
  assert.deepEqual(duplicatePermissionPlan('granted', 'opfs'), { steps: ['opfs'] });
});

test('accessLost recognises permission and missing-folder failures through wrapped causes', () => {
  for (const name of ['NotAllowedError', 'NotFoundError', 'SecurityError']) assert.equal(accessLost(domError(name)), true, name);
  const wrapped = new Error('policy', { cause: new Error('transport', { cause: domError('NotFoundError') }) });
  assert.equal(accessLost(wrapped), true);
  assert.equal(accessLost(new Error('conflict')), false);
  assert.equal(accessLost(domError('QuotaExceededError')), false);
  assert.equal(accessLost(null), false);
  const loop = new Error('loop'); loop.cause = loop;
  assert.equal(accessLost(loop), false);
});

test('rootReachable: a folder that cannot be listed for an access reason is lost; other failures propagate', async () => {
  assert.equal(await rootReachable(new MemoryDirectoryHandle('a')), true);
  assert.equal(await rootReachable(new MemoryDirectoryHandle('a', { 'index.tpl': 'x' })), true);
  const failing = name => ({ keys: async function* () { throw domError(name); } });
  assert.equal(await rootReachable(failing('NotFoundError')), false);
  assert.equal(await rootReachable(failing('NotAllowedError')), false);
  await assert.rejects(rootReachable(failing('TypeMismatchError')), /TypeMismatchError/);
});

test('reopenCandidate returns the last project only when access is already granted', () => {
  const known = [{ projectId: 'a', access: 'granted' }, { projectId: 'b', access: 'prompt' }];
  assert.equal(reopenCandidate(known, 'a'), known[0]);
  assert.equal(reopenCandidate(known, 'b'), null);
  assert.equal(reopenCandidate(known, 'c'), null);
  assert.equal(reopenCandidate(known, null), null);
});

test('pendingEditsApply compares the reconnected files with the editor baseline', () => {
  const baseline = { 'index.tpl': 'x', 'a.png': new Uint8Array([1, 2]) };
  assert.equal(pendingEditsApply(baseline, { 'index.tpl': 'x', 'a.png': new Uint8Array([1, 2]) }), true);
  assert.equal(pendingEditsApply(baseline, { 'index.tpl': 'y', 'a.png': new Uint8Array([1, 2]) }), false);
  assert.equal(pendingEditsApply(baseline, { 'index.tpl': 'x' }), false);
  assert.equal(pendingEditsApply(baseline, { 'index.tpl': 'x', 'b.png': new Uint8Array([1, 2]) }), false);
  assert.equal(pendingEditsApply(null, {}), false);
});

test('storageLabels name the folder, or warn that browser storage needs backups (D9)', () => {
  assert.equal(storageLabels('folder', 'site').summary, 'Saved to folder site');
  const opfs = storageLabels('opfs');
  assert.equal(opfs.summary, 'Stored in this browser');
  assert.match(opfs.help, /export a backup ZIP regularly/);
});
