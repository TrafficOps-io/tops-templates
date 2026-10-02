# Theme menu layout correction

The user reported an unstyled Theme section in the editor's More menu after the redesign. Previous functional and accessibility checks missed this visual state.

Cause: shared Menu keyboard behavior supported `menuitem`, `menuitemradio` and `menuitemcheckbox`, while its base CSS only styled `menuitem`. The Theme menu's radio buttons inherited plain button typography and layout; the library had a partial local style which did not cover the editor menu.

Corrected `packages/studio-ui/styles.css` so all three menu-item roles share row width, typography, alignment and hover/focus treatment. Checked radio/checkbox items receive the existing selected-row treatment. Coarse-pointer rows retain a minimum height of 44px. Theme callbacks and persistence are unchanged.

Added `editor/test/theme-menu-browser.mjs` against the real app. It checks both library and editor menus, non-overlapping full-width rows, icon/caption alignment, matching ordinary-menu typography, keyboard focus/selection, Light/Dark/System changes and reload persistence. Matrix: web/PWA × desktop/mobile × light/dark, eight contexts. External provider calls are blocked and were zero.

Validation: dev and production regression PASS; shared primitives browser regression PASS; studio-ui 77/77 PASS; theme and token checks 7/7 PASS; editor and embedded production builds PASS; diff/parse checks PASS. Desktop dark and mobile PWA screenshots inspected directly.

Evidence: `/tmp/trafficops-theme-menu-fix/` logs; screenshots under `/Users/igorolshevsky/.codex/visualizations/2026/10/02/01a0fca6-8aa0-7d91-8d89-5d05275f13bb/templates-redesign-v2/theme-menu-fix/`. This is a local source/build correction, with no deployment or commit.
