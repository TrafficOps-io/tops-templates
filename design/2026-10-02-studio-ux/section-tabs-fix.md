# Long section navigation correction

The user's second screenshot showed eight long section names wrapping to two or three lines and being clipped by the panel header. Previous visual coverage used short section names and missed this case.

Reproduced in the real development app using the exact eight section labels from the screenshot. The new regression failed before the fix: `Profile Details` rendered on two lines at a 1440px viewport.

Corrected `packages/template-editor-shell/src/shell.css`: section tabs keep their natural width and full labels on one line. Existing horizontal overflow remains inside the section strip, with horizontal overscroll contained there. The app header uses a minimum height rather than a fixed height, and its tab hit targets retain 44px. This lets a native scrollbar take space without clipping captions. Embedded editors share the single-line section treatment but keep their existing header geometry. Shared Tabs behavior and template parameters were not changed.

Added `editor/test/section-tabs-browser.mjs` against the real app: all eight names, non-overlapping and unclipped captions, issue badges, local overflow, keyboard selection visibility with End/Home/arrows, retained edits when switching sections, reload persistence and preview-hidden layouts. Matrix: web/PWA ×1440/1024/390/320, alternating light/dark, eight contexts. External provider calls are blocked and were zero.

Validation: development and production regression PASS; existing Studio browser workflow regression PASS (workspace/focus, PWA settings, static import, preview and both ZIP formats); editor production build/service worker and embedded build PASS; parse and whitespace checks PASS. Production desktop and mobile screenshots inspected directly. Independent read-only review found no blockers or functional regressions.

Evidence: `/tmp/trafficops-section-tabs-fix/` logs; production screenshots under `/Users/igorolshevsky/.codex/visualizations/2026/10/02/01a0fca6-8aa0-7d91-8d89-5d05275f13bb/templates-redesign-v2/section-tabs-fix/`. Local source/build correction; no deployment or commit.
