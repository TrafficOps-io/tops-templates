# Folder-first project storage

Date: 2026-10-02
Status: design approved in discussion; spec review passed (4 rounds)
Scope: sub-project 1 of 3, covering Studio storage and the shared conversation format. PWApps server-side history and fast-landings editor integration are separate specs that consume the contracts defined here.

## Problem

Studio keeps project data in IndexedDB:

- `trafficops-studio-library` holds the projects.
- `trafficops-studio-conversations` holds the history.
- `trafficops-landing-workspace` holds recovery data.
- `trafficops-studio-ai-recovery` holds legacy AI drafts.
- `trafficops-template-studio` holds folder handles.

A folder on disk exists only in the installed PWA, and it is just a mirror of that data.

The whole conversation history of a project is one document capped at 128 MiB (`CONVERSATION_LIMITS`, enforced by `clonePortablePayload`). Every save re-encodes and re-verifies it. Two things make it big:

- **Run file snapshots.** `snapshotOf` copies every project file into `base`, `starting`, `checkpoint` and `result`.
- **Image attachments**, stored as base64 `dataUrl` strings.

The embedded editor (`HttpHost`) reuses the same IndexedDB conversation store, so in PWApps dialogues live in one browser only.

## Goals

- A project always lives in a directory that is its source of truth: a user-chosen folder in Chromium, or OPFS where `showDirectoryPicker` is unavailable.
- No project data in IndexedDB.
- History is stored per dialogue. Large values (snapshot files, attachments) are stored once each, as content-addressed blobs.
- Studio (directory) and embedding hosts (HTTP) share one conversation format and one `ConversationStore` contract.
- Browser-tab and installed-PWA modes behave identically.

## Non-goals

- Migrating existing IndexedDB data. There are no users yet, so the old databases and every legacy path are deleted: `migrateLegacy`, `legacyMigrated`, AI recovery drafts, and the single-file `conversations.json`.
- Lazy per-dialogue loading in the conversation runtime. The runtime keeps working on one whole in-memory document. That leaves an in-memory cap (see Limits), which is a follow-up if it is ever reached.
- Server implementations in PWApps or fast-landings.
- Moving data from OPFS to a real folder. OPFS exists only where real folders do not, and the editable ZIP is the way out.

## Decisions

| Topic | Decision |
|---|---|
| Browsers without `showDirectoryPicker` | OPFS fallback at `navigator.storage.getDirectory()/projects/{projectId}/`. Minimums are Safari / iOS 26 and Firefox 111, the first versions with `FileSystemFileHandle.createWritable()`. Detect support by checking `'createWritable' in FileSystemFileHandle.prototype`, not `getDirectory`, because Safari 15.2–18 has `getDirectory` but cannot write from the main thread. Unsupported browsers see an "Update your browser" screen; there is no worker `createSyncAccessHandle` fallback |
| Tab vs PWA | One mode. Every `installedDisplayMode()` gate for storage and AI is dropped. The PWA is only window chrome, install/update and offline |
| Existing IDB project data | Abandoned, with no migration code |
| Remaining IndexedDB | Device-level, non-project data only: the `recent` handle registry, and OpenRouter settings (`trafficops-template-studio-ai`; secrets never enter a project folder) |
| Layout | All internal files under `.trafficops/` |
| When the folder is chosen | On the user action that creates a project, before any write |
| Conversation runtime | Keeps its document-shaped port. An adapter maps the document onto per-thread files and blobs, and runs the CAS per thread using revisions carried *inside* the document |
| Embedded history | Stored on the host server over HTTP. AI chat is disabled when the host does not expose it |
| Team visibility | Host policy. The format has an optional `createdBy` |

## Project folder format v1

```
<project root>/
├── …user files…                 the editable tree; hidden entries are never listed
└── .trafficops/
    ├── project.json             identity, revisions, pendingAi
    ├── values.json              parameter values (unchanged; PWApps ProjectArchive reads it)
    └── conversations/
        ├── {threadId}.json      one dialogue and its runs
        └── blobs/
            └── {sha256}         raw bytes, no extension
```

### `project.json`

It keeps the existing `validatePortableMetadata` fields: `schema`, `projectId`, `kind`, `name`, `contentRevision`, `metadataRevision`, `createdAt`, `sourceTemplateId`, `contentHash` and `appliedAiRuns`.

