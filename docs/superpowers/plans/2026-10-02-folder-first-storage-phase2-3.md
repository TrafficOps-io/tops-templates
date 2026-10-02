# Folder-first storage, Phases 2–3: implementation plan

> **For agentic workers:** REQUIRED: use superpowers:subagent-driven-development. Each task is executed by one implementer (TDD), followed by spec-compliance and code-quality review. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Studio stores every project in a directory: a user folder in Chromium, or OPFS where folder pickers are missing. No project data remains in IndexedDB. The embedded editor stores conversation history on the host server over HTTP.

**Spec:** `docs/superpowers/specs/2026-10-02-folder-first-storage-design.md`, including "Notes for phase 2". Phase 1 is merged: core exports `createStoreConversationPort`, `createMemoryConversationStore`, `conversationStoreContract` (subpath `@trafficops/template-editor-core/conversation-store-contract`), and the `splitThread`, `joinThread`, `threadsOf` and `documentOf` format helpers.

**Why this plan specifies behaviour, not code.** Unlike phase 1, most tasks here are UI flows and integrations inside dense existing files (`App.jsx`, `StudioHost.js`, browser tests). Each task gives precise behaviour, file boundaries and required tests. Implementers write the code under TDD.

**Conventions**
- Match the dense house style.
- Errors are `ConflictError` / `ValidationError` / `PolicyError` from core.
- Node tests use `node:test`. Browser tests are plain node scripts run as `PLAYWRIGHT_MODULE=<abs path to playwright index.mjs> node editor/test/<name>-browser.mjs editor/dist`, after `npm run build:editor`. A local Playwright is installed at `/tmp/ffs-pw/node_modules/playwright/index.mjs`.
- Commit after each task, using only the task's files. Append the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` as a second `-m`.
- Run everything from the worktree `.worktrees/folder-first-storage-2`.

**Decisions taken while planning (the spec is amended in Task 15)**

| # | Decision |
|---|---|
| D1 | **ZIP import always creates a new project root**, chosen with the picker or created in OPFS. It never overwrites an existing folder. The archive's `projectId` is kept unless it equals a project already known to Studio (`recent` or OPFS). In that case the import becomes a copy: new `projectId`, history remapped with `cloneConversationDocument`, runs interrupted. The "Continue project into an existing folder" choice, `ProjectImportDialog` and `project-transfer.js` are removed. |
| D2 | **User templates live in their own folders.** Selecting a user template card in the create dialog is its own click; it calls `requestPermission` and reads the template files into memory. The **Create** click then opens the picker for the new project. One gesture is never asked to cover two prompts. |
| D3 | **Recent registry:** a new IndexedDB database `trafficops-studio-recent` with store `projects`, keyPath `projectId`, holding `{ projectId, name, kind, handle, lastOpenedAt }`. The old `trafficops-template-studio` database is abandoned and not migrated. OPFS projects are not registered; they are listed from `navigator.storage.getDirectory()/projects/*`. |
| D4 | **Save as template** (lifecycle action) calls an App-provided `createProjectRoot()` as the first step of the click flow. It writes a new project with `kind: "template"` there, copying files and values without history. |
| D5 | **Locks:** `navigator.locks` when present, otherwise an in-process FIFO mutex keyed by name. Node has no `navigator.locks`; tests use the fallback. |
| D6 | **Superseded by spec A6 (file names) and D10/A10 (tombstones).** Original text: **Thread file names:** `encodeURIComponent(id) + '.json'`. **Tombstones:** `.trafficops/conversations/tombstones.json` maps a deleted id to its last revision, so revisions never restart after a delete and recreate. It is written under the conversations lock. |
| D7 | **The AI port is always enabled.** `createStudioAiPort` loses `isEnabled`. `installedDisplayMode()` remains only for PWA install and update chrome. |

---

**Decisions added after plan review (D8–D11)**

