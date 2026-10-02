# @trafficops/studio-ui

Primitives, resizable workspace, i18n and the chat contract shared by TrafficOps studios (Landing Studio, Media Studio, embeds).

## Install

```sh
npm install @trafficops/studio-ui @trafficops/studio-tokens
```

Peer dependencies: `react` and `react-dom` ^19.2, `@assistant-ui/react` ^0.15 (required by `StudioChat`). Styles come from `@trafficops/studio-ui/styles.css` plus the tokens and themes of `@trafficops/studio-tokens`; process them with Tailwind CSS 4 and daisyUI 5.

## Provider and root

```jsx
import { StudioUiProvider } from '@trafficops/studio-ui/i18n';

<StudioUiProvider language="en" messages={overrides} portalContainer={shadowRootElement}>
  <div className="studio-root">{/* studio UI */}</div>
</StudioUiProvider>
```

- `language`: built-in dictionary language. `messages`: override dictionary keyed by the source string. `portalContainer`: element for layers inside a shadow root.
- All markup must sit inside an element with the `studio-root` class. Without it the `--ui-*` tokens and the `:focus-visible` ring do not apply.

## Primitives (`@trafficops/studio-ui/primitives`)

- `Button` — `variant`, `size`, `icon`, `loading`, `disabled`.
- `Tabs`, `Segmented`, `tabPanelProps` — `items`, `value`, `onChange`, `label`, `variant`; arrow-key navigation.
- `Menu` — `label`, `trigger`, `disabled`; the popup renders inline (`portalContainer` support is a later version).
- `Modal` — `title`, `onClose`, `onSubmit`, `confirmLabel`, `confirmFirst`, `busy`; traps focus.
- `ConfirmDialog` — `title`, `description`, `confirmLabel`, `danger`, `busy`, `onConfirm`, `onClose`.
- `EmptyState` — `icon`, `title`, `description`, `action`.
- `StatusBadge` — `tone`. `InlineNotice` — `tone`, `title`, `actions`.
- `ToastProvider`, `useToast` — transient notifications.
- `Skeleton` — `shape`, `width`, `height`.
- `MentionChip`, `AttachmentChip`, `formatBytes` — chat reference and attachment chips.

## Workspace (`@trafficops/studio-ui/workspace`)

`ResizableWorkspace` lays out sidebar, author and preview panes with keyboard-operable separators. Props: `panels` (CSS selectors of the panes), `minimums` (`sidebar`, `author`, `preview` widths in px), `storageKey` (localStorage key for saved widths). Focus helpers live in `@trafficops/studio-ui/workspace/focus`.

## i18n

`@trafficops/studio-ui/i18n` exports `StudioUiProvider`, `useStudioText`, `usePortalContainer`. For plain Node code (which cannot load `.jsx`) use the JSX-free paths `@trafficops/studio-ui/i18n/translation` and `@trafficops/studio-ui/i18n/studio-translations`.

## Chat

### ChatPort

`ChatPort` is the contract between a product and the chat UI: see [`chat/port.d.ts`](chat/port.d.ts) (types only, no React or assistant-ui types; `@trafficops/studio-ui/chat/port`). Optional members (`previewDraft`, `answer`, `continueRun`, `keepDraft`, `dispose`, `capabilities.conflictReview`, `capabilities.keepDraft`, `capabilities.clarifyWhileRunning`, `capabilities.discardStopped`) may be left out; `StudioChat` hides the matching actions. Product-specific methods (for example `registerBlockScope`) are not part of the contract and stay on the adapter object. Two rules:

- `RunState.id` equals the `id` of the assistant message. Otherwise `stop/apply/discard(runId)` cannot find the message.
- `toolCallId` is deterministic and unique within a message (it keys `part-update` events and React lists). The recommended form is `` `${messageId}:${index}` `` by the part's position in `parts`; any other stable key is fine (Landing Studio uses the file path, `r1:diff:index.tpl`). `StudioChat` only compares `toolCallId` for equality.
- Text of an assistant message travels one way: either in `messages()` snapshots or as `text-delta` events, never both for the same text. `StudioChat` keeps streamed deltas beside the snapshots (a new snapshot does not wipe them); once a snapshot carries text for that message, the snapshot wins.
- `ReadableStore.subscribe(fn)` calls `fn(value)` on every change; the initial value is read with `get()`. Every `events(threadId)` call is an independent subscription that receives events emitted after the call; `return()` ends it and releases a pending `next()`.

