# Docs and Landing Studio: UX redesign brief

Date: 2026-10-02. This second pass follows the functional inventory and visual audit in this directory. Both audits completed before brainstorming. The user explicitly requested subagent audits, a planner, an independent plan reviewer, and implementation agents.

## Human decisions

- Studio starts with projects and templates. Continuing work is the primary returning-user task. AI is available during creation and inside the installed editor.
- The library has separate Projects and Templates views. Projects is the default; Templates is one action away. Reusable project type and starter templates must remain distinct concepts.

## Design read

A calm TrafficOps workspace that makes the next editing action obvious. Keep the approved TrafficOps geometry, Onest, warm light/dark/system palette, and coral accent. Use real previews and meaningful state, with less decorative copy and permanently displayed secondary controls.

Design-taste dials: variance 5/10, motion 2/10, density 6/10. The skill informs public docs and entry layout; authoring, forms, and code editing use the audited product interactions and accessibility requirements. No new UI libraries, imagery, marketing animations, or storage architecture changes.

## Brainstorm outcome

1. Library: compact title, Projects/Templates navigation, one New project entry, import/folder access, search and kind filters when useful. Saved projects appear in the first viewport. AI activity remains visible. Empty Projects offers a direct path to creation/templates without a giant AI onboarding hero. Templates includes real starter previews and access to reusable saved templates; managing and using a reusable template remain different actions.
2. Creation: preserve template/blank/installed-AI methods. A direct starter selection shows that chosen starter and a project name, with an explicit change-template action rather than asking the same question again. Generic New project lets the user choose a method; manual is the initial default in both browser and PWA. Advanced project type remains discoverable without competing with the first task. Preserve brief attachments, image choices, asynchronous settings, errors and source identity rules.
3. Workspace: manual PWA creation opens Content; an actual AI initial request still opens Conversations. On mobile Files/Edit/Preview provide the main panel context, author modes stay inside Edit, and the save state is visible. Hide unrelated author navigation in Files/Preview. Reduce persistent technical notices and controls while keeping recovery and error actions explicit.
4. Conversations: a narrow-screen full management panel must expose the existing search, open/archived list, rename, archive/restore and delete operations. Reuse existing logic. Keep draft review, run recovery, scoped edits, model and attachment contracts unchanged.
5. Progressive disclosure: move JSON/reset controls into an accessible Content actions menu. Consider focused richtext toolbar disclosure only if editor selection and mount stability can be proved; do not destabilize editing for cosmetic minimalism. Image crop/upload/generation must remain accessible. Export selects a format once and then confirms its purpose/options; preserve history and continue-URL capabilities for applicable hosts.
6. Docs: task-first home with a short heading, immediate Studio/CLI/PHP routes, a concise real language example and reference links. Keep article URLs, anchors, Shiki grammar, search, sidebar, TOC and prev/next. Simplify global navigation presentation while retaining existing destinations and primary names. Reading and long technical content take precedence over decorative layout.
7. Occasional preferences/help: a compact accessible theme menu preserves system/light/dark persistence. Quick start should describe the workflow once rather than repeat diagram, numbered rows, tags, and copy. Preserve installed-only capability messaging where useful.

## Required planning/review outputs

Produce an actionable ownership-separated implementation plan. For each change include functional preservation, exact files, responsive/keyboard/error behavior, acceptance evidence and relevant existing tests. An independent reviewer must inspect source and challenge lost functions, hidden controls, AI initial-request handling, shared-host compatibility and test coverage before implementation dispatch. Record resolved concerns.

Source/data invariants are authoritative in feature-inventory.md. Do not implement the separate folder-first/OPFS spec, enable AI/folders in a browser tab, or alter recovery/apply/storage semantics. Existing dirty changes are the baseline and must be preserved. A file archive exists at /tmp/trafficops-redesign-v2/pre-implementation.tar.gz for comparison, never automatic rollback.

## Validation

Use the relevant unit, host type, docs/editor/embed build checks and meaningful browser regressions. Inspect fresh screenshots for empty/populated library, create/import/export, Content/Code/Conversations/Files/Preview, narrow thread management, light/dark, mobile and installed/browser capability differences. Check accessibility and overflow. Provider requests must remain stubbed or blocked during tests. Report performance checks honestly; Lighthouse is not currently installed and should be attempted transiently without adding a project dependency.
