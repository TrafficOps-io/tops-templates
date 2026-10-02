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

`ChatPort` is the contract between a product and the chat UI: see [`chat/port.d.ts`](chat/port.d.ts) (types only, no React or assistant-ui types; `@trafficops/studio-ui/chat/port`). Optional members (`previewDraft`, `answer`, `continueRun`, `keepDraft`, `dispose`, `capabilities.conflictReview`, `capabilities.keepDraft`) may be left out; `StudioChat` hides the matching actions. Product-specific methods (for example `registerBlockScope`) are not part of the contract and stay on the adapter object. Two rules:

- `RunState.id` equals the `id` of the assistant message. Otherwise `stop/apply/discard(runId)` cannot find the message.
- `toolCallId` is deterministic and unique within a message (it keys `part-update` events and React lists). The recommended form is `` `${messageId}:${index}` `` by the part's position in `parts`; any other stable key is fine (Landing Studio uses the file path, `r1:diff:index.tpl`). `StudioChat` only compares `toolCallId` for equality.

### StudioChat (`@trafficops/studio-ui/chat`)

Load it lazily so the chat is a separate chunk: `const StudioChat = React.lazy(() => import('@trafficops/studio-ui/chat').then(module => ({ default: module.StudioChat })))` inside `Suspense` with a `Skeleton`. It is built on `@assistant-ui/react` with its own lightweight markdown renderer (no Streamdown).

```jsx
<StudioChat port={port} threadId={threadId} onThreadChange={setThreadId} launch={launch} actions={actions} disabled={false} footer={null} emptyState={null} className="" />
```

- `port`: `ChatPort`. `threadId`, `onThreadChange(id)`: the selected thread, controlled by the product.
- `launch`: `{ id, text?, scope?, mentions?, attachments?: File[] }` — start a conversation from outside (see below).
- `actions`: `{ id, label, danger?, onSelect({ text }) }[]` — product actions in the thread header menu.
- `disabled`, `footer`, `emptyState`, `className`.

### Thread model

`port.createThread()` must return a real `Thread` with an id. `StudioChat` then calls `onThreadChange(id)` and subscribes to `messages(id)`. The port may keep the thread pending until the first `send` and materialise it then.

### External launch

An effect keyed on `launch.id` resets the composer and fills in the text, scope, mention targets and files. `launch.id` is compared for equality, so use `crypto.randomUUID()` rather than `Date.now()` (two launches in the same millisecond would not reset the composer).

### Errors

`StudioChat` does not use `useToast`: `send` errors appear as an `InlineNotice` in the feed, so the consumer does not need a `ToastProvider`.

### Test hooks

`data-testid` values (exactly this list): `studio-chat`, `studio-chat-threads`, `studio-chat-composer`, `studio-chat-feed`, `studio-chat-card` (with `data-card` set to the card type), `studio-chat-apply`, `studio-chat-keep-draft`, `studio-chat-continue`. Messages carry `data-run-id`, `data-run-status` and `data-role`.

## Tests

```sh
npm test --workspace=@trafficops/studio-ui
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/primitives-browser.mjs .
```

Node tests import only JSX-free modules. The browser check runs in system Chrome (macOS) against an esbuild bundle of `test/fixtures/Playground.jsx`; run it from the repository root with a caller-supplied Playwright.