`metadataRevision` counts only changes to identity metadata (`name`, `kind`). It no longer mirrors the conversation revision, and these writers change:
- `StudioHost.js:96` and `:123` stop writing `currentHistory.revision` / `document.revision` into it.
- `portable-project.js:74` stops writing `document.revision` into it.
- `portable-project.js:71` stops comparing the whole-document `conversations.revision`. On a ZIP "Continue project" import, the history is merged per thread with the same per-thread CAS, through the adapter.

Conversation freshness is tracked per thread only.

The fields that `validateStudioProject` holds today (`aiPrompt`, `aiAttachments`, `aiGenerateImages`, `aiStarted`) move into an optional `pendingAi: { id, prompt, mode, attachments, generateImages }`. Its attachments are blob references. `StudioHost` exposes `pendingAi` as `host.ai.initialRequest = { id, prompt, mode, generateImages, attachments, autoStart: true, claim }`. The attachments come with their blob references resolved back to `{ id, name, mime, dataUrl, useOnPage }`. Apart from `attachments`, this is the shape `HttpHost` already passes (`{ ...initialAiRequest, mode, claim }`). `claim()` runs under the `project-meta` lock. If `pendingAi.id` matches, it removes `pendingAi` from `project.json` and returns `true`; otherwise it returns `false`. The runtime's existing guard (`run.initialClaim`, `conversation-runtime.js:354`) then gives the current semantics:
- A queued run that has not been claimed yet resumes after a crash.
- An already-claimed request reports "already started, continue explicitly", and the prompt is never sent twice.

### Thread file

```json
{
  "schema": 1,
  "id": "<threadId>",
  "revision": 7,
  "title": "…",
  "updatedAt": 1790000000000,
  "createdBy": { "id": "…", "name": "…" },
  "messages": [ … ],
  "runs": [ … ]
}
```

- `runs` contains exactly the runs whose `threadId` equals `id`. A run without a matching thread is rejected.
- `revision` belongs to the store, which assigns previous + 1 on every successful write. In memory it travels on the thread object (`thread.revision`), which is what makes the per-thread CAS sound (see Adapter).
- `createdBy` is optional. Hosts set it, and Studio leaves it out.

### Blob references

`splitThread` replaces two kinds of values with `{ "$trafficopsBlob": "<sha256>", "encoding": "<e>", "size": <bytes> }`:

| Location | Value | `encoding` |
|---|---|---|
| Any `files` map in a run snapshot (`base`, `starting`, `checkpoint`, `result`), any depth | string ≥ 4 KiB | `utf8` |
| Same | `Uint8Array` | `bytes` |
| Any attachment object (`{ mime, dataUrl }`) in messages, runs or `pendingAi` | `dataUrl` | `dataUrl`; the blob holds the decoded bytes, and `mime` stays on the attachment |
| Anywhere else | `Uint8Array` | `bytes` |

`joinThread` restores the original type exactly. The round-trip is required to be lossless (property-tested). Identical snapshot files across runs, and images reused as references, are stored once.

### Document-level fields

`error` and `storageWarning` are local to the runtime and are never persisted.

`legacyMigrated` is removed together with the legacy migration path (`conversation-runtime.js:274–305`). One piece of that path is not legacy: the `initial.autoStart` branch (`:300–304`), which queues the kickoff run with `initialClaim: initial.id`. It moves into a standalone runtime step, `queueInitialRequest()`, which runs on load. If no run has `initialClaim === initial.id`, it does in one mutation what `:281–290` and `:300–304` do today:
- create the thread;
- create the user message with `initial.prompt` and `initial.attachments`;
- push the queued run.

The thread, message and run ids are deterministic, derived from `initial.id`: `initial-thread-${h}`, `initial-message-${h}`, `initial-run-${h}`, with `h = conversationContentHash(initial.id)`. When two windows open the same new project, both create the same thread file with `expectedRevision 0`. The second create fails the store CAS, the reload sees the run, and the second window skips the step. Random ids would instead produce two dialogues, one of them failed. A host without `claim` keeps the current behaviour: `:354` treats the request as already started.

## Limits

These are the new values for `CONVERSATION_LIMITS` in `template-editor-core`.

