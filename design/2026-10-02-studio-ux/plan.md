# Docs and Landing Studio: implementation plan

Date: 2026-10-02. Reviewed implementation plan; independent findings and resolutions are recorded in plan-review.md.

This plan implements the decisions in [brief.md](./brief.md), after both [feature-inventory.md](./feature-inventory.md) and [visual-audit.md](./visual-audit.md). All existing dirty changes are the baseline. The archive at `/tmp/trafficops-redesign-v2/pre-implementation.tar.gz` is comparison evidence, never an automatic rollback.

## Outcome and design constraints

Returning users reach a saved project in the first viewport. New users choose an intentional starting point. Manual creation reaches Content in both browser and installed Studio. Docs immediately offer the Studio, CLI and PHP workflows. Narrow Conversations exposes the same management functions as the full sidebar.

Keep TrafficOps logo geometry and assets, Onest, the current warm palette, system/light/dark persistence and existing Lucide icons. The design read is a calm workspace with a clear next editing action; variance 5, motion 2, density 6. No new UI dependencies, decorative imagery, animated marketing sections, provider calls or storage migration. Preserve article URLs, anchor IDs and canonical links. New UI copy should be short, sentence case and describe actual capabilities.

## Ownership and coordination

Three implementation agents may work concurrently only after independent plan review. Each owns its files and the affected existing tests. Root owns integration, final acceptance scripts and visual/performance evidence. Agents report any required out-of-bound change before editing it.

| Agent | Owned product files | Owned existing tests | Boundaries |
|---|---|---|---|
| A: Docs | `docs/.vitepress/theme/DocsHome.vue`, `style.css`, `index.js`; `docs/.vitepress/config.mjs`; `docs/index.md` only if landmark/frontmatter integration requires it | A new focused docs browser check if useful; docs build | No technical article rewriting, slug/anchor changes, generated VitePress files or dependency edits. Approved logo/font assets remain unchanged. |
| B: Library, creation and preferences | `editor/src/StudioLibrary.jsx`, `create-project.css`, `HomeProjectChat.jsx`, `home-project-chat.css`, `ThemeToggle.jsx`, `StudioDialogs.jsx`, and library/header/help/theme rules in `studio.css`; presentation portion of `App.jsx` | `editor/test/library-browser.mjs`, `studio-browser.mjs`, `home-chat-browser.mjs`, `library-ai-browser.mjs`, `pwa-access-browser.mjs` if selectors need deliberate UX updates | `App.jsx` edits are limited to imports, theme presentation, library/header/footer rendering and labels. Keep storage, lifecycle, install/update, provider, create/import/open/delete callbacks and capability checks unchanged. B owns `studio.css`; C uses shell/shared CSS. |
| C: Shared shell and Conversations | `packages/template-editor-shell/src/EditorShell.jsx`, `shell.css`, `PreviewPanel.jsx` only for the specified disclosure; shared `packages/studio-ui/src/chat/{StudioChat,ChatHeader,ThreadList}.jsx`, a narrowly scoped new management component if needed, chat rules in `packages/studio-ui/styles.css`, new i18n strings in `src/i18n/studio-translations.json` | `packages/studio-ui/test/chat-browser.mjs`, `editor/test/creation-browser.mjs`, `conversation-ui-browser.mjs`, `conversations-browser.mjs`, `retained-draft-settings-browser.mjs` and `support/studio-chat.js` only as required by changed UI | No runtime, AI port, draft/recovery, preview bridge, storage or analyzer rewrites. Do not alter composer/model/attachment contracts. Scope app layout rules with `.is-app`; shared functional chat fixes must remain portable to embedding/shadow roots. |

Root owns `design/2026-10-02-studio-ux/*`, new cross-surface acceptance checks, `editor/test/workspace-axe-browser.mjs` integration, and any collision resolution. `ParameterForm.jsx`, `ImageField.jsx`, richtext editor files and project-sidebar logic remain unchanged in this pass unless root and reviewer identify a necessary functional fix. The fully displayed richtext toolbar is deliberately retained: reducing it is not worth introducing selection/mount risk during this navigation pass.

## A. Task-first documentation

