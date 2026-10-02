# Docs and Landing Studio redesign: validation

Date: 2026-10-02. Implemented in the existing checkout, preserving the dirty working-tree baseline. No deployment or commit was made.

Follow-up: the user's screenshot exposed an unstyled Theme section in More. This state was missed by the original visual coverage. [Theme menu correction](./theme-menu-fix.md) records the shared CSS fix, eight-context production regression and inspected screenshots.

Second follow-up: long template section names wrapped and were clipped by the Content header. [Section navigation correction](./section-tabs-fix.md) records the reproduced failure, scoped CSS fix, eight-context production regression and independent review.

## Result

Projects is the default library view; Templates is one action away. Saved projects use compact rows with search, kind filtering and management menus. The catalogue distinguishes using a reusable template from editing its source. AI activity remains visible outside its project row.

Creation preserves the chosen source instead of repeating the selection. Project options are disclosed on demand. Manual browser and installed-app creation opens Content; an actual first AI brief opens Conversations. Brief attachments, image choices, settings and submission guards are preserved.

Mobile Files/Edit/Preview establishes the panel context. Author modes appear within Edit, and the readable save state remains in every panel. Content actions and export options are disclosed once. The export-history checkbox and caption form one aligned clickable row.

Narrow Conversations now offers the full existing search, rename, archive/restore and delete workflow. Management errors appear inside the visible panel. Nested menus and delete confirmation retain their keyboard/focus behavior, including inside a shadow root.

Docs shows Studio, CLI and PHP workflows before one valid language example. Reading navigation, URLs, anchors, search indexing, sidebar, outline, previous/next and article content remain. Local search has corrected dialog/combobox/option semantics and returns focus to its actual opener when closed without navigation.

Onest, approved logo assets, warm system/light/dark tokens and existing Lucide icons are preserved. [Preflight](./preflight.md) records how the design skill applies to documentation and the workspace.

## Workflow and independent review

Two audits completed before brainstorming: [feature inventory](./feature-inventory.md) and [visual audit](./visual-audit.md). The user chose Projects/Templates as the entry and separate views with Projects as default. [Brief](./brief.md), [implementation plan](./plan.md) and [independent plan review](./plan-review.md) record those decisions.

Three implementation agents owned documentation, library/creation and shared workspace/conversations. Independent source review found a native-dialog focus gap; explicit presentation-only return-focus references resolved it. Root integration found and corrected mobile Saved visibility/clipping, selected-method contrast, coarse menu/button sizes and export-label CSS specificity.

The independent reviewer compared all 25 existing App callback functions against the snapshot and found them unchanged. [Source preservation evidence](./source-preservation.json) records 263 unchanged snapshot files, including 28 editor service/data JavaScript modules. New helpers concern dialog presentation only. Runtime, storage, provider, draft/apply and preview-bridge modules were not redesigned.

## Automated checks

| Check | Result |
|---|---|
| Studio unit suite | 464/464 PASS |
| Shared editor-shell unit suite | 200/200 PASS |
| Shared studio-ui unit suite | 77/77 PASS |
| Host TypeScript contracts | PASS |
| Final editor production build and service worker generation | PASS |
| Final embedded production build | PASS |
| Documentation production build | PASS |
| Shared theme/token/button-scale checks after final CSS | PASS |
| Whitespace/error check, `git diff --check` | PASS |

The consolidated unit total is 741. Repeated focused token tests are not added to that total. Existing large-chunk build warnings remain; dependencies were not changed.

Root ran the final `studio-browser.mjs` against the completed production artifacts: PASS, including Help and New project return-focus paths, touch targets, installed settings, static HTML import, editable backup and hosting ZIP assets. Its command log is `/tmp/trafficops-redesign-v2/studio-browser-complete.log`.

## Browser and visual acceptance

All provider operations use local fixtures/stubs or are blocked. No paid generation was performed.