| # | Decision |
|---|---|
| D8 | **User activation.** `pickFolder()` and `requestPermission()` are only called synchronously at the start of a click handler, before any `await`. The flows that would otherwise lose the gesture get an explicit button. **Import ZIP**: read the archive first, then a dialog "Import {name}" with **Choose folder…**. **Create with attachments**: `createRoot` first, then read the attachments. **Duplicate**: the source must already be `granted`; otherwise the first click grants the source and the dialog then shows **Choose destination…**. |
| D9 | **Permissions outside Chromium.** If `queryPermission` or `requestPermission` is missing (Safari/Firefox OPFS handles), treat the handle as `granted`. `storageMode()` is **async**: it probes `navigator.storage.getDirectory()` and returns `unsupported` on rejection (Firefox private mode). In OPFS mode, call `navigator.storage.persist()` once and show a "Stored in this browser — export a backup ZIP regularly" note. |
| D10 | **Tombstones** live in `.trafficops/conversation-tombstones.json`, outside the thread namespace. The CAS compares `expectedRevision` with the **file** revision only (0 when there is no file). The tombstone only raises the new revision: `max(file, tombstone) + 1`. Writing over a damaged file throws `ConflictError`. |
| D11 | **Meta writes are patches.** `updateProjectMeta(root, projectId, patch)` does a read-modify-write under the meta lock. Only `claimPendingAi` and `storePendingAi` touch `pendingAi`. |

Plan-wide gates:
- From Task 8 to Task 11, the browser suite is expected to be red. Those tasks are gated on node tests plus `npm run build:editor` and `npm run build:embed`.
- From Task 11 on, the full browser list must be green.
- App-level and library UI strings follow the existing hard-coded-English pattern in `App.jsx` and `StudioLibrary.jsx`. Do not add a translation provider. Shell strings go through `studio-translations.json`, as today.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `editor/src/storage/locks.js` | create | `withLock(name, fn, { locks })`: `navigator.locks` or an in-process FIFO mutex. Locks are not reentrant; nested locks are forbidden. |
| `editor/src/storage/write.js` | create | the only `createWritable()` caller, plus path helpers |
| `editor/src/storage/directory-conversation-store.js` | create | `ConversationStore` over `.trafficops/conversations/` |
| `editor/src/storage/files.js` | create | project tree read and sync with external-change detection |
| `editor/src/storage/project-meta.js` | create | `project.json` (patch writes, `pendingAi`) and `values.json` |
| `editor/src/storage/roots.js` | create | capability probe, picker, folder classification, subfolders, OPFS roots, permissions |
| `editor/src/storage/recent.js` | create | recent-handles registry (D3) |
| `editor/src/storage/project-root.js` | create | create, adopt, list, make-independent, copy, conversation-remap helpers |
| `editor/src/storage/flows.js` | create | pure decision logic for App flows (testable without React) |
| `editor/embedded/src/http-conversation-store.js` | create | HTTP `ConversationStore` |
| `editor/src/hosts/StudioHost.js` | rewrite | folder-only host |
| `editor/src/App.jsx`, `StudioLibrary.jsx`, `CreateProjectDialog`, `HomeProjectChat.jsx`, `StudioDialogs.jsx` | modify | folder-first UI |
| `editor/src/FolderChoiceDialog.jsx`, `UnsupportedBrowser.jsx` | create | new dialogs |
| `packages/template-editor-core/src/project.js` (+ `contract.d.ts`) | modify | ZIP v1 history layout |
| removed in Task 11 | delete | `studio-library.js`, `workspace-storage.js`, `studio-ai-recovery.js`, `studio-conversations.js` (after `cloneConversationDocument` and `interruptImportedRuns` move to `storage/project-root.js`), `directory-projects.js`, `portable-project.js`, `project-transfer.js`, `hosts/LibraryHost.js`, `ProjectImportDialog.jsx`, `ProjectSwitcher.jsx` (its `projectLocation` is deleted together with `ProjectsDialog`), `test/support/conversation-idb.js` (folded into `memory-idb.js`) |

---

## Phase 2 and 3, in execution order