1. Replace the current three-line hero, principles strip and repeated workflow introduction with a compact documentation entry:
   - One heading that identifies TrafficOps Templates in no more than two desktop lines.
   - One short explanation of typed editable content beside HTML.
   - Immediately visible workflow links for Landing Studio (`https://studio.trafficops.io`), Command line (`withBase('/guide/tooling')`) and PHP & Laravel (`withBase('/guide/php')`). Retain their concrete action labels, with Studio first.
   - Get started and language reference remain direct links. A single concise, valid TPL example follows the workflow choices; preserve source/output meaning without repeating another sample or pretending to be an interactive editor.
2. Use a real main landmark for the custom home. `DocsHome` currently renders a `div` under the custom-layout page; confirm the final DOM has exactly one visible `main` landmark and the skip link targets actual content. Avoid wrapping an already present main twice.
3. Simplify top navigation presentation: keep Guide, Language and Landing Studio directly visible; group PHP, CLI & Editor and Agent skills in one Tools dropdown, preserving those destination names and URLs. Keep the grouped sidebar, active item and on-page outline. Use quieter hierarchy and spacing rather than removing reading navigation. Verify dropdown selection/active styling on each grouped route and mobile.
4. Keep VitePress local search and all keyboard behavior. Baseline Lighthouse identified shortcut-key glyphs as text absent from the Search accessible name. Mark only the shortcut hint decorative (`aria-hidden`) while retaining the functional Search name and shortcut. Prefer supported theme composition; if necessary, use a narrowly scoped theme lifecycle hook for the Search button. Do not patch `node_modules`, replace search, or hide the visible Search label.
5. Refine home and reading widths, code wrapping/scrolling, tables and mobile spacing in the existing theme CSS. Body prose should remain approximately 65 characters wide; code/table containers scroll locally. Keep code copy, syntax grammar, heading links, TOC, previous/next, edit link, last-updated, appearance and default 404 recovery.

Acceptance: at 390×844, all three workflow choices appear before the example and the Studio link requires no scroll. At 1440×900 the header remains concise and the first workflow is obvious. Home/article/search/404 and a long language-reference page work in light/dark with keyboard and no document overflow. Built docs contain no broken internal links. Exactly one main landmark on home; Search retains its accessible name and functional Cmd/Ctrl+K shortcut.

## B. Projects and Templates library

### Library information architecture

1. Use one compact `Landing Studio`/`Projects` heading area and one New project entry for browser and PWA. Remove the always-on HomeProjectChat hero from the library; retain and reuse its existing BriefComposer inside the AI creation method. AI remains a creation choice and an editor mode in confirmed installed Studio.
2. Use the existing shared Tabs primitive, or equivalent complete keyboard tab behavior, for Projects and Templates. Projects is selected on first library mount and when returning from the editor. Tab panel IDs and labels are unique; left/right, Home/End and focus behavior work. One click switches to Templates.
3. Projects contains all saved records, including reusable-template projects. A saved reusable template is still a project when managing its source. Retain search and an optional compact kind filter with All projects, Landings and Reusable templates; do not reuse the ambiguous Templates label for the kind filter. Counts refer to real records. Keep selected filter/query behavior deterministic and distinguish empty library from no matches.
4. Templates is a catalogue with two clear groups: Included starters and Your reusable templates. Included starters remain available offline with real sandboxed thumbnails. Saved reusable templates offer Use template as the main catalogue action and Edit template as a secondary action using `onOpen`. This intentional dual presentation distinguishes using a starting point from managing its source; it does not duplicate records or change identities.
5. Use compact saved-project rows or compact cards: name, kind, updated date, a real preview where useful, one clear open action and visible AI activity. Move Duplicate/Delete and reusable-project Use template into an accessible per-record menu when appropriate. Keep descriptive accessible names and the existing delete confirmation. A row must not be a giant button containing other interactive controls; previews and the project open link/button use the existing `onOpen` callback.
6. Retain Import ZIP and installed/support-gated Open folder in a compact actions region. A menu may disclose import, but its activation must synchronously click the file input. Folder chooser activation must still occur in the original click path. Do not add an await before its native chooser.
7. Empty Projects has one concise creation explanation, a primary New project action and a secondary Templates action. No giant marketing or AI hero. Browser capability information and device-storage/ZIP backup information appear once in a quiet footer/note. Folder location and recovery warnings remain honest and independent of general device-storage copy.

