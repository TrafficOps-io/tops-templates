import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioProject, cloneStudioProject, deleteStudioProject, getActiveStudioProjectId, getStudioProject, listStudioProjects, saveStudioProject, setActiveStudioProjectId, validateStudioProject } from '../src/studio-library.js';

const template = (id = 'template-one') => createStudioProject({
  kind: 'template', name: '  Product page  ',
  files: { 'index.tpl': '@layout\n<h1>{{ title }}</h1>\n@endlayout', 'images/photo.png': new Uint8Array([0, 127, 255]) },
  folders: ['empty/nested'], settings: { title: 'Product', cards: [{ title: 'One' }] },
}, { id, now: 100 });

// A disposable IDB model with isolated readwrite transactions, rollback, and a
// controllable commit boundary. No persistence test depends on a browser profile.
function memoryIndexedDB() {
  const stores = new Map();
  const waiting = [];
  const control = { connectionsClosed: 0, nextAbort: null, nextCommitAbort: null, holdNextCommit: false, heldCommit: null };
  let initialized = false, active = false;
  function drain() {
    if (active || !waiting.length) return;
    active = true;
    waiting.shift()();
  }
  const database = () => ({
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name, options = {}) { stores.set(name, { keyPath: options.keyPath, records: new Map() }); },
    close() { control.connectionsClosed++; },
    transaction(names, mode) {
      let view, pending = 0, started = false, stopped = false, finishQueued = false;
      const requests = [];
      const transaction = {
        error: null,
        abort() {
          if (stopped) throw new Error('Transaction finished.');
          stopped = true;
          queueMicrotask(() => { transaction.onabort?.(); active = false; drain(); });
        },
        objectStore(name) {
          assert.ok(names.includes(name));
          function operation(action) {
            const request = {};
            pending++;
            const perform = () => queueMicrotask(() => {
              if (stopped) return;
              try { request.result = structuredClone(action(view.get(name))); request.onsuccess?.(); }
              catch (error) {
                request.error = transaction.error = error;
                request.onerror?.(); transaction.onerror?.();
                if (!stopped) transaction.abort();
              }
              pending--; finish();
            });
            if (started) perform(); else requests.push(perform);
            return request;
          }
          return {
            get: key => operation(store => store.records.get(key)),
            getAll: () => operation(store => [...store.records.values()]),
            put(value, key) {
              const copy = structuredClone(value);
              return operation(store => {
                assert.equal(mode, 'readwrite');
                if (control.nextAbort) { const error = control.nextAbort; control.nextAbort = null; throw error; }
                const actualKey = store.keyPath ? copy[store.keyPath] : key;
                store.records.set(actualKey, copy); return actualKey;
              });
            },
            delete: key => operation(store => { assert.equal(mode, 'readwrite'); store.records.delete(key); }),
          };
        },
      };
      function finish() {
        if (pending || stopped || finishQueued) return;
        finishQueued = true;
        setImmediate(() => {
          finishQueued = false;
          if (pending || stopped) return;
          const commit = () => {
            if (stopped) return;
            if (control.nextCommitAbort) {
              transaction.error = control.nextCommitAbort; control.nextCommitAbort = null;
              transaction.abort(); return;
            }
            stopped = true;
            if (mode === 'readwrite') for (const [name, store] of view) stores.set(name, store);
            transaction.oncomplete?.(); active = false; drain();
          };
          if (control.holdNextCommit) { control.holdNextCommit = false; control.heldCommit = commit; }
          else commit();
        });
      }
      waiting.push(() => {
        started = true;
        view = new Map(names.map(name => [name, { keyPath: stores.get(name).keyPath, records: structuredClone(stores.get(name).records) }]));
        requests.forEach(run => run()); finish();
      });
      queueMicrotask(drain);
      return transaction;
    },
  });
  return {
    control,
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database();
        if (!initialized) { initialized = true; request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function withStorage(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const storage = memoryIndexedDB();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: storage });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'indexedDB', original); else delete globalThis.indexedDB; });
  return storage.control;
}