| Limit | Value | Enforced in |
|---|---|---|
| Threads per project | 100 (unchanged) | adapter: only saves that add a dialogue are capped, and an already-persisted overflow is tolerated with a `storageWarning`. Stores do not enforce it |
| Messages per thread | 500 (unchanged) | format validation |
| Runs per thread | 100. This replaces the per-document check at `conversation-runtime.js:518, 615` and in `validateConversationDocument` | runtime, format validation |
| Thread JSON size, encoded, blobs excluded | 16 MiB | stores |
| One blob | 24 MiB (the PWApps image proxy cap) | stores |
| Joined in-memory document | 512 MiB decoded, 2,000,000 nodes. This replaces 128 MiB / 500k, and the 8 MiB per-byte-array rule becomes 24 MiB | `clonePortablePayload` |

Project file limits (`LIMITS`, 32 MiB of user files) are unchanged.

## Units

### `template-editor-core`

**`conversation-format.js`** is pure, with no I/O:
- It validates the thread file and blob references, and holds the limits.
- `threadsOf(document)` and `splitThread(thread) → { thread, blobs: Map<sha256, Uint8Array> }` (per thread, so the adapter can cache and skip)
- `joinThread(thread, getBlob)` and `documentOf(projectId, threads, revision)`
- `threadHash(thread)`: a hash of the canonical split thread with `revision` excluded.

**`ConversationStore` interface** (JSDoc typedef):
```
listThreads({ signal })                           → Thread[]      // full split threads
writeThread(thread, { expectedRevision, signal }) → { revision }  // expectedRevision 0 = create; ConflictError on mismatch
deleteThread(id, { expectedRevision, signal })                    // missing thread → resolves (idempotent)
putBlob(sha256, bytes, { signal })                                // idempotent; store verifies the hash
getBlob(sha256, { signal })                       → Uint8Array
watch?(onChange)                                  → unsubscribe   // optional cross-window change signal
collectGarbage?({ signal })                                       // optional; references are computed from persisted threads; stores without it leave GC to the host
```
There is no separate index: `load` needs every thread anyway.

**`createStoreConversationPort(store, { projectId })`** implements the existing `host.conversations` port (`load`, `save`, `subscribe`) on top of any store.

- **Per-dialogue rebase.** This replaces an earlier "reject any stale copy" rule. Code review showed that rule starves a window while another window streams: every refresh made each in-flight runtime copy stale, and four lost attempts abort an AI run.
  1. *Base snapshot.* For every published `document.revision` (the local counter), the adapter remembers the entries `{ id → revision, hash }` that document was built from, keeping the last 16. `save(document, { expectedRevision })` diffs the incoming document against that **base**. An `expectedRevision` that is no longer remembered is a `ConflictError`.
  2. *Change detection against the base.*
     - A thread whose hash and revision equal the base entry was not changed by the runtime and is not written.
     - A thread present in the base but absent from the document was deleted by the runtime. It is deleted with `expectedRevision` set to its base revision.
     - Threads created elsewhere after the base are never deleted.
  3. *Store CAS.* Each written thread uses `expectedRevision = thread.revision ?? 0`, where `0` means create. A thread that another window changed after the base fails the CAS. Only real per-dialogue conflicts reach the runtime.
  4. *Result.* The returned and published document is the runtime's changes rebased onto the current state:
     - changed threads carry their new revisions;
     - unchanged threads take the current snapshot's version;
     - threads created elsewhere are appended.
- **Refresh.** Watch events are coalesced, so at most one refresh is queued. A refresh compares the listing signature first, reuses joined threads whose revision is unchanged, and publishes only when the valid `(id, revision)` set or the warning changed. A file that fails to read while an older valid version is known keeps that version visible, and the next refresh retries it.
- **Save cost.** Only the expensive part, blob hashing, is cached. Everything else is re-serialized on every save.
  - The blob split of the four snapshot fields of a run (`base`, `starting`, `checkpoint`, `result`) is cached under `(run.id, run.updatedAt)`.
  - Attachment blobs are cached under `attachment.id` + `mime` + `dataUrl` length, because attachment content is immutable once it has an id.
  - All other run fields (`owner`, `state`, `phase` and so on) and every message field, including `status`, are re-serialized on every save. The thread hash is taken over that small split form.
  - So a heartbeat, which changes only `owner.expiresAt` and does not bump `updatedAt` (`conversation-runtime.js:319`), still reaches the store without hashing any snapshot file.
  - This relies on two runtime invariants:
    - Snapshot fields change only in mutations that bump `run.updatedAt` (`ownedMutation`, `:335`; also `stop`, `discard`, `markApplied`, `reconcileApplied`, `recoverOrphans`). This holds today.
    - `run.updatedAt` strictly increases per run, as `max(now(), previous + 1)`. This is new in phase 1: with plain `now()`, two snapshot mutations in the same millisecond, such as the last checkpoint flush and the final `result` (`:466–471`), would share a cache key.
    
    Both are tested.