Loading keeps an accessible skeleton/status. Busy disables mutating/opening actions consistently; search/navigation may remain usable. Storage failures retain the existing app alert and recovery actions. Background AI activity must stay visible even when the active catalogue is Templates: render a compact activity summary and a direct route to the affected project if its row is outside the current view.

Acceptance: a populated Projects view shows the first saved record and open action without scrolling at 1440×900 and 390×844. Projects is the default in browser/PWA and after Back to projects. Templates is one action away and contains included and saved reusable sources. Search/filter/no-match, open, duplicate, delete, independent template creation, ZIP import and PWA folder access work. Activity does not disappear on Templates. No hidden hover-only management controls.

### Creation: preserve intent once

1. Generic New project defaults to manual From template in browser and PWA. Preserve From scratch and installed-only With AI methods and all `initial.mode`/`initial.kind` overrides. An attempted AI mode in a browser still falls back to manual.
2. Direct Use template preserves `initial.source`. Show a compact selected-template summary/preview plus Change template. The full picker starts collapsed for this direct flow; generic template creation exposes it. Changing the source still updates the suggested name until the user edits it; typed names survive later selection changes. Use native radios and normal keyboard traversal; do not collapse the picker on an arrow-key radio change.
3. Project type is a closed Project options disclosure by default, with a concise visible summary of the chosen kind. Preserve Landing page and Reusable template values, initial kind, creation button wording and optional AI project name. Expanding it must not reset other input.
4. Preserve the existing AI BriefComposer contract: text, attachments via upload/drop/paste, use attached images on the page, image-generation choice and live asynchronous image-model settings. Unconfigured key still creates the project/first brief and hands off setup to the editor. Failed submit keeps input and attachments; busy/settings loading prevents double submission. Generic creation must not make a provider call.
5. Native dialog maintains title, initial focus, Escape, close/Cancel and busy-close prevention. Use a bounded viewport height with internal scrolling and a reachable footer on mobile. Close returns focus to the creating control; template-summary/chooser changes do not steal focus from name typing. Keep Enter form submission and avoid nesting the brief form inside another form.

Acceptance: direct starter flow displays that source and accepts a name without reselecting it; changing source and typed/default names behaves as before. Template/blank PWA submits into Content. Explicit With AI submits into Conversations with the exact attachments/image choice and first brief. Collapsed options still allow reusable-template creation. Mobile keyboard and errors leave submit/cancel accessible.

### Theme, help and settings chrome

1. Replace the library's three permanent theme buttons with one named Theme menu. Its system/light/dark `menuitemradio` entries show text labels and the selected choice. Reuse `applyTheme`, `readTheme` and `THEMES`, preserving `studio-theme`, live system preference and theme-color changes.
2. In the editor More options menu, retain the existing three choices but present labelled menu items rather than an unlabelled row of icon-only buttons. Avoid a nested Menu inside Menu; a small shared rendering helper is fine. Selecting a choice returns focus to its trigger and updates the canonical logo variant immediately.
3. Quick start becomes one short workflow list (create/import → edit Content or Code → choose images → preview/export). Remove the duplicate flow diagram, tags and staggered entrance animation. Retain Docs, Close/Start creating, Escape/backdrop and installed-only AI/folder explanation. Help describes device saving and ZIP portability correctly.
4. AI settings and connected-folder dialogs keep current model/key/manual-ID/connection tests and permission/recovery functionality. Adjust inherited modal spacing and viewport constraints if necessary; do not redesign their data logic or remove less frequent fields.

Acceptance: system/light/dark persist across library/editor/reload, current manual/system theme controls the logo and theme-color, focus returns correctly. Quick start is readable at 390px and closes by keyboard. OpenRouter/model picker stays inside the native settings dialog's existing portal container, with errors and Remove key still reachable.

## C. Clear workspace context and narrow Conversations

### Initial mode and mobile hierarchy

