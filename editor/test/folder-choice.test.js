import assert from 'node:assert/strict';
import test from 'node:test';
import { createFolderChoice } from '../src/folder-choice.js';
import { createProjectMeta } from '../src/storage/project-meta.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';

// A picker that returns the queued folders in order (null = cancelled) and counts its synchronous calls.
function setup({ mode = 'folder', folders = [] } = {}) {
  const shown = [], queue = [...folders], opfs = new MemoryDirectoryHandle('projects'), removed = [];
  const picker = { calls: 0 };
  const choice = createFolderChoice({
    show: value => shown.push(value), mode: () => mode, newId: () => 'new-id',
    pickFolder: () => { picker.calls++; return Promise.resolve(queue.shift() ?? null); },
    createOpfsRoot: async id => opfs.getDirectoryHandle(id, { create: true }),
    deleteOpfsRoot: async name => { removed.push(name); await opfs.removeEntry(name, { recursive: true }); },
  });
  const question = () => shown.at(-1);
  return { choice, shown, question, picker, opfs, removed };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function untilAsked(question) { for (let index = 0; index < 50 && !question(); index++) await tick(); assert.ok(question(), 'a question is shown'); return question(); }
async function project(name) {
  const root = new MemoryDirectoryHandle(name, { 'index.tpl': 'x' });
  await createProjectMeta(root, { schema: 1, projectId: 'p1', kind: 'landing', name: 'Launch', metadataRevision: 0 });
  return root;
}

test('chooseRoot opens the picker synchronously and uses an empty folder as is', async () => {
  const empty = new MemoryDirectoryHandle('empty'), { choice, picker } = setup({ folders: [empty] });
  const rooting = choice.chooseRoot('landing', 'Launch');
  assert.equal(picker.calls, 1, 'the picker opens before any await (D8)');
  assert.deepEqual(await rooting, { root: empty });
});

test('a cancelled picker resolves null', async () => {
  const { choice } = setup({ folders: [null] });
  assert.equal(await choice.chooseRoot('landing', 'Launch'), null);
});

test('a folder with files offers a subfolder; "Choose another…" picks again inside the answering click', async () => {
  const busy = new MemoryDirectoryHandle('busy', { 'notes.txt': 'x' }), empty = new MemoryDirectoryHandle('empty');
  const { choice, question, picker } = setup({ folders: [busy, empty] });
  const rooting = choice.chooseRoot('landing', 'My Launch');
  const asked = await untilAsked(question);
  assert.equal(asked.title, '“busy” already has files');
  assert.deepEqual(asked.actions.map(action => action.id), ['another', 'subfolder']);
  assert.equal(asked.actions[1].label, 'Create subfolder my-launch');
  choice.choose('another');
  assert.equal(picker.calls, 2, 'the second picker opens synchronously in choose()');
  assert.deepEqual(await rooting, { root: empty });
});

test('a created subfolder is abandoned only while it is empty', async () => {
  const busy = new MemoryDirectoryHandle('busy', { 'notes.txt': 'x' }), { choice, question } = setup({ folders: [busy, busy] });
  let rooting = choice.chooseRoot('landing', 'Launch');
  (await untilAsked(question)); choice.choose('subfolder');
  const chosen = await rooting;
  assert.equal(chosen.root.name, 'launch');
  assert.deepEqual(chosen.created, { parent: busy, name: 'launch' });
  await assert.rejects(choice.withRoot(chosen, async () => { throw new Error('reading the brief failed'); }), /reading the brief failed/);
  assert.equal(busy.children.has('launch'), false, 'the empty subfolder is removed');
  assert.equal(busy.children.has('notes.txt'), true);
  // Something was written into the next one: it stays.
  rooting = choice.chooseRoot('landing', 'Launch');
  (await untilAsked(question)); choice.choose('subfolder');
  const second = await rooting;
  await assert.rejects(choice.withRoot(second, async root => { await root.getFileHandle('index.tpl', { create: true }); throw new Error('later failure'); }));
  assert.equal(busy.children.has('launch'), true);
});

test('a folder holding a project offers to open it only with allowOpen; Cancel resolves null', async () => {
  const existing = await project('existing');
  let { choice, question } = setup({ folders: [existing] });
  let rooting = choice.chooseRoot('landing', 'Launch');
  assert.deepEqual((await untilAsked(question)).actions.map(action => action.id), ['another', 'open']);
  choice.choose('open');
  const opened = await rooting;
  assert.equal(opened.open, existing);
  assert.equal(opened.classification.meta.projectId, 'p1');

  ({ choice, question } = setup({ folders: [existing] }));
  rooting = choice.createRoot('template', 'Launch');
  const asked = await untilAsked(question);
  assert.deepEqual(asked.actions.map(action => action.id), ['another'], 'createRoot never offers an existing project');
  assert.match(asked.message, /never overwrites/);
  choice.choose('cancel');
  assert.equal(await rooting, null);
});

test('OPFS mode creates a root without a picker; a failed flow deletes it unless it holds a project', async () => {
  const { choice, picker, removed, opfs } = setup({ mode: 'opfs' });
  const chosen = await choice.chooseRoot('landing', 'Launch');
  assert.equal(picker.calls, 0);
  assert.deepEqual(chosen.created, { opfs: 'new-id' });
  assert.equal(await choice.withRoot(chosen, async root => root.name), 'new-id', 'a successful flow keeps its root');
  await assert.rejects(choice.withRoot(chosen, async root => { await root.getFileHandle('index.tpl', { create: true }); throw new Error('no project.json yet'); }));
  assert.deepEqual(removed, ['new-id'], 'a partial OPFS create is removed');
  const kept = await choice.chooseRoot('landing', 'Launch');
  await createProjectMeta(kept.root, { schema: 1, projectId: 'p2', kind: 'landing', name: 'Kept', metadataRevision: 0 });
  assert.equal(await choice.abandon(kept), false);
  assert.equal(opfs.children.has('new-id'), true);
  assert.equal(await choice.abandon({ root: kept.root }), false, 'a picked folder is never removed');
});

test('an action with `root` starts chooseRoot inside the answering click', async () => {
  const empty = new MemoryDirectoryHandle('empty'), { choice, picker } = setup({ folders: [empty] });
  const answering = choice.ask({ title: 'Import', message: '', actions: [{ id: 'import', label: 'Choose folder…', root: { kind: 'landing', name: 'Imported' } }] });
  assert.equal(picker.calls, 0);
  choice.choose('import');
  assert.equal(picker.calls, 1);
  const answer = await answering;
  assert.equal(answer.id, 'import');
  assert.deepEqual(await answer.rooting, { root: empty });
  // Unknown ids and repeated answers are cancellations / no-ops.
  const cancelling = choice.ask({ title: 'x', message: '', actions: [] });
  choice.choose('nope'); choice.choose('nope');
  assert.deepEqual(await cancelling, { id: 'cancel', picking: null, rooting: null });
});