- **Serialization.** All adapter operations run through one queue, so a reload can never swap the snapshot in the middle of a save's diff and I/O. The queued operations are `load`, `save` and the coalesced refresh triggered by `watch`. GC is started after the operations already queued, but later operations do not wait for it, so a store that never settles a collection cannot block saves.
- **Heartbeat-tick conflicts are quiet.** The heartbeat tick is the `setInterval` in `createConversationSession` (`conversation-runtime.js:316–322`): the lease mutate at `:319` plus `recoverOrphans()` at `:321`. When either exhausts its retries on `ConflictError`, it does not call `report` (no `doc.error`), and the next tick retries.
  - The interval is `min(15 s, lease / 3)` against a 60 s lease, so up to 2 consecutive quiet misses are safe.
  - On the 3rd consecutive miss, the error is reported as it is today.
  - With a second window open, heartbeat conflicts can still happen when both windows touch the same dialogue.
- **Write order per thread.** First `putBlob` for every blob the thread references, then `writeThread`. The new revision is stamped back onto the thread.
- **Document revision.** `document.revision` is a monotonic counter local to the adapter. It is never persisted, and it increments on every `load` and `save` result and on every refresh that published a change. The runtime's checks are therefore satisfied: `receive` accepts `next.revision >= doc.revision`, and `mutate` passes `previous.revision`, which feeds the local CAS level.
- **Multi-thread saves are not atomic.** When thread A commits and thread B conflicts, the adapter throws `ConflictError` and the runtime reloads the *whole* document (`conversation-runtime.js:253`) and re-runs `change`. Every mutation must therefore converge, so that re-applying it to a state already holding a partial commit gives the same result. This holds today for the multi-thread mutations `recoverOrphans`, the heartbeat and `reconcileApplied` (set state or owner and mark applied). The spec makes it a tested requirement.
- **`subscribe`.**
  - When the store has `watch`, a change triggers the coalesced refresh; it bumps the counter and delivers to listeners only when the valid `(id, revision)` set or the warning changed.
  - Without `watch` (HTTP), there is no cross-tab signal, and conflicts surface on the next write.
  - Same-window listeners are notified after every `save`.
- **GC.** If the store supports `collectGarbage()`, the adapter schedules it in its queue, without awaiting it inside the save and at most once every 5 minutes, after a `save` that deleted threads or dropped blob references and on the first `load`. The store's 10-minute grace period makes the delay safe. The adapter passes no reference set: a store computes references from its own persisted threads, never from an in-memory document that may be stale.

**`conversation-store-contract.js`** is a reusable test suite. It takes a store factory and covers:
- round-trip
- create/update CAS and conflict
- idempotent delete
- idempotent blob upload and hash rejection
- limit rejection
- GC that keeps referenced blobs and recent ones

It is exported so hosts can run it.

### `editor/src/storage/` (Studio)

| Module | Responsibility | Replaces |
|---|---|---|
| `roots.js` | `chooseFolder()`: picker plus the empty / existing-project / create-subfolder decision. Also `createOpfsRoot(projectId)`, `listOpfsProjects()` and permission checks | parts of `directory-projects.js` |
| `recent.js` | IDB registry `{ projectId, name, kind, handle, lastOpenedAt }`, kept in the existing `trafficops-template-studio` database | `listDirectoryProjects`, `rememberDirectoryProject` |
| `write.js` | The only caller of `createWritable()`. It writes one file atomically: the swap file commits on `close()` | scattered writers |
| `files.js` | Project tree read, and `sync(previous, next)` with external-change detection (`ConflictError`) | `readDirectoryProject`, `syncDirectoryProject` |
| `project-meta.js` | Read/write of `project.json` and `values.json` under `navigator.locks` `trafficops-project-meta:{projectId}` | `read/writeProjectMetadata`, `read/writeProjectSettings` |
| `directory-conversation-store.js` | `ConversationStore` over `.trafficops/conversations/` | `studio-conversations.js` |