1. Change only app presentation's initial author mode: genuine `host.ai.initialRequest` opens Conversations when conversations are allowed; a manually created/opened app project defaults to Content even when a conversations port exists. Keep embedded presentation's existing initial behavior for compatibility. Do not use merely `host.conversations`, capability availability, API-key presence or installed mode as evidence of AI creation intent.
2. Preserve the LibraryHost initial-request object and claim behavior. Its `aiPrompt` may also exist for restored AI-created projects; such an actual initial request can still open Conversations. Do not clear prompt metadata, force paid regeneration, or require `autoStart` to access the recovery conversation. If `aiAllowed=false`, initial selection must resolve to an available manual mode.
3. At ≤760px, Files/Edit/Preview remains the main panel context. Show Content/Code/Conversations only when the Edit panel is active. Hidden author navigation must not remain keyboard-focusable in Files or Preview. Section tabs remain subordinate within Content. Switching mode returns to Edit; opening a file, AI file scope or validation target moves to the appropriate context as existing callbacks intend.
4. Preserve editor instances/runtime while changing panels. Do not conditionally unmount chat/Tiptap/Monaco just to hide navigation. Maintain draft/run/composer state when moving Files → Edit → Preview. Desktop remains simultaneous files/author/preview, tablet keeps its current auto-fold behavior.
5. Mobile status shows Saved/Saving/Unsaved or failure/conflict in every panel. Use the existing `statusBadge`/editor status as the source, with a single compact status line if toolbar space is insufficient. Folder/device location may remain in a tooltip or concise accessible label, but a technical preview notice must not replace save state. Normal preview-script/page-count details belong in Preview; paused, updating, draft and failure states remain visible when relevant.
6. If preview is hidden while the mobile active pane is Preview, resolve back to Edit. Keep Show/Hide preview accessible through an available control/menu in narrow UI; hiding a desktop toolbar button must not remove the function. Mobile panel switch respects safe-area insets and virtual-keyboard viewport changes.

Acceptance: manual starter and blank creation open Content in installed PWA and browser. A genuine AI creation/restore request opens Conversations, claims once and never restarts a paid run on reload. Embedded initial request and existing host flows still work. At 390px Files/Preview has no author mode row; Edit has it; save status stays visible in all three panels. Panel changes preserve unsaved text and composer state.

### Content and export disclosure

1. Replace the permanently shown Reset defaults / Load JSON / Save JSON row with a named Content actions Menu. Reuse the existing callbacks and hidden input. Reset applies to the entire current locale as it does now, not just the displayed section. Load JSON still validates an object and reports failure; Save JSON exports current locale values. Keep current lock rules and preserve click activation for the picker. The menu works by pointer, arrows, Home/End and Escape with focus return.
2. Preserve all parameter types, validation badges, repeater add/remove, image paths/uploads/crop/generation, richtext modes/formatting/source and no-editable-fields actions. Improve spacing through scoped shell CSS; no field ordering or richtext remount changes. The richtext toolbar stays functional and visible in this pass.
3. Export chooses its format once. Retain the current Export choice menu when two formats exist, then open a fixed-format review/options dialog. Remove the repeated Export destination select; show the chosen purpose as a clear heading/summary. With only one format, a direct review is acceptable. The final download remains explicit.
4. Source export retains the optional Include conversation history checkbox, its current default and all source-data semantics. Place checkbox and label together as one clickable row. HTML export retains Continue URL only for applicable preview hosts. History-row export retains the predetermined historical target/format; do not allow switching its target to current edits. Preserve locale/current-versus-saved-version information, busy states and download errors. API keys never enter exports.
5. Preview controls remain grouped by task: page choice, select-elements when available, refresh/pause and device size. Default working controls already have sensible grouping; this pass need not move them into a new menu. Remove only the always-present technical preview detail from unrelated mobile panels. Preserve page/entry functions, frozen scope, selected chips/parent/clear/Edit selected, stale selection guard, expansion in embedding and last-good-frame behavior.

Acceptance: Content actions remains discoverable in empty/short sections and keyboard-operable; JSON round-trip and reset keep original scope. Export makes one format choice, downloads correct bytes and respects history/Continue URL capabilities. Image/richtext/browser regression passes without selection loss. Preview refresh/pause, device frames, AI selections and last-good-frame error behavior remain intact.

### Errors and recovery