| Area | Evidence and preserved behavior |
|---|---|
| Library, creation, theme and help | Library, home/brief, Studio and library-AI fixtures: independent template copies, duplicate/delete/filter, attachments, configured/unconfigured creation, focus return, background runs, exact failed/retried tool sequence, manual Apply and no restart on reload. |
| Installed capability boundary | PWA-access fixture: query flags/fullscreen/install events do not enable installed-only AI/folders. Real service-worker offline library, Monaco, autosave and ZIP export checked in disposable contexts. |
| Root cross-surface test | `editor/test/studio-ux-browser.mjs`: web/PWA × 1440/390, default Projects, direct-source intent, manual Content, retained panel edits, JSON file chooser/import, visible mobile Saved, settled 44px creation submit and aligned single-choice export. PASS. |
| Shared chat and embedding | Shared chat fixture plus creation, conversation UI, conversations and retained-draft/settings fixtures. Search/rename/archive/restore/delete, failure/retry, nested Tab/Shift+Tab/Escape/Cancel and shadow-root menus work. Historical and current export bytes remain correct. |
| Save and recovery | Autosave failure pause/recovery and conflict-aware flush; detached-folder and malformed-values recovery; deleted-project rescue retains assets/folders; explicit-save Apply changes only the working copy. PASS. |
| Rich text | Wysiwyg/Markdown, legacy paragraph conversion on initial Content, formatting, undo/redo, links, images/captions, source serialization, reload and preview. PASS. |
| Preview | Opaque iframe/security, offline multipage content, ready/source/token matching, last-good frame, source isolation, selection and frozen/current scope, pause/refresh and block picker. PASS. |
| Shared primitives | Menus, tabs, keyboard/focus contracts. PASS. |
| Docs | 28 browser/axe states at 1440/390 in light/dark; 15 extra responsive states at 320/768/960/1280/1920. Valid example parsed/rendered by runtime; main/skip target, search arrows/Enter/click/reset/details/empty/Escape, mobile navigation, reference/table overflow and 404. PASS. |
| Accessibility | Zero serious/critical WCAG 2/2.1 A/AA axe findings in docs and Studio library, creation/options/AI, Content/Code/Conversations, mobile panes and management/export dialogs. Studio excludes the separate preview iframe and Monaco widget. Populated docs search uses no rule exclusion. Final export layout checked again after its CSS correction. |
| Production visuals | 48 final states at 1440/1024/390/320, including light/dark content, code, conversations, manual/AI creation, settings, export and mobile Files/Preview. Stable dialogs, unclipped Saved, no document overflow, page errors or provider calls. Representative screenshots inspected directly. |

The root production screenshots and JSON report are under `/Users/igorolshevsky/.codex/visualizations/2026/10/02/01a0fca6-8aa0-7d91-8d89-5d05275f13bb/templates-redesign-v2/final/release/`. Docs and populated-library/conversation-management evidence are in the parent `final/` directory.

## Production Lighthouse

Same cached Lighthouse 13.5.0 CLI, bundled Chromium and desktop preset, served locally from production artifacts. Builds and root browser jobs completed before measurement. One run before/after is directional evidence rather than a field benchmark. Exact values and timestamps are in [lighthouse.json](./lighthouse.json).

| Page | Performance before → after | Accessibility before → after | Best practices | LCP after | TBT after | CLS before → after |
|---|---|---|---|---|---|---|
| Docs home | 99 → 99 | 98 → 100 | 100 → 100 | 0.8 s | 0 ms | 0.004 → 0 |
| Studio Projects entry | 81 → 82 | 100 → 100 | 100 → 100 | 1.9 s | 0 ms | 0.036 → 0.006 |

Loading performance is substantially unchanged; layout stability and documentation accessibility improved. These measurements cover entry pages, not long-session editor latency or real-user INP.

## Limits and local review

Installed UI behavior is exercised through disposable browser contexts with the existing standalone capability signal; the service worker and offline behavior are real. Physical OS installation and live provider billing are not part of this validation. Folder-recovery fixtures use a simulated handle API with real IndexedDB; they do not write to user folders.

The search adapter is deliberately tied to the existing VitePress 1.6.4 DOM contract; `docs/test/navigation-browser.mjs` guards it on future upgrades. Existing public planning-document routes and their search membership are preserved.

Production preview: `http://127.0.0.1:5189/tops-templates/` and `http://127.0.0.1:5189/`. Original dev servers remain available on 5178 and 5177.