**`directory-conversation-store.js` details:**
- **Locking.** `writeThread` and `deleteThread` run inside `navigator.locks` `trafficops-conversations:{projectId}`, which serializes the read-compare-write across same-origin windows. `putBlob` needs no lock (content-addressed, idempotent). External processes such as git or another machine are not locked. A revision mismatch with the file on disk is still a `ConflictError`.
- **`listThreads`.** It reads every `*.json` in `conversations/`. A file that fails validation is skipped, and the skip is reported through `storageWarning`; the file is never deleted.
- **`watch`.** A `BroadcastChannel` named `trafficops-conversations:{projectId}`. After each committed write or delete, the store posts `{ threadId, revision }`.
- **`collectGarbage()`.** Runs under the same lock as thread writes and reads the referenced set from the thread files on disk. It deletes a blob only if it is unreferenced *and* its `lastModified` is older than 10 minutes. The grace period protects a blob that another window uploaded but whose thread is not written yet.
- **`putBlob` on an existing blob.** If the existing blob's `lastModified` is older than 5 minutes, it is rewritten with the same bytes *under the conversations lock*. This refreshes the grace period for a blob that is being referenced again, and it cannot interleave with a GC pass. Otherwise the call does nothing. A new blob is written without the lock: GC cannot see it before it exists, and once it exists it is within the grace period.

**Removed:**
- `studio-library.js`, `workspace-storage.js`, `studio-ai-recovery.js` and the `host.ai.recovery` / `migrateLegacy` wiring
- `hosts/LibraryHost.js`, `project-transfer.js`
- the "Save to folder" transfer flow (`completeFolderTransfer`, and the `App.jsx` handler around `:348–369`)
- the IndexedDB parts of `studio-conversations.js` and `directory-projects.js`
- the `installedDisplayMode()` checks in `App.jsx` and `createStudioAiPort`

`app-mode.js` stays for PWA chrome only. `StudioHost` becomes the only Studio host and always receives a directory handle, either real or OPFS.

### `editor/embedded/src/` (HttpHost)

- **`http-conversation-store.js`** implements `ConversationStore` over the HTTP contract. It has no `watch` and no `collectGarbage`.
- `HttpHost` stops importing `../../src/studio-conversations.js`. It exposes `ai` and `conversations` only when both `initial.aiEnabled` and `initial.conversationsEnabled === true` hold.

## HTTP conversation contract

Paths are relative to the host `endpoint`. Requests carry `X-CSRF-TOKEN` and `credentials: 'same-origin'`, the same as the existing calls.

| Method and path | Request | Response |
|---|---|---|
| `GET /conversations` | — | `200 { threads: Thread[] }` (full split threads) |
| `PUT /conversations/{id}` | `Thread` JSON and `If-Match: "<revision>"`, where `"0"` means create. The `revision` field in the body is ignored | `200 { revision }`, or `409` on mismatch |
| `DELETE /conversations/{id}` | `If-Match: "<revision>"` | `204` (also when the thread is already missing), or `409` on mismatch |
| `PUT /conversation-blobs/{sha256}` | raw bytes, `Content-Type: application/octet-stream` | `201` or `200`. The server checks that the SHA-256 of the body equals the path |
| `GET /conversation-blobs/{sha256}` | — | `200` bytes, or `404` |

Error mapping in `http-conversation-store`:
- `409` → `ConflictError`
- `413` → `Error` with the limit message
- `422` → `ValidationError` (`code: 'validation'`; the adapter re-uploads all blobs once on this code) (hash mismatch, or a thread that references a missing blob; the client always uploads blobs first)
- `404` on `GET` blob → `Error('A conversation attachment is missing on the server.')`

Hosts own GC of unreferenced blobs. When `initial` lacks `conversationsEnabled: true`, the embed shows no AI chat. PWApps stays on embed 0.6.x until it implements the contract (sub-project 2).

## Data flow

**Create** (home prompt, New project, From template):
1. In the click handler, before any other `await` (to keep transient user activation), call `showDirectoryPicker()`. In OPFS browsers, create `projects/{uuid}` instead.
2. Decide based on the folder:
   - Empty: use it.
   - Has `.trafficops/project.json`: offer "Open project {name}".
   - Not empty, no `project.json`: offer "Create subfolder `{slug}`" or "Choose another".