test('new projects normalize names and retain detached binary assets, settings and empty folders', () => {
  const source = template();
  assert.equal(source.name, 'Product page');
  assert.equal(source.revision, 0);
  assert.deepEqual(source.folders, ['empty', 'empty/nested', 'images']);
  const copy = cloneStudioProject({ ...source, aiPrompt: 'Build it', aiStarted: true }, { id: 'landing-one', kind: 'landing', now: 200 });
  assert.equal(copy.sourceTemplateId, source.id);
  assert.equal(copy.kind, 'landing');
  assert.equal(copy.createdAt, 200);
  assert.equal(copy.revision, 0);
  assert.equal(copy.aiPrompt, undefined);
  assert.equal(copy.aiStarted, undefined);
  copy.files['images/photo.png'][0] = 99;
  copy.settings.cards[0].title = 'Changed';
  copy.folders.push('another');
  assert.equal(source.files['images/photo.png'][0], 0);
  assert.equal(source.settings.cards[0].title, 'One');
  assert.equal(source.folders.includes('another'), false);
  assert.throws(() => cloneStudioProject(source, { id: source.id }), /new ID/);
});

test('project validation rejects corrupt metadata, paths, JSON settings and oversized prompts', () => {
  const source = template();
  const invalid = [
    [{ id: '' }, /valid ID/], [{ kind: 'other' }, /template or landing/], [{ name: ' ' }, /names/],
    [{ name: 'a'.repeat(201) }, /names/], [{ revision: -1 }, /revision/], [{ createdAt: NaN }, /creation time/],
    [{ files: [] }, /files must/], [{ files: { '../index.tpl': 'x' } }, /Unsafe/],
    [{ files: { 'index.tpl': {} } }, /Invalid contents/], [{ folders: 'images' }, /array/],
    [{ folders: ['index.tpl'] }, /conflicts/], [{ settings: [] }, /JSON object/],
    [{ settings: { callback() {} } }, /JSON values/], [{ settings: { amount: Infinity } }, /JSON values/],
    [{ aiPrompt: 'a'.repeat(6001) }, /6000/], [{ aiStarted: 'true' }, /generation state/],
  ];
  for (const [change, expected] of invalid) assert.throws(() => validateStudioProject({ ...source, ...change }), expected);
  const circular = {}; circular.self = circular;
  assert.throws(() => validateStudioProject({ ...source, settings: circular }), /circular/);
  const legitimate = JSON.parse('{"__proto__":{"title":"kept"},"nested":[null,true,10]}');
  assert.deepEqual(validateStudioProject({ ...source, settings: legitimate }).settings, legitimate);
});

test('library CRUD isolates multiple projects and removes only the active selection for a deleted project', async t => {
  withStorage(t);
  const first = await saveStudioProject(template(), { expectedRevision: null });
  const second = await saveStudioProject(cloneStudioProject(first, { id: 'landing-one', kind: 'landing' }), { expectedRevision: null });
  assert.equal(first.revision, 1);
  assert.equal((await listStudioProjects()).length, 2);
  assert.equal((await getStudioProject(second.id)).sourceTemplateId, first.id);
  first.files['images/photo.png'][0] = 77;
  assert.equal((await getStudioProject(first.id)).files['images/photo.png'][0], 0);
  await setActiveStudioProjectId(first.id);
  assert.equal(await getActiveStudioProjectId(), first.id);
  await deleteStudioProject(second.id);
  assert.equal(await getActiveStudioProjectId(), first.id);
  assert.equal(await getStudioProject(second.id), null);
  await deleteStudioProject(first.id);
  assert.equal(await getActiveStudioProjectId(), null);
  assert.deepEqual(await listStudioProjects(), []);
  await assert.rejects(setActiveStudioProjectId('missing'), /no longer exists/);
  await setActiveStudioProjectId(null);
});