### Task 1: Test support — DONE (commit 472a9eb)

One follow-up is folded into Task 6: `memory-idb.js` must keep values that are `MemoryHandle` instances **by reference**. Today it uses `structuredClone`, which strips their methods and identity; real browsers structured-clone `FileSystemHandle` objects natively. Note that `MemoryDirectoryHandle` exposes its children Map as `.children`, and `entries()` is the async iterator.

### Task 2: `storage/locks.js` and `storage/write.js`

- `withLock(name, fn, { locks = globalThis.navigator?.locks } = {})`: uses `locks.request(name, fn)` when available, otherwise a per-name FIFO chain. A rejection releases the lock and propagates. The fallback is tested by injecting `locks: null`, and the native path by injecting a fake `locks.request`.
- `write.js` (root handle plus slash path):
  - `directoryAt(root, path, { create })`, `fileAt(root, path, { create })`;
  - `readFile(root, path)` returns a `Uint8Array` or `null`;
  - `readText`, and `readJson` (`null` when missing; a parse error becomes a `ValidationError` naming the path);
  - `writeFile(root, path, bytes | string)`: creates parent directories, then `createWritable` → `write` → `close`; on error it calls `abort?.()` and rethrows;
  - `removePath(root, path, { recursive })`: missing is OK;
  - `lastModified(root, path)` returns a number or `null`;
  - `listDirectory(root, path)` returns `[{ name, kind }]` (`[]` when missing).
- A `QuotaExceededError` from a write is rethrown as `Error('Browser storage is full — export the project as ZIP and free some space.', { cause })`.
- Tests: `editor/test/storage-write.test.js`.

### Task 3: `storage/directory-conversation-store.js`

`createDirectoryConversationStore(root, { projectId, graceMs = 10 min, refreshMs = 5 min, now = Date.now, channelName, locks })` returns a `ConversationStore` plus `close()`.
- Files:
  - `.trafficops/conversations/<encodeURIComponent(id)>.json`;
  - blobs in `.trafficops/conversations/blobs/<sha>`;
  - tombstones in `.trafficops/conversation-tombstones.json` (D10).
- `listThreads()`: parses every `*.json` in `conversations/`. A file that fails to parse or validate is returned as `{ schema: 1, id: decodeURIComponent(basename), revision: -1, damaged: true, messages: [], runs: [] }` and is never deleted. The adapter's validation path rejects it and keeps it out of the snapshot. Verify this against `conversation-port.js` `read()`; a damaged entry must produce the adapter's "could not be opened" warning.
- `writeThread(thread, { expectedRevision })`, under `withLock('trafficops-conversations:' + projectId)`:
  - the file revision (0 when there is no file) must equal `expectedRevision`, otherwise `ConflictError`;
  - a damaged existing file throws `ConflictError`;
  - run `validateThreadFile`;
  - every referenced blob must exist, otherwise `ValidationError`;
  - new revision = max(file, tombstone) + 1;
  - write the file, clear the tombstone, and post `{ threadId, revision }` on the `BroadcastChannel`.
- `deleteThread(id, { expectedRevision })`: missing resolves; a mismatch throws `ConflictError`; otherwise remove the file, record the tombstone and post.
- `putBlob(sha, bytes)`: over 24 MiB is rejected; a hash mismatch throws `ValidationError`; a new blob is written without the lock; an existing blob older than `refreshMs` is rewritten under the lock.
- `getBlob(sha)` returns a copy, or throws `Error('A conversation attachment is missing.')`.
- `watch(cb)`: one `BroadcastChannel(channelName ?? 'trafficops-conversations:' + projectId)` per store, created lazily. `close()` closes it. In node, call `channel.unref?.()` so tests don't hang.
- `collectGarbage()`, under the lock: if any thread file is damaged, skip the pass; otherwise delete blobs that are unreferenced and whose `lastModified` is older than `graceMs`.
- Tests (`editor/test/directory-conversation-store.test.js`):
  - every `conversationStoreContract` case with `openPeer = store => createDirectoryConversationStore(<same root>, { projectId: <same> })`, closing all stores in `t.after`;
  - recreating a deleted thread with `expectedRevision 0` succeeds with a revision greater than the old one;
  - ids containing `tombstones`, `/`, `:` and spaces;
  - a damaged file blocks GC and is not deleted;
  - adapter round trip;
  - fallback locks serialize two concurrent writers.