3. `AbortError`: nothing changes, and the prompt input stays.
4. Generate the `projectId`. Write the starter or template files, `values.json` and `project.json` (with `pendingAi` for a home prompt).
5. Register in `recent`, then mount `StudioHost`.
6. For a home prompt, run the AI kickoff, and clear `pendingAi` after the kickoff run is persisted.

"From template" copies files and values without conversations. A user template is a project with `kind: "template"`. Built-in templates stay bundled.

**Home list** is `recent` plus `listOpfsProjects()`, sorted by `lastOpenedAt`. Opening a project calls `requestPermission()` inside the click.

**Duplicate `projectId`.** A folder copied in Finder or cloned twice has the same `projectId`, which would collide on lock names, the `BroadcastChannel` and `recent`. When a folder is opened, `recent` is searched for another entry with the same `projectId`. If that entry's handle is still accessible and `isSameEntry` is false, Studio says "This folder is a copy of {name}" and offers one action, "Make independent". That action:
- writes a new `projectId` to `project.json`;
- rewrites every thread through `cloneConversationDocument`, which remaps the ids and interrupts active runs;
- registers the folder as a new `recent` entry.

Cancelling leaves the folder closed.

**Open folder:**
- With `project.json`: open it.
- With files only: adopt it. A `projectId` is generated immediately, and `project.json` is written right away, before `recent` registration. Only `.trafficops/` is created, and no user file is touched.
- Empty: offer to create a project.

**Autosave:** editor state → debounce → `files.sync` + `project-meta`.

**History save:** runtime → adapter → blobs → thread file (under lock) → `BroadcastChannel`.

**Remove:**
- Real folder: only removed from `recent`, never deleted.
- OPFS project: deleted recursively after confirmation.

## Editable ZIP

The ZIP mirrors the folder layout: `.trafficops/conversations/*.json` and `.trafficops/conversations/blobs/*` replace the single `conversations.json` entry. A hosting ZIP still contains no sidecars.

| | Limit |
|---|---|
| Whole archive | `inspectZip`, `readZip` and `readZipProject` take a new option `{ history: boolean }`, default `false`. With `false`: today's 20 MiB `LIMITS.archive`, and any `.trafficops/conversations/**` entry is rejected. With `true`: `LIMITS.portableArchive = 512 MiB`. Only Studio's editable-project import passes `true`; hosting, template import and the embed's server-side import keep the default |
| Entry count | `LIMITS.count` (500) counts only user entries outside `.trafficops/`. History entries have their own cap: 100 thread files plus at most 10,000 blobs |
| User files | unchanged: 32 MiB expanded, counted only over entries outside `.trafficops/` |
| Main thread | ZIPs with history are packed and unpacked in the existing `archive.worker.js`, never on the main thread |
| `.trafficops/conversations/**` entries | counted separately against the in-memory document limit (512 MiB expanded), for both export and import |
| History opt-out | the existing control stays. It is the way to export a small ZIP that also fits the 20 MiB host import limit (PWApps `import`) |

Import of the new layout:
- **Continue:** `interruptImportedRuns`.
- **Copy:** remap every identifier with `cloneConversationDocument`.

Both run on the joined document before the threads are written to the new root.

## Errors

| Situation | Behaviour |
|---|---|
| Permission denied, or the folder was moved or deleted | Editor goes read-only with a "Folder unavailable" banner. "Reconnect" picks a folder and requires a matching `projectId`; "Remove from list" is the other option |
| A user file changed outside Studio | Autosave stops; banner with "Reload" and "Overwrite" (current behaviour) |
| A thread revision conflicts | The runtime reloads the whole document and retries the change, up to 4 attempts (current `mutate` behaviour). The composer draft is kept |
| A blob write fails | That thread is not written, and the run is marked failed with "Retry" |
| A thread file fails validation | Skipped, with a `storageWarning`. The file is never deleted |
| OPFS `QuotaExceededError` | "Browser storage is full — export the project as ZIP" |
| Over limits (`413` or local validation) | Shown in the chat; nothing is written |

## Testing

**Core:**
- property test that `splitThread` and `joinThread` round-trip losslessly, covering strings, `Uint8Array` and `dataUrl`
- blob deduplication across runs
- rejection of a run that has no thread
- limits
- the contract suite against an in-memory store