A minimal port (see `test/fixtures/FakeChatPort.js` for a complete in-memory one):

```js
const port = {
  threads: store([]),                       // ReadableStore<Thread[]>
  messages: threadId => messageStore(threadId),
  events: threadId => subscribe(threadId),  // AsyncIterable<ChatEvent>
  async createThread() { return api.post('/threads') }, // a real Thread with an id
  async send(threadId, input) { await api.post(`/threads/${threadId}/messages`, input) },
  stop: runId => api.post(`/runs/${runId}/stop`),
  apply: (runId, options) => api.post(`/runs/${runId}/apply`, options),
  discard: runId => api.post(`/runs/${runId}/discard`),
  renameThread, archiveThread, deleteThread,
  mentionTargets: (query, kind) => index.search(query, kind),
  openTarget: target => router.open(target),
  attachmentLimits: { count: 10, bytesPerFile: 512 * 2 ** 20, bytesTotal: 5 * 2 ** 30, accept: 'image/*,audio/*,video/*' },
  capabilities: { scopes: ['project'], cost: true, previewDraft: false, generateImages: false },
};
```

### Capabilities

`ChatCapabilities` tells `StudioChat` what the port supports:

- `scopes: ScopeKind[]` — scope chips above the composer (`project` is the default when listed or when the list is empty).
- `cost: boolean` — the conversation total `Thread.cost` in the header.
- `previewDraft: boolean` — "Preview draft" for a `ready` run (with `port.previewDraft`).
- `generateImages: boolean` — the "Generate images" toggle in the composer (`SendInput.generateImages`).
- `conflictReview?: boolean` — the port sends `QuestionCard` with `kind: 'conflict'` as the apply gate.
- `keepDraft?: boolean` — "Keep draft in editor" for failed/interrupted runs (with `port.keepDraft`).
- `clarifyWhileRunning?: boolean` — the port accepts `send()` during an active run as a clarification of that run in the same thread. With `true` the composer is not blocked while running (Enter and the send button work, the message goes to the current `threadId`); without it sending waits for the run to end.
- `discardStopped?: boolean` — the port accepts `discard()` for `failed`, `interrupted` and `cancelled` runs. With `true` such a run shows "Discard" when its message has draft cards (`diff`, `values`, `image`, `file`), so a broken draft can be dropped before the next send; without it Discard is offered only for `ready` runs.

"Continue generation" (failed/interrupted/cancelled runs, with `port.continueRun`) passes the current composer text as the prompt — `continueRun(runId, prompt)` — and clears the composer; with an empty composer it calls `continueRun(runId)`.

### StudioChat (`@trafficops/studio-ui/chat`)

Load it lazily so the chat is a separate chunk: `const StudioChat = React.lazy(() => import('@trafficops/studio-ui/chat').then(module => ({ default: module.StudioChat })))` inside `Suspense` with a `Skeleton`. It is built on `@assistant-ui/react` with its own lightweight markdown renderer (no Streamdown).

```jsx
<StudioChat port={port} threadId={threadId} onThreadChange={setThreadId} onScopeChange={setScope} launch={launch} actions={actions} disabled={false} footer={null} emptyState={null} className="" />
```

- `port`: `ChatPort`. `threadId`, `onThreadChange(id)`: the selected thread, controlled by the product; an empty `threadId` is a new conversation.
- `launch`: `{ id, text?, scope?, mentions?, attachments?: File[] }` — start a conversation from outside (see below).
- `onScopeChange(scope)` (optional): called with the new `Scope` whenever the composer scope changes — a scope chip, the chip's remove cross (back to the default scope) and every `launch`, including a launch present at mount (its `scope`, or the default scope when the launch has none). Without a launch it is not called on mount. The scope stays owned by `StudioChat`; products use this to keep scope-dependent UI (Landing: the "Selected blocks" panel) in step with the composer before the first send.
- `actions`: `{ id, label, danger?, onSelect({ text }) }[]` — product actions in the thread header menu; `onSelect` receives the current composer text.
- `disabled` (composer read-only), `footer` (rendered under the composer), `emptyState` (replaces the built-in empty thread state; shown through `AuiIf condition={state => state.thread.isEmpty}`), `className`.