### Task 4: HTTP conversation store and the `HttpHost` gate (phase 3)

- `editor/embedded/src/http-conversation-store.js`: `createHttpConversationStore({ endpoint, csrf, fetchImpl })` implements the spec's "HTTP conversation contract".
  - Requests carry `credentials: 'same-origin'`, `X-CSRF-TOKEN`, and `If-Match: "<revision>"` on PUT and DELETE. Ids are `encodeURIComponent`'d.
  - Status mapping:
    - 409 → `ConflictError`;
    - 422 → `ValidationError`;
    - 413 → `Error` with the server message or `'The dialogue exceeds the server limit.'`;
    - 404 on `GET` blob → `Error('A conversation attachment is missing on the server.')`;
    - `DELETE` 404 or 204 → resolve.
  - No `watch` and no `collectGarbage`.
- `HttpHost.js`:
  - remove the `../../src/studio-conversations.js` import;
  - when `initial.aiEnabled && initial.conversationsEnabled === true`, set `conversations = createStoreConversationPort(createHttpConversationStore(...), { projectId: 'embed:' + pathname })` and keep `ai`;
  - otherwise there is no `ai` and no `conversations`, and `capabilities.ai` and `availability.ai` are `false`, so conformance passes.
- `editor/test/support/http-server.js` gains the conversation endpoints, backed by `createMemoryConversationStore()`: `If-Match` CAS, the status codes, hash verification, missing-blob 422 and the 413 limits.
- Tests:
  - `editor/test/http-conversation-store.test.js` runs every contract case over the mock (`openPeer` = identity; the watch case is skipped automatically);
  - `hosts.test.js` covers HttpHost with and without `conversationsEnabled`, including conformance, and an AI round trip that persists history through the mock;
  - `npm run build:embed` succeeds.

### Task 5: `storage/project-meta.js` and `storage/files.js`

**`project-meta.js`**
- `readProjectMeta(root)`: core `validatePortableMetadata` plus an optional `pendingAi: { id, prompt, mode, generateImages, attachments: [{ id, name, mime, useOnPage, blob: <ref> }] }`.
- `createProjectMeta(root, meta)` writes only when there is no `project.json` yet.
- `updateProjectMeta(root, projectId, patch)` (D11): a read-modify-write under `withLock('trafficops-project-meta:' + projectId)`.
  - A different `projectId` on disk throws `ConflictError`.
  - `metadataRevision` increments when `name` or `kind` change.
  - `pendingAi` in the patch is rejected.
- `storePendingAi(root, projectId, brief)` writes the attachment bytes as blobs into the conversations blob directory (`.trafficops/conversations/blobs/`) and the refs into meta. `resolvePendingAi(root, meta)` rebuilds `{ id, prompt, mode, generateImages, attachments: [{ id, name, mime, dataUrl, useOnPage }] }`. `claimPendingAi(root, projectId, id)` removes `pendingAi` exactly once under the lock and returns a boolean. GC must not collect pendingAi blobs: Task 3's `collectGarbage` also treats refs in `project.json` `pendingAi` as referenced. Add this to the store and a test there.
- `readValues(root)` and `writeValues(root, values)`. An empty object removes the file.

**`files.js`**: `readProjectTree(root)` and `syncProjectTree(root, previous, next)` are ported unchanged in behaviour from HEAD `directory-projects.js` `readDirectoryProject` and `syncDirectoryProject`, and write through `write.js`.

