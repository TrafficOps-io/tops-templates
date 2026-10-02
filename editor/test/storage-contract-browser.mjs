// The production directory conversation store on real OPFS in Chromium (bundled by support/studio-folders.js):
// core's conversationStoreContract with a peer in another window (a same-origin iframe, so its BroadcastChannel is a
// different realm's), change notifications across two pages, the GC grace period (pending AI brief blobs are kept until
// the brief is claimed), the pendingAi claim raced from two pages under real navigator.locks, and a history ZIP over
// 20 MiB exported and imported again through the App.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { readZipProject } from '@trafficops/template-editor-core';
import { editorReady, installFolderPicker, listOpfs, loadStorage, metaOf, openProject, seedProjectFolder, storageBundle, until, usePicker } from './support/studio-folders.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(process.argv[2] || 'editor/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // A plain same-origin document for the store checks (no App running in it).
    if (path === '/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Store checks</title><body></body>'); return; }
    const file = resolve(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + '/')) throw Error('path');
    const value = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(value);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`, MiB = 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await installFolderPicker(context);
  await context.route('https://openrouter.ai/**', route => route.abort());
  const errors = [];
  const open = async path => { const next = await context.newPage(); next.on('pageerror', error => errors.push(error.message)); await next.goto(url + path); return next; };
  const first = page = await open('/blank'), second = await open('/blank');
  await loadStorage(first); await loadStorage(second);

  // The contract, with each store's peer opened in a same-origin iframe: another window over the same folder.
  await first.evaluate(() => { const frame = document.createElement('iframe'); frame.name = 'peer'; document.body.append(frame); });
  let peerFrame;
  await until(() => (peerFrame = first.frame({ name: 'peer' })), 'the peer frame exists');
  await peerFrame.evaluate(await storageBundle());
  const contract = await first.evaluate(async () => {
    const storage = window.__studioStorage, peerWindow = document.querySelector('iframe[name=peer]').contentWindow, peerStorage = peerWindow.__studioStorage;
    if (!peerStorage || peerStorage === storage || peerWindow.BroadcastChannel === window.BroadcastChannel) throw new Error('The peer must be another realm.');
    const base = await (await navigator.storage.getDirectory()).getDirectoryHandle('contract', { create: true }), results = [];
    for (const [index, contractCase] of storage.conversationStoreContract.entries()) {
      const peers = new Map(), opened = [];
      let stores = 0;
      const createStore = async ({ graceMs } = {}) => {
        const id = `case-${index}-${++stores}`, folder = await base.getDirectoryHandle(id, { create: true }), options = { projectId: id, ...(graceMs === undefined ? {} : { graceMs }) };
        const store = storage.createDirectoryConversationStore(folder, options);
        // The peer resolves the folder from its own window's OPFS root.
        const peerFolder = await (await (await peerWindow.navigator.storage.getDirectory()).getDirectoryHandle('contract')).getDirectoryHandle(id);
        const peer = peerStorage.createDirectoryConversationStore(peerFolder, options);
        peers.set(store, peer); opened.push(store, peer);
        return store;
      };
      try { await contractCase.run(createStore, { openPeer: store => peers.get(store) }); results.push({ name: contractCase.name, ok: true }); }
      catch (error) { results.push({ name: contractCase.name, ok: false, error: error.message }); }
      finally { for (const store of opened) store.close(); }
    }
    return results;
  });
  assert.ok(contract.length >= 9, `the contract has its cases (got ${contract.length})`);
  for (const result of contract) assert.ok(result.ok, `contract on OPFS: ${result.name}: ${result.error}`);

  // Two pages over one folder: a committed write in one is heard by a watcher in the other, both ways, and each sees
  // the other's revision.
  const watchOn = target => target.evaluate(async () => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract', { create: true })).getDirectoryHandle('two-pages', { create: true });
    window.__twoPages = window.__studioStorage.createDirectoryConversationStore(folder, { projectId: 'two-pages' });
    window.__heard = 0; window.__twoPages.watch(() => { window.__heard++; });
  });
  await watchOn(first); await watchOn(second);
  const thread = { schema: 1, id: 'shared', revision: 0, title: 'Shared', messages: [], runs: [] };
  assert.equal((await first.evaluate(value => window.__twoPages.writeThread(value, { expectedRevision: 0 }), thread)).revision, 1);
  await until(() => second.evaluate(() => window.__heard >= 1), 'the second page hears the first page’s write');
  assert.equal(await first.evaluate(() => window.__heard), 0, 'a channel never hears its own post');
  assert.equal((await second.evaluate(value => window.__twoPages.writeThread({ ...value, title: 'Renamed' }, { expectedRevision: 1 }), thread)).revision, 2);
  await until(() => first.evaluate(() => window.__heard >= 1), 'the first page hears the second page’s write');
  assert.deepEqual(await first.evaluate(async () => (await window.__twoPages.listThreads()).map(({ id, revision, title }) => ({ id, revision, title }))), [{ id: 'shared', revision: 2, title: 'Renamed' }]);
  assert.equal(await first.evaluate(value => window.__twoPages.writeThread(value, { expectedRevision: 1 }).then(() => 'saved', error => error.code), thread), 'conflict', 'a stale write from the other page conflicts');

  // GC grace: an unreferenced blob survives until it is older than graceMs; a pending brief's attachment survives until
  // the brief is claimed; a referenced blob always survives.
  const gc = await first.evaluate(async () => {
    const storage = window.__studioStorage, encoder = new TextEncoder();
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract', { create: true })).getDirectoryHandle('gc', { create: true });
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==';
    await storage.createProjectInRoot(folder, { projectId: 'gc-project', name: 'GC', brief: { id: 'brief-gc', prompt: 'Use this image.', mode: 'create', generateImages: false, attachments: [{ id: 'pixel', name: 'pixel.png', mime: 'image/png', dataUrl: `data:image/png;base64,${pixel}`, useOnPage: true }] } });
    const briefSha = (await storage.readProjectMeta(folder)).pendingAi.attachments[0].blob[storage.BLOB_TAG];
    const loose = encoder.encode('loose'), kept = encoder.encode('kept'), looseSha = await storage.sha256Hex(loose), keptSha = await storage.sha256Hex(kept);
    const present = new Proxy({}, { get: (_, sha) => storage.createDirectoryConversationStore(folder, { projectId: 'gc-project' }).getBlob(sha).then(() => true, () => false) });
    const store = storage.createDirectoryConversationStore(folder, { projectId: 'gc-project', graceMs: 60000 });
    await store.putBlob(looseSha, loose); await store.putBlob(keptSha, kept);
    await store.writeThread({ schema: 1, id: 'kept', revision: 0, messages: [{ id: 'm', file: { [storage.BLOB_TAG]: keptSha, encoding: 'bytes', size: kept.byteLength } }], runs: [] }, { expectedRevision: 0 });
    await store.collectGarbage();
    const young = { loose: await present[looseSha], brief: await present[briefSha], kept: await present[keptSha] };
    const later = storage.createDirectoryConversationStore(folder, { projectId: 'gc-project', graceMs: 60000, now: () => Date.now() + 120000 });
    await later.collectGarbage();
    const old = { loose: await present[looseSha], brief: await present[briefSha], kept: await present[keptSha] };
    const claimed = await storage.claimPendingAi(folder, 'gc-project', 'brief-gc');
    await later.collectGarbage();
    const afterClaim = { brief: await present[briefSha], kept: await present[keptSha], pendingAi: (await storage.readProjectMeta(folder)).pendingAi ?? null };
    store.close(); later.close();
    return { young, old, claimed, afterClaim };
  });
  assert.deepEqual(gc.young, { loose: true, brief: true, kept: true }, 'nothing younger than the grace period is collected');
  assert.deepEqual(gc.old, { loose: false, brief: true, kept: true }, 'an old unreferenced blob is collected; brief and thread blobs stay');
  assert.equal(gc.claimed, true);
  assert.deepEqual(gc.afterClaim, { brief: false, kept: true, pendingAi: null }, 'a claimed brief’s blob becomes collectable');

  // pendingAi claim: two pages race for each stored brief under navigator.locks; exactly one wins every round.
  await first.evaluate(async () => {
    const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract', { create: true })).getDirectoryHandle('claim', { create: true });
    await window.__studioStorage.createProjectInRoot(folder, { projectId: 'claim-project', name: 'Claim' });
  });
  assert.equal(await first.evaluate(() => Boolean(navigator.locks?.request)), true, 'the race runs under real Web Locks');
  for (let round = 1; round <= 5; round++) {
    const id = `brief-${round}`;
    await first.evaluate(async id => {
      const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract')).getDirectoryHandle('claim');
      await window.__studioStorage.storePendingAi(folder, 'claim-project', { id, prompt: `Round ${id}`, mode: 'create', generateImages: false, attachments: [] });
    }, id);
    const at = Date.now() + 150;
    const claim = target => target.evaluate(async ({ id, at }) => {
      const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract')).getDirectoryHandle('claim');
      await new Promise(done => setTimeout(done, Math.max(0, at - Date.now())));
      return window.__studioStorage.claimPendingAi(folder, 'claim-project', id);
    }, { id, at });
    const won = await Promise.all([claim(first), claim(second)]);
    assert.equal(won.filter(Boolean).length, 1, `exactly one page claims ${id}: ${JSON.stringify(won)}`);
    assert.equal(await first.evaluate(async () => (await window.__studioStorage.readProjectMeta(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract')).getDirectoryHandle('claim'))).pendingAi ?? null), null);
  }
  assert.equal(await second.evaluate(async () => window.__studioStorage.claimPendingAi(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('contract')).getDirectoryHandle('claim'), 'claim-project', 'brief-5')), false, 'a claimed brief cannot be claimed again');
  await first.close(); await second.close();

  // A history over 20 MiB (three incompressible 8 MiB blobs in two dialogues) exports as an editable ZIP and imports
  // again (D1: its projectId is known, so the import is a copy with remapped history and the same blobs).
  const app = page = await open('/');
  const seeded = await seedProjectFolder(app, { name: 'Large history', values: { title: 'Large history page' } });
  const blobs = await app.evaluate(async folder => {
    const storage = window.__studioStorage, MiB = 1024 * 1024;
    let target = await navigator.storage.getDirectory();
    for (const part of folder.split('/')) target = await target.getDirectoryHandle(part);
    const meta = await storage.readProjectMeta(target), store = storage.createDirectoryConversationStore(target, { projectId: meta.projectId }), refs = [];
    for (let index = 0; index < 3; index++) {
      const bytes = new Uint8Array(8 * MiB);
      for (let at = 0; at < bytes.length; at += 65536) crypto.getRandomValues(bytes.subarray(at, at + 65536));
      const sha = await storage.sha256Hex(bytes);
      await store.putBlob(sha, bytes);
      refs.push({ [storage.BLOB_TAG]: sha, encoding: 'bytes', size: bytes.byteLength });
    }
    const now = Date.now();
    await store.writeThread({ schema: 1, id: 'large-one', revision: 0, title: 'Large dialogue', createdAt: now, updatedAt: now, messages: [{ id: 'one', role: 'user', prompt: 'Two large files.', createdAt: now, files: [refs[0], refs[1]] }], runs: [] }, { expectedRevision: 0 });
    await store.writeThread({ schema: 1, id: 'large-two', revision: 0, title: 'Second large dialogue', createdAt: now + 1, updatedAt: now + 1, messages: [{ id: 'two', role: 'user', prompt: 'One large file.', createdAt: now + 1, file: refs[2] }], runs: [] }, { expectedRevision: 0 });
    store.close();
    return refs.map(ref => ({ sha: ref[storage.BLOB_TAG], size: ref.size }));
  }, seeded.folder);
  await openProject(app, 'Large history');
  await app.getByRole('tablist', { name: 'Authoring mode' }).getByRole('tab', { name: 'Content', exact: true }).click();
  await app.locator('.hosted-more > summary').click();
  await app.getByRole('button', { name: 'Download project', exact: true }).click();
  const exportDialog = app.getByRole('dialog', { name: 'Export', exact: true });
  await exportDialog.getByRole('combobox', { name: 'Export destination', exact: true }).selectOption('source');
  assert.equal(await exportDialog.getByRole('checkbox', { name: 'Include conversation history', exact: true }).isChecked(), true);
  const downloading = app.waitForEvent('download', { timeout: 60000 });
  await exportDialog.getByRole('button', { name: 'Download', exact: true }).click();
  const archivePath = await (await downloading).path(), bytes = new Uint8Array(await readFile(archivePath));
  assert.ok(bytes.byteLength > 20 * MiB, `the archive holds the history (${bytes.byteLength} bytes)`);
  const archive = readZipProject(bytes, { history: true });
  assert.equal(archive.metadata.projectId, seeded.projectId);
  assert.equal(archive.settings.title, 'Large history page');
  assert.deepEqual(archive.conversationFiles.threads.map(item => item.id).sort(), ['large-one', 'large-two']);
  assert.deepEqual([...archive.conversationFiles.blobs].map(([sha, value]) => ({ sha, size: value.byteLength, hash: sha256(value) })).sort((a, b) => a.sha.localeCompare(b.sha)), blobs.map(blob => ({ ...blob, hash: blob.sha })).sort((a, b) => a.sha.localeCompare(b.sha)));

  await app.getByRole('button', { name: 'Projects', exact: true }).click();
  // Leaving the editor saves it first; the import starts once the library is idle (Import ZIP enabled).
  await app.locator('.library-tools button:not([disabled])', { hasText: 'Import ZIP' }).waitFor();
  await usePicker(app, 'large-import');
  await app.locator('input[aria-label="Import project ZIP"]').setInputFiles(archivePath);
  await app.getByRole('dialog', { name: 'Import Large history' }).getByRole('button', { name: 'Choose folder…', exact: true }).click({ timeout: 60000 });
  await editorReady(app, 60000);
  await until(async () => (await listOpfs(app, 'picker/large-import/.trafficops'))?.includes('project.json'), 'the import is written', 60000);
  const imported = await metaOf(app, 'picker/large-import');
  assert.notEqual(imported.projectId, seeded.projectId, 'a known projectId imports as a copy');
  assert.equal(imported.name, 'Large history (copy)');
  const stored = await app.evaluate(async () => {
    let folder = await navigator.storage.getDirectory();
    for (const part of ['picker', 'large-import', '.trafficops', 'conversations']) folder = await folder.getDirectoryHandle(part);
    const blobs = [], threads = [];
    for await (const [name, handle] of (await folder.getDirectoryHandle('blobs')).entries()) blobs.push({ sha: name, size: (await handle.getFile()).size });
    for await (const [name, handle] of folder.entries()) if (name.endsWith('.json')) threads.push(JSON.parse(await (await handle.getFile()).text()));
    return { blobs, threads: threads.map(item => ({ id: item.id, title: item.title, refs: JSON.stringify(item.messages).match(/[a-f0-9]{64}/g)?.length || 0 })) };
  });
  assert.deepEqual(stored.blobs.sort((a, b) => a.sha.localeCompare(b.sha)), [...blobs].sort((a, b) => a.sha.localeCompare(b.sha)), 'every blob arrives with its hash and size');
  assert.deepEqual(stored.threads.map(item => item.title).sort(), ['Large dialogue', 'Second large dialogue']);
  assert.ok(stored.threads.every(item => !['large-one', 'large-two'].includes(item.id)), 'a copy remaps the dialogue ids');
  assert.equal(stored.threads.reduce((sum, item) => sum + item.refs, 0), 3, 'the dialogues still reference the three blobs');
  assert.deepEqual(errors, []);
  console.log(`PASS: storage contract (${contract.length} cases) on OPFS with a cross-window peer, cross-page change notifications, GC grace and brief blobs, pendingAi claim race under Web Locks, ${(bytes.byteLength / MiB).toFixed(1)} MiB history ZIP export and import.`);
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: '/tmp/studio-storage-contract-failure.png', fullPage: true }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 4000)); }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