Layout: the conversation list (left), the header (title with in-place rename, the conversation total `Thread.cost` when `capabilities.cost`, the `actions` menu), the feed and the composer. The chat is a CSS size container (`container: studio-chat / inline-size`): below 560 px of its own width the list is hidden and the header shows a "Conversations" menu instead. Give the chat a height (it fills its parent, the feed scrolls).

### Thread model

The conversation list is built on `port.threads`, not on assistant-ui `ThreadListPrimitive` (which needs `adapters.threadList` and its own thread model). It offers "New conversation", search by title, an "Archived" toggle, and per item a menu with rename (`renameThread`), archive/restore (`archiveThread(id, archived)`) and delete (`ConfirmDialog` → `deleteThread`; deleting the selected thread calls `onThreadChange('')`). The selected thread shows a dot while its run is active.

`port.createThread()` must return a real `Thread` with an id. "New conversation" calls it and then `onThreadChange(id)`. With an empty `threadId` the first send also calls `createThread()`, then `onThreadChange(id)`, then `send(id, …)`; `StudioChat` subscribes to `messages(id)` and `events(id)` of the new thread. The port may keep the thread pending until the first `send` and materialise it then.

### External launch

An effect keyed on `launch.id` resets the composer and fills in the text, scope, mention targets and files (`attachments: File[]`). `launch.id` is compared for equality, so create it with `crypto.randomUUID()` rather than `Date.now()` (two launches in the same millisecond would not reset the composer):

```js
setLaunch({ id: crypto.randomUUID(), text, mentions, attachments: files });
```

### Errors

`StudioChat` does not use `useToast`, so the consumer does not need a `ToastProvider`. A failed `send` (including `createThread` on the first message) shows an `InlineNotice` tone `danger` ("The message was not sent") above the composer and gives the composer its text, mention targets and files back (unless the user has already started a new message); a thread created by `createThread` for that send is removed with `deleteThread` and `onThreadChange` gets the previous `threadId` back, so no empty conversation is left; failed thread actions show the same notice titled "The action failed"; a rejected card action (answer, apply from a conflict card, …) shows an `InlineNotice` under its message; run actions (Apply, Discard, Keep draft, Continue) show theirs under the run. A card with a malformed `result` is rendered as a `FileCard` instead of breaking the feed.

### Test hooks

`data-testid` values (exactly this list): `studio-chat` (root), `studio-chat-threads` (the conversation list column; hidden below 560 px), `studio-chat-composer`, `studio-chat-feed` (the scrolling feed), `studio-chat-card` (with `data-card` set to the card type), `studio-chat-apply`, `studio-chat-discard`, `studio-chat-keep-draft`, `studio-chat-continue`. Messages carry `data-role` (`user` / `assistant`), and assistant messages `data-run-id` and `data-run-status`. In a narrow chat the conversation list is the header button named "Conversations". The composer send button is named "Send message"; it is disabled during a run unless `capabilities.clarifyWhileRunning`. `studio-chat-continue` sends the composer text as the `continueRun` prompt. `studio-chat-discard` ("Discard") appears for a `ready` run and, with `capabilities.discardStopped`, for a `failed`, `interrupted` or `cancelled` run whose message has draft cards (`diff`, `values`, `image`, `file`). On touch screens (`pointer: coarse`) every chat button — header, conversation list, composer (attach, mention, send, scope chips, chips), run actions and card actions — is at least 44 × 44 px; `test/chat-browser.mjs` checks this with Playwright `hasTouch`/`isMobile`.

## Tests

```sh
npm test --workspace=@trafficops/studio-ui
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/primitives-browser.mjs .
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/chat-browser.mjs .
```

Node tests import only JSX-free modules. The browser checks run in system Chrome (macOS) against esbuild bundles of `test/fixtures/Playground.jsx` and `test/fixtures/ChatPlayground.jsx` (`StudioChat` on `FakeChatPort`, without `ToastProvider`); run them from the repository root with a caller-supplied Playwright. `CHAT_BROWSER_SCREENSHOTS=<dir>` saves screenshots of the chat in both themes and at a narrow width.