Tests: `storage-files.test.js` ports `directory-projects.test.js`'s tree tests. `storage-project-meta.test.js` covers:
- the pendingAi round trip with an attachment;
- claim exactly once, plus concurrent claims (one wins);
- a stale `updateProjectMeta` cannot bring `pendingAi` back;
- a foreign `projectId`;
- the `metadataRevision` rule;
- values removal.

### Task 6: `storage/roots.js`, `storage/recent.js`, `storage/project-root.js`

- First fix `editor/test/support/memory-idb.js` so `MemoryHandle` instances are stored by reference (Task 1 follow-up).
- **`roots.js`**:
  - `async storageMode()` (D9);
  - `pickFolder()`;
  - `classifyFolder(handle)` returns `empty`, `project` with `meta`, or `files`, ignoring `.DS_Store`, `Thumbs.db` and `desktop.ini`;
  - `createSubfolder(parent, name)` with slug and `-2`/`-3` collision handling;
  - `queryAccess(handle)` and `requestAccess(handle)` (D9);
  - `opfsProjectsRoot()`, `createOpfsRoot(projectId)`, `listOpfsRoots()`, `deleteOpfsRoot(projectId)`;
  - `persistStorage()`.
- **`recent.js`** (D3): `listRecent()`, `rememberRecent(entry)` (upsert, updates `name`, `kind`, `handle` and `lastOpenedAt`), `forgetRecent(projectId)`, and `findSameEntry(handle)`.
- **`project-root.js`**:
  - `createProjectInRoot(root, { kind, name, files, folders, values, pendingAi, sourceTemplateId, conversationFiles })`: the order is files → values → conversation files (blobs then threads, through the directory store) → pendingAi blobs → `project.json` **last**. It returns `meta`.
  - `adoptFolder(root, { name })`.
  - `listKnownProjects()` returns `[{ projectId, name, kind, source, handle, lastOpenedAt, access }]`:
    - merges recent and OPFS, deduplicated by `projectId`; recent wins;
    - `access` comes from `queryAccess`;
    - for OPFS entries, `lastOpenedAt` is read from a meta-sidecar-free source: the `project.json` file's `lastModified`.
  - `readProjectSnapshot(root)` returns files, folders, values and `conversationFiles`, read as split files straight from the store (no join).
  - `remapConversationFiles(conversationFiles, newProjectId)` remaps every id (the `cloneConversationDocument` semantics moved here, operating on joined documents via core helpers) and interrupts runs. `interruptImportedRuns` also moves here.
  - `makeIndependent(root)` and `copyProject(sourceRoot, destRoot, { name })`.
- Tests:
  - `storage-roots.test.js`: classification, slug collisions, permission fallbacks, `storageMode` probe rejection;
  - `storage-recent.test.js`: upsert, sort, `findSameEntry`;
  - `storage-project-root.test.js`: create order (meta last, verified by injecting a failure after the conversation write), adopt, list deduplication, `makeIndependent` remaps every thread and run id and interrupts active runs, and copy.

### Task 7: Core ZIP v1 history layout (additive)

- In `packages/template-editor-core/src/project.js`, add the new layout **alongside** the legacy `.trafficops/conversations.json`, which keeps working until Task 11:
  - `.trafficops/conversations/<encodeURIComponent(id)>.json` holds split thread files;
  - `.trafficops/conversations/blobs/<sha>` holds the blob bytes.
- `inspectZip`, `readZip` and `readZipProject` take a new option `bytes, { history = false } = {}`:
  - **`false`** keeps `LIMITS.archive` (20 MiB) and rejects new-layout history entries. The legacy entry keeps its current behaviour until Task 11.
  - **`true`** allows `LIMITS.portableArchive` (512 MiB).
  - **User-entry cap:** `LIMITS.count` counts only entries outside `.trafficops/`.
  - **History-entry caps:** at most 100 thread files and 10 000 blobs.
  - **Size limits:** the user-file total stays at 32 MiB, and history entries count against `CONVERSATION_LIMITS.total`.
