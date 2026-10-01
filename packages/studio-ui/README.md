# @trafficops/studio-ui

Primitives, resizable workspace, i18n and the chat contract shared by TrafficOps studios (Landing Studio, Media Studio, embeds).

## Install

```sh
npm install @trafficops/studio-ui @trafficops/studio-tokens
```

Peer dependencies: `react` and `react-dom` ^19.2. `@assistant-ui/react` ^0.15 is an optional peer needed only for `StudioChat`. Styles come from `@trafficops/studio-ui/styles.css` plus the tokens and themes of `@trafficops/studio-tokens`; process them with Tailwind CSS 4 and daisyUI 5.

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

`ChatPort` is the contract between a product and the chat UI: see [`chat/port.d.ts`](chat/port.d.ts) (types only, no React or assistant-ui types). `StudioChat` is not shipped in this version. It will arrive in a later version as a separate lazily loaded chunk (`@trafficops/studio-ui/chat`, imported through `React.lazy`) built on `@assistant-ui/react`, with its own lightweight markdown renderer and no Streamdown dependency.

## Tests

```sh
npm test --workspace=@trafficops/studio-ui
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/primitives-browser.mjs .
```

Node tests import only JSX-free modules. The browser check runs in system Chrome (macOS) against an esbuild bundle of `test/fixtures/Playground.jsx`; run it from the repository root with a caller-supplied Playwright.