For app presentation, render one canonical shell error/recovery region under the toolbar for the same `editor.error`/conflict instead of repeating it in toolbar, outer inline error and hosted callout. Preserve Dismiss for ordinary errors and Reload saved project confirmation plus explicit Export access for conflicts. Keep unsaved retained edits and the save-status failure indication. Do not globally CSS-hide alert classes or suppress distinct outer `App` storage/import/install errors, reconnect banners, recovery-copy actions, AI notices or preview failures. Embedded rendering keeps its existing functional branches.

Acceptance: a simulated autosave/storage conflict presents actionable retained-edit information once per shell cause, not three identical messages. Reload requires the existing confirmation; export retained edits and Save as new project remain accessible. Ordinary errors can be dismissed. Independent install/update/provider/import failures remain visible and retryable.

### Narrow conversation management

1. Keep the existing compact Conversations quick-switch menu, including New conversation and open thread choices. Append Manage conversations. This preserves `support/studio-chat.js`'s thread-switch contract and current shadow-root menu coverage.
2. Manage conversations opens a full responsive management surface using the existing `ThreadList` component and port callbacks. Expose search, Open/Archived view, new/open, rename, archive/restore and delete confirmation. Reuse one management implementation; do not reimplement mutations as another list or use a provider/runtime reset. The desktop sidebar remains the normal wide interface.
3. Use an accessible dialog/panel with a named title, explicit Close, initial search focus, trapped keyboard focus and Escape/backdrop close. Do not wrap ThreadList's inline rename form in the generic form-based Modal (nested forms are invalid). A native dialog or a small non-form dialog using existing focus utilities is appropriate. Keep the management content and its row menus/confirmations inside the caller's shadow root/native-dialog portal context. No document-body-only portals.
4. Close after selecting/creating a conversation and return focus to a stable header trigger (or the composer for the explicit selection action). Rename/search/archive actions keep the manager open. Delete Cancel returns focus to the row action and does not close the management panel; nested Escape closes the innermost popup first. A resize to a wide layout closes the temporary narrow panel without changing thread/composer/attachments or restarting the runtime.
5. Errors reuse existing port reporting and appear inside the active management surface as an accessible alert; an underlying StudioChat notice alone is insufficient behind an overlay. A rejected rename/archive/delete leaves the manager and relevant input usable. Existing archive/delete semantics and delete confirmation remain intact. Selected thread deletion still clears that thread as it does in ThreadList. Long lists scroll inside the panel; names truncate visually but retain accessible titles. All touch actions are at least 44px, desktop at least 32px; no hover-only row menu.
6. Preserve `data-testid="studio-chat"`, `studio-chat-threads`, `studio-chat-feed` and composer contracts. Give the narrow management surface a distinct test ID if it adds a second render of ThreadList. Tests must scope to the active management surface rather than hidden duplicate controls. New text uses the shared translation provider.

Acceptance: at chat container widths 559px and 390px, quick switching and full management are both reachable. Search then rename/archive/restore/delete works through real port callbacks with FakeChatPort fixtures, including rejection and delete Cancel. At 560px+ the normal list remains accessible. Focus stays in the topmost surface; Escape returns it correctly. The embedded browser test proves management menus and confirmations stay inside the shadow root; composer text/attachments and existing draft survive opening/closing/resizing the manager.

Independent review condition: the management panel's parent focus trap must yield to nested menus and the inline delete confirmation. The existing shared trapFocus does not itself check defaultPrevented. Handle the topmost surface explicitly without changing unrelated focus behavior. Verify forward and reverse Tab, Escape and Cancel in the delete confirmation; focus returns to the row action and the manager remains open. Verify rejected management operations produce an alert within the visible manager.

## Function and data preservation gates

The inventory's nine invariant groups are release gates, not aesthetic preferences:

- Installed capability boundary: browser query flags, fullscreen and `appinstalled` do not enable AI/folders; original checks before/after await remain.
- Identity: Use template and Duplicate make independent IDs/history; Continue ZIP preserves identity/history and compare-and-swap; deleting a device project never deletes folder files.
- Save durability: autosave flush before navigation/update, manual Cmd/Ctrl+S, failure pause and retained in-memory edits stay intact.
- Draft/run safety: Preview draft does not apply; Apply validates once with stale-conflict handling; frozen block scope stays exact; keep/retry/recovery never implies paid restart.
- Background runs: library activity persists; project switching does not stop runs; delete handles active runs with original confirmation.
- Preview bridge: old ready frame stays until successor ready; blob disposal, iframe sandbox, source/token checks and thumbnail script restrictions do not change.
- Shared hosts: locales, Versions, published/lifecycle/external-preview branches remain available to applicable embedded hosts and are not newly exposed in standalone Studio.
- Theme and language: UI theme persists; template content locale is not a new global language switch.
- Accessibility: menus/tabs/dialogs/resizers preserve keyboard contracts, focus and touch targets.