- `readZipProject` returns `conversationFiles: { threads, blobs }` (threads validated). `createZip(files, { …, conversationFiles })` writes them.
- Async helpers in a new core module `conversation-archive.js`:
  - `conversationFilesFromDocument(document)`, which splits and dedupes;
  - `conversationDocumentFromFiles(conversationFiles, projectId)`, which verifies blob hashes and joins.
- `editor/src/hosts/read-archive.js` becomes `readArchive(bytes, { history = false, signal } = {})`:
  - it passes `history` to the worker as `{ bytes, history }` (`archive.worker.js` handles the new message shape; the bare-bytes shape stays accepted);
  - the timeout is `max(15 s, bytes.length / 2 MiB × 1 s)`.
- Update `contract.d.ts`.
- Tests:
  - core: new-layout round trip with blobs; `history: false` rejects new entries; more than 20 MiB with `history: true`; entry caps; traversal and hidden rules for the new paths; the legacy entry still reads;
  - editor: the `read-archive` option passes through.

### Task 8: Folder-only `StudioHost`

`createStudioHost({ root, meta, language, messages, ai, createProjectRoot, onProjectCreated, now })`.

- **`project.open`**:
  - `readProjectTree` + `readValues` + `readProjectMeta`;
  - a `projectId` mismatch with `meta` throws `ConflictError`;
  - an empty tree gets the in-memory starter, and nothing is written until the first save.
- **`project.save`**:
  - queue + revision CAS;
  - keep today's checks: `values.json` changed outside Studio → `ConflictError`; `project.json` identity or name changed outside Studio → `ConflictError`;
  - `syncProjectTree`, then `writeValues`, then `updateProjectMeta(root, projectId, { name, contentRevision, appliedAiRuns })`.
- **`conversations`**: `createStoreConversationPort(createDirectoryConversationStore(root, { projectId }), { projectId })`. `dispose()` closes the store.
- **`ai`**:
  - pass-through;
  - when `meta.pendingAi` exists, `ai.initialRequest = { ...await resolvePendingAi(...), autoStart: true, claim: () => claimPendingAi(root, projectId, id) }`, resolved during host creation (make `createStudioHost` async, or resolve lazily inside `open`);
  - `mode` defaults to `'create'`.
- **`project.export`**:
  - `source` copies the store's split files through `readProjectSnapshot`, with no re-split, unless `includeHistory === false`;
  - `html` is unchanged.
- **`project.import`** = `readArchive(bytes, { history: true, signal })`.
- **`lifecycle`**:
  - `capabilities.lifecycle: true`;
  - action `save-template` ("Save as template"), shown when `kind === 'landing'`;
  - it calls `createProjectRoot({ kind: 'template', name })`, provided by App, then `createProjectInRoot` with files and values and no history, then `onProjectCreated(meta, root)` so App remembers it;
  - `run` returns a notice.
- Remove `isDirectoryEnabled`, `recovery`, `initial` and every IndexedDB import. `capabilities.autosave` is `true`.
- Tests:
  - rewrite `hosts.test.js` (Studio parts), `pwa-ports.test.js`, `block-preview-host.test.js`, `studio-live-preview-host.test.js` and `studio-agent-workflow.test.js` on `MemoryDirectoryHandle`, with `runHostConformance`;
  - add: reopen round trip; external file, values and meta changes → `ConflictError`; initialRequest/claim exactly once across two hosts; export → import round trip with history (blobs deduplicated); save-template.
- Gate: node suites plus `npm run build:editor`. App still imports the old host shape until Task 9a; it must keep **building**. If needed, keep a thin temporary adapter in App, removed in 9a.

### Task 9a: App, part 1 (flows, boot, open)

- **`editor/src/storage/flows.js`** holds the pure decision functions:
  - `rootDecision(classification)`;
  - `importIdentity(metadata, knownIds)` (D1);
  - `duplicateDecision(known, handle)`;
  - `duplicatePermissionPlan(sourceAccess)` (D8).