test('atomic optimistic concurrency lets one tab save while rejecting a stale tab without data loss', async t => {
  withStorage(t);
  const first = await saveStudioProject(template(), { expectedRevision: null });
  const outcomes = await Promise.allSettled([
    saveStudioProject({ ...first, name: 'First tab', createdAt: 900 }, { expectedRevision: first.revision }),
    saveStudioProject({ ...first, name: 'Stale tab' }, { expectedRevision: first.revision }),
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[1].reason.code, 'conflict');
  const saved = await getStudioProject(first.id);
  assert.equal(saved.name, 'First tab');
  assert.equal(saved.revision, 2);
  assert.equal(saved.createdAt, first.createdAt);
  assert.ok(saved.updatedAt > first.updatedAt);
  await assert.rejects(saveStudioProject(first, { expectedRevision: null }), error => error.code === 'conflict');
  await deleteStudioProject(first.id);
  await assert.rejects(saveStudioProject(saved, { expectedRevision: saved.revision }), error => error.code === 'conflict');
  assert.equal(await getStudioProject(first.id), null);
});

test('save resolves only after the transaction commits and closes its connection', async t => {
  const control = withStorage(t);
  control.holdNextCommit = true;
  let resolved = false;
  const saved = saveStudioProject(template()).then(value => { resolved = true; return value; });
  for (let attempt = 0; attempt < 10 && !control.heldCommit; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(control.heldCommit);
  assert.equal(resolved, false);
  assert.equal(control.connectionsClosed, 0);
  control.heldCommit();
  assert.equal((await saved).revision, 1);
  assert.equal(control.connectionsClosed, 1);
});

test('storage quota aborts do not report success or overwrite the last committed copy', async t => {
  const control = withStorage(t);
  const first = await saveStudioProject(template());
  control.nextAbort = Object.assign(new Error('Quota exhausted'), { name: 'QuotaExceededError' });
  await assert.rejects(saveStudioProject({ ...first, name: 'Unsaved' }, { expectedRevision: first.revision }), /storage is full/);
  assert.equal((await getStudioProject(first.id)).name, first.name);
  assert.equal((await getStudioProject(first.id)).revision, first.revision);
});

test('an abort after a successful write request rolls back and rejects the save', async t => {
  const control = withStorage(t);
  const first = await saveStudioProject(template());
  control.nextCommitAbort = new Error('The transaction was aborted before commit');
  await assert.rejects(saveStudioProject({ ...first, name: 'Uncommitted' }, { expectedRevision: first.revision }), /aborted before commit/);
  assert.equal((await getStudioProject(first.id)).name, first.name);
  assert.equal((await getStudioProject(first.id)).revision, first.revision);
});

test('AI startup metadata persists and remains subject to the same concurrency check', async t => {
  withStorage(t);
  const first = await saveStudioProject({ ...template(), aiPrompt: 'Create a travel landing', aiStarted: false });
  const started = await saveStudioProject({ ...first, aiStarted: true }, { expectedRevision: first.revision });
  const reopened = await getStudioProject(first.id);
  assert.equal(reopened.aiPrompt, first.aiPrompt);
  assert.equal(reopened.aiStarted, true);
  assert.equal(reopened.revision, started.revision);
  await assert.rejects(saveStudioProject({ ...first, aiStarted: true }, { expectedRevision: first.revision }), error => error.code === 'conflict');
});

test('unavailable storage is an explicit failure rather than a successful empty library', async t => {
  withStorage(t);
  delete globalThis.indexedDB;
  await assert.rejects(listStudioProjects(), /storage is unavailable/);
  await assert.rejects(saveStudioProject(template()), /storage is unavailable/);
});

test('blocked database upgrades fail clearly and close a connection that opens later', async t => {
  const control = withStorage(t);
  let request;
  globalThis.indexedDB.open = () => {
    request = {};
    queueMicrotask(() => request.onblocked());
    return request;
  };
  await assert.rejects(listStudioProjects(), /another tab/);
  request.result = { close() { control.connectionsClosed++; } };
  request.onsuccess();
  assert.equal(control.connectionsClosed, 1);
});