**Adapter:**
- A stale-thread save is rejected: two adapters on one store, A writes thread T, then B saves a document whose T has the old revision, and B gets `ConflictError`.
- A stale copy is rebased: a dialogue created elsewhere after the copy is kept and appears in the result; a save from a revision that was never published, or that is older than the last 16, throws `ConflictError` before any I/O.
- Untouched stale threads are never written.
- A heartbeat-only mutation reaches the store (another adapter sees the new `owner.expiresAt`) and computes no blob hashes (spy on the hash function).
- A message `status` change reaches the store.
- Every runtime mutation that changes a run's snapshot fields bumps `run.updatedAt`, and two mutations in the same millisecond (fake clock) still yield strictly increasing values.
- Two adapters running `queueInitialRequest` concurrently on one store produce exactly one thread and one run.
- Two consecutive heartbeat-tick conflicts leave `doc.error` unset; a third reports.
- A `watch` reload that arrives during save I/O is applied only after the save completes.
- `queueInitialRequest` with a crash before `claim`, after `claim`, and on a double open.
- Partial multi-thread commit followed by reload and retry converges. `recoverOrphans`, heartbeat and `reconcileApplied` are re-applied on top of a partial state.
- The counter always increases across `load`, `save` and `watch`.

**Studio:**
- the contract suite against `directory-conversation-store` on an OPFS handle
- browser tests that replace `window.showDirectoryPicker` with a function returning a real OPFS subdirectory handle (production code, no filesystem mocks), covering:
  - empty folder
  - existing project
  - non-empty folder
  - cancel
  - reconnect
  - external change
  - blob GC grace period and re-reference refresh
  - `pendingAi` claim
  - duplicate `projectId` detection
  - the unsupported-browser screen when `createWritable` is missing
  - a ZIP with history above 20 MiB round-trips

**Embed:**
- the contract suite against `http-conversation-store` with a fake server running in the test process
- AI is hidden when `conversationsEnabled` is absent

**Existing browser tests:** those in `editor/test/` that depend on the IndexedDB library or recovery (`library-browser`, `recovery-browser`, `durable-ai-recovery-browser`, `retained-draft-settings-browser`, `project-folder-browser`, `pwa-access-browser` and others) are rewritten for the folder-first flow, or deleted together with the feature they test.

**Manual:** one smoke pass in Chrome with a real folder, and one in Safari 26+ with OPFS.

## Delivery phases

1. **Core:** format, split/join, limits, the `ConversationStore` contract suite, the adapter, and the runtime changes (per-thread run limit, legacy path removed). Studio still runs on its old storage at this point.
2. **Studio storage:** `storage/*`, the directory store, folder-first create/open flows, and removal of the IndexedDB library and the mode gates.
3. **Embed:** the HTTP store, the `conversationsEnabled` gate, and an embed release.

## Notes for phase 2 (from phase 1 reviews)

- **Thread ids become file names.** `{threadId}.json` must encode ids, for example with `encodeURIComponent`. Ids created by the runtime are UUIDs or `initial-*-<len>-<hash>`.
- **Monotonic revisions across delete and recreate.** The adapter reuses a joined thread when its revision is unchanged. The directory store must therefore never restart a dialogue's revision at 1 after a delete followed by a recreate with the same id; one way is to keep a revision tombstone. The memory store restarts revisions in that case. Deterministic initial-request ids make this reachable, though it is rare.
- **The directory store's `watch` must pass the contract with a real `openPeer`.** A `BroadcastChannel` never hears its own posts.
- **GC in the directory store must not run while thread files are unreadable.** If a file cannot be parsed, its references are unknown, so GC must skip that pass instead of deleting the blobs that file may reference.
- **GC has no follow-up timer.** A deletion that happens inside the 5-minute window is collected on the next qualifying save or load.
- **Renaming, or sending a clarification to, a dialogue that is streaming in another window** can lose all 4 attempts. These are real per-dialogue conflicts, and the error goes to the caller. Consider retrying the rename after the run's next checkpoint.
- **Dead guards remain.** `recoveredConflict` checks in `conversation-runtime.js`, `useEditorProject.js` and `chat-cards.js`, and the unused "AI recovery" strings in `studio-translations.json`, can be removed together with Studio's `ai.recovery` wiring.

## Follow-ups (separate specs)

1. **PWApps:** implement the HTTP contract (storage, `createdBy`, visibility, blob GC), run the contract suite, and upgrade the embed.
2. **fast-landings:** embed the editor through `HttpHost` over `_file_editor/{user}/{id}/content/`, with `.trafficops/` format v1 inside, and serve conversations from the same tree.