- **`createRoot(kind, name)`** (D8: first statement in the click):
  - folder mode: pick, then classify; `project` → FolderChoice "open it / choose another"; `files` → "Create subfolder {slug} / choose another";
  - OPFS: `createOpfsRoot`;
  - abort → no-op.
- **Boot**:
  - `await storageMode()`; `unsupported` → `UnsupportedBrowser`;
  - `listKnownProjects()`;
  - auto-reopen the last project (localStorage `trafficops-studio-last-project`) only when its access is already `granted`.
- **Open from the library**:
  - `requestAccess` in the click;
  - unavailable → a library card state "Folder unavailable" with **Reconnect** (pick, require the same `projectId`, update recent) and **Remove from list**;
  - duplicate `projectId` → FolderChoice **Make independent / Cancel**.
- **Open folder**: `project` → open (with the duplicate check); `files` → `adoptFolder`; `empty` → blank project in it.
- **In-editor access loss**: when a host operation fails with `NotAllowedError`, `NotFoundError` or `SecurityError`, show a toolbar alert "Folder unavailable" with **Reconnect**, and stop autosave. The shell's existing conflict and alert props are the mechanism.
- **Conversation sessions**: keep the `hosts` map and `getConversationSession(host).updateHost` when reopening a project whose run is active.
- **Remove from App**: recovery, `recoveryWriter`, Save-to-folder, `ProjectsDialog`, `installedDisplayMode` storage and AI gating (D7; keep install/update chrome). `aiAllowed` is `true` wherever an AI port exists.
- **EditorShell props**:
  - drop `recovered`, `onSaveToFolder`, `onManageProjects`;
  - `storageSummary` is "Saved to folder {name}" or "Stored in this browser";
  - `storageHelp` explains backups in OPFS mode.
- New components: `FolderChoiceDialog.jsx` and `UnsupportedBrowser.jsx`. Add FolderChoice to `externalModalOpen` handling.
- Tests: `editor/test/storage-flows.test.js` covers every decision function. Gate: node suites plus the build.

### Task 9b: App, part 2 (create, import, duplicate, delete, copies)

- **Create** (dialog and `HomeProjectChat`):
  - `createRoot` first (D8), then read attachments, then `createProjectInRoot` with the starter, a built-in or user template (D2, preloaded on card click), and `pendingAi` via `storePendingAi`;
  - then `rememberRecent` (folder mode), mount, and call `persistStorage` in OPFS mode.
- **Import ZIP**: read the archive, then an "Import {name}" dialog with **Choose folder…** (D8). Its click runs `createRoot`, then the D1 identity rule (copy → `remapConversationFiles`; otherwise interrupt imported runs), then `createProjectInRoot`.
- **Duplicate**: follow D8 (source granted, otherwise a two-step flow), then `copyProject`.
- **Delete**:
  - folder → `releaseConversationSession`, then `forgetRecent`, with "The folder stays on your disk";
  - OPFS → confirm, `releaseConversationSession`, then `deleteOpfsRoot`.
- **Save a copy…** replaces `saveConflictCopy`: `createRoot`, then write the current snapshot.
- **Save as template**: pass `createProjectRoot: ({ kind, name }) => createRoot(kind, name)` and `onProjectCreated` (`rememberRecent` plus library refresh) into `createStudioHost`.
- **StudioLibrary**:
  - cards show `source` (folder or browser) and access state;
  - thumbnails are a placeholder unless access is `granted`;
  - remove "saved in this browser".
- Tests: extend `storage-flows.test.js` for the import identity rule and the duplicate permission plan. Gate: node suites plus the build.

### Task 10: Embed release (phase 3)

- Update `editor/test/creation-browser.mjs`: its server implements the conversation endpoints (reuse `support/http-server.js` logic through a node handler) and sends `conversationsEnabled: true`. Assert that AI chat history persists across a reload through the server.
- Bump `editor/embedded/package.json` to `0.7.0`.
- `editor/README.md` documents the HTTP conversation contract, `conversationsEnabled`, and the PWApps upgrade note.
- `npm run build:embed`, the creation browser test, and `npm run pack:embed` all pass.