## Validation ownership and order

1. Each agent runs relevant focused checks after its final source changes, reports commands/results and captures representative evidence. Do not broaden tests repeatedly without a new change/failure.
2. Root runs the consolidated checks after merge-free shared-workspace integration:
   - `npm test --workspace=@trafficops/template-studio`
   - `npm test --workspace=@trafficops/template-editor-shell`
   - `npm test --workspace=@trafficops/studio-ui`
   - `npm run check --workspace=@trafficops/template-studio`
   - `npm run build --workspace=@trafficops/template-studio`
   - `npm run build:embed --workspace=@trafficops/template-studio`
   - `npm --prefix docs run build`
3. B updates deliberate UX selectors in library/home/AI tests without dropping identity, attachment, download or offline assertions. C updates only changed export/management selectors and keeps existing shadow-root assertions. Root adds cross-surface acceptance coverage for manual app default Content, Projects/Templates/activity, direct-template disclosure, visible mobile save state and the reduced navigation hierarchy.
4. Browser coverage on production builds, with external provider requests stubbed or blocked:
   - Core: `studio-browser.mjs`, `library-browser.mjs` including real SW offline/Monaco, `pwa-access-browser.mjs`, `home-chat-browser.mjs`, `library-ai-browser.mjs`.
   - Shared/integration: `packages/studio-ui/test/{chat-browser,primitives-browser}.mjs`, `creation-browser.mjs`, `editor/test/consumer/browser.mjs` for embedding if changed shell paths require it.
   - Persistence/error/draft: `autosave-browser.mjs`, `recovery-browser.mjs`, `explicit-save-apply-browser.mjs`, `retained-draft-settings-browser.mjs`, `conversation-ui-browser.mjs` and `conversations-browser.mjs`.
   - Selection/forms: `rich-text-browser.mjs`, `interactive-preview-browser.mjs`, `interactive-preview-security-browser.mjs`, `preview-block-selection-browser.mjs`. Add image/clipboard/crop checks only if associated product source changes or a regression warrants them.
5. Extend/use `workspace-axe-browser.mjs` to cover active library views, create/export/management dialogs, Content/Code/Conversations and mobile Files/Preview. Test 1440 and 390 widths, light/dark, browser/PWA; scope iframe/Monaco exclusions honestly. Zero critical/serious violations; check visible save state, labels, focus order, 44px coarse targets and document overflow separately.
6. Fresh screenshots are task evidence, not a contact sheet substitute: empty/populated Projects, Templates, generic/direct/AI creation, import review, Content/Code/Conversations, mobile Files/Edit/Preview, narrow management open/archived, export and settings; docs home/article/search/404. Use 1440×900, 390×844 and a tablet transition; light/dark on representative states. Scroll lazy thumbnails into view before assessing them. Inspect stateful UI rather than only full-page screenshots.
7. Root measures production Lighthouse with the cached transient CLI, not a project dependency. Baseline docs is performance 99, accessibility 98, best practices 100. Verify the main/Search fixes and compare final library/docs performance honestly; avoid declaring a score for PWA functionality that Lighthouse did not test. Record blocked/unavailable metrics if any.

## Independent review and handoff checklist

Reviewer must inspect current source alongside this plan and raise concrete risks before implementation: project/catalogue identity distinctions, direct-source default naming, initial-request restore and embedded behavior, nested form/portal/focus handling, mobile pane transitions, retained errors/recovery, template/history export and narrow management functions. Resolve findings in this plan or a linked review record with precise amended acceptance.

Dispatch A, B and C with their ownership rows and acceptance requirements. Keep canonical brand assets and data/service modules untouched. Root integrates source/tests, checks the final functional and visual results, and reports tested behavior plus material limits to the user. No deployment, publishing, commits, OPFS work or live AI generation is part of this task.
