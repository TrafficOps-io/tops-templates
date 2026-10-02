# Independent implementation-plan review

Date: 2026-10-02. Reviewed the completed `plan.md`, the brief and both audits against current source. Product files were not edited; tests were not run by this reviewer.

## Decision

**Approved with resolved conditions.** The two concrete gaps below have been incorporated into `plan.md` before implementation dispatch. They remain implementation acceptance gates, not a claim that the resulting product already passes them.

The plan follows the user's Projects-first entry and separate Projects/Templates decisions. It separates saved-project management from using reusable sources, preserves manual and installed-AI creation, and assigns non-overlapping source ownership. The scope is appropriately limited: no storage/runtime changes, article rewrites, new dependencies or speculative richtext disclosure.

## Findings and resolutions

| Finding | Source evidence | Required resolution | Status |
|---|---|---|---|
| A failed management operation could be hidden behind the new conversation manager. | `StudioChat.jsx` reports thread actions in a notice inside `.studio-chat-bottom`; `ThreadList.jsx` invokes `onError` for mutation rejection. That notice alone is outside an overlaid manager. | Reuse port reporting while showing an accessible alert within the active manager. Rejected rename/archive/delete keeps the manager, search/composer state and another attempt usable. Verify failure through the real FakeChatPort callbacks. | Resolved in Narrow conversation management item 5 and the independent review condition. |
| The outer manager could compete with its inline delete confirmation for keyboard focus. | `ConfirmDialog.jsx` uses the non-native, form-based `Modal.jsx`. Its Tab trap does not stop propagation. `workspace/focus.js`'s `trapFocus` does not check `event.defaultPrevented`, so blindly adding an ancestor trap may move focus again. | The manager yields to nested menus and the topmost confirmation. It must not wrap ThreadList's rename form in another form. Forward/reverse Tab stays in delete confirmation; Escape/Cancel closes that confirmation, leaves the manager open, and restores row-action focus. | Resolved in Narrow conversation management items 3–4 and the independent review condition. |

## Source contracts checked

- **Opening intent:** `EditorShell.jsx` currently selects AI from any conversations port. The planned app-only fix distinguishes `host.ai.initialRequest` from manual projects and preserves the embedded default. `LibraryHost.js` retains an initial-request object for saved AI briefs, including restored requests with `autoStart:false`; requiring only `autoStart` would incorrectly hide their recovery conversation. The plan explicitly preserves claim-once/no-paid-restart behavior.
- **Mobile context:** author mode, mobile pane and preview visibility are independent state in `EditorShell.jsx`. The plan retains all three, scopes presentation changes to `.is-app`, hides only unrelated navigation, keeps editor instances mounted, restores Edit if active Preview becomes unavailable, and verifies actual save status in every pane.
- **Direct template creation:** `CreateProjectDialog` uses `initial.source`, a null-until-typed name and native radio selection. The new summary preserves that handoff, automatic naming until user input, independent-copy semantics, source disappearance errors, and keyboard traversal without collapsing the picker on radio arrow changes.
- **Exports:** `historyAction` preselects a historical target; embedded Download project opens source export directly; applicable hosts expose Continue URL. The plan keeps these paths while removing only the repeated format select. It preserves conversation-history defaults, locale information and download errors.
- **Shared chat/embedding:** the existing compact Conversations menu is used by `support/studio-chat.js`. Keeping it and adding Manage conversations preserves quick switching. Reusing ThreadList preserves search/archive/restore/rename/delete mutations and translation context; inline row menus and confirmations must stay within the caller's shadow root. Distinct test IDs and scoped assertions prevent a hidden desktop list from satisfying narrow-management checks.
- **Recovery and capability boundaries:** one app shell alert is permitted only for the same shell cause. Outer App storage/import/update/recovery controls remain independent. Browser AI/folder guards, identity/CAS, draft Apply/Preview semantics, frozen block scope and preview sandbox are outside product edits and remain validation gates.
- **Docs:** the planned navigation grouping keeps existing destination names/URLs. Home simplification retains the real TPL example, search, sidebar, outline, anchors and reference reading surfaces; main-landmark and Search naming changes have explicit acceptance checks.

## Handoff requirements

Dispatch the three implementation owners listed in `plan.md`. Carry both resolved conditions into agent C's task, including nested delete keyboard and visible rejection tests. Root must inspect production screenshots and run the consolidated checks and relevant regressions before declaring completion. Test-selector updates may reflect changed presentation but must retain identity, offline, attachment, recovery and no-provider-call assertions.