### Task 11: Remove the IndexedDB modules, the legacy ZIP entry, and dead code

- Delete the "removed" modules from the file map.
- Remove the legacy `.trafficops/conversations.json` read/write from core, plus its tests.
- Remove the `recoveredConflict` guards in `conversation-runtime.js`, `useEditorProject.js` and `chat-cards.js`.
- Remove the unused "AI recovery" strings from `studio-translations.json`.
- Remove `StudioAiPort` `isEnabled` and its tests.
- Delete the node tests that only tested removed modules:
  - `studio-library`
  - `studio-ai-recovery`
  - `block-ai-recovery`
  - `library-host`
  - `library-ai-recovery-host`
  - `portable-project`
  - `project-transfer`
  - `studio-conversations`
  - `directory-projects` (already ported)
- Make `studio-ai-workflow.test.js` and `studio-catalog.test.js` use plain snapshots.
- `grep -rn indexedDB editor/src` → only `storage/recent.js` and `openrouter-settings.js`.

### Task 12: Browser tests (three parts)

**Shared helper** `editor/test/support/studio-folders.js`:
- `installFolderPicker(page)`:
  - an init script replacing `showDirectoryPicker`;
  - **throws `SecurityError` unless `navigator.userActivation.isActive`**;
  - returns a real OPFS directory under a separate root `picker/<name>`, where the name comes from localStorage `test-folder-picker` or an incrementing default, so the folders are never listed as OPFS projects.
- `seedProjectFolder(page, { name, kind, files, values, conversations, pendingAi, register = true })`: runs the real `createProjectInRoot` in the page through a test bundle built with esbuild from `editor/src/storage/*` (`retained-draft-settings` already bundles modules this way) and registers the folder in recent.
- `openProject(page, name)`.
- `revokeAccess(page)`: stubs `FileSystemHandle.prototype.queryPermission` and `requestPermission` to return `'prompt'` and `'denied'`.

Rewrite every test listed below to seed through the helper. Keep each feature's assertions.

- **12a, core flows**:
  - studio;
  - `pwa-access` → `storage-access-browser.mjs`: AI and folders in a plain tab, an unsupported screen when both APIs are removed, and OPFS mode when only the picker is removed;
  - library;
  - `project-folder`: empty folder, existing project, non-empty folder → subfolder, cancel, adopt, duplicate `projectId` → Make independent, ZIP import (D1 + D8 button), OPFS mode, delete semantics, Save a copy, Save as template;
  - `recovery` → `folder-access-browser.mjs`: external edit → conflict → Reload, and revoked access → Folder unavailable → Reconnect;
  - interactive-editor;
  - plus `storage-contract-browser.mjs`: runs `conversationStoreContract` on a real OPFS root, with a real peer through `BroadcastChannel`, the GC grace period, the pendingAi claim, and a history ZIP over 20 MiB round trip.
- **12b, AI tests**: library-ai, conversations, home-chat, file-ai, block-ai, fill-content, optiheart-ai, agent, ai-panel-ui, branches.
- **12c, the rest**: conversation-ui, clipboard-images, rich-text, retained-draft-settings, plus any other test that still references `trafficops-studio-library`, `trafficops-studio-conversations` or `trafficops-landing-workspace` (verify with grep).

Update the CI list (`.github/workflows/ci.yml` l.78–98) and the README commands for renamed or removed files. Every CI-listed test passes locally against `editor/dist`.

### Task 13: Docs and spec amendments

- Rewrite the `editor/README.md` sections Workflow, storage/folder, import bounds and "AI recovery" for folder-first storage.
- In the spec, add a "Spec amendments" section (D1–D11 and deviations) and mark the "Notes for phase 2" items done or deferred.

### Task 14: Final verification and review

- Node suites for core, shell and studio, and the full CI browser list, all green.
- `build:editor`, `build:embed` and `pack:embed` succeed.
- Removed-module grep is clean.
- Final whole-branch review (Opus), then fix any findings.
