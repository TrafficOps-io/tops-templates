# Design preflight

This applies `design-taste-frontend` section 14 to the existing TrafficOps documentation and Studio entry. Editor screens use the audited interaction and accessibility requirements. The user's requirement to preserve existing functions and the approved brand takes precedence over marketing-specific prescriptions.

| Skill checks | Result and evidence |
|---|---|
| Brief inference, dial values, design system, audit-first | PASS. See brief.md, feature-inventory.md and visual-audit.md. Calm TrafficOps workspace; variance 5, motion 2, density 6. Existing tokens and primitives remain the design system. |
| Em dashes, copy self-audit, no decorative metadata or strips | PASS for new entry/home/dialog copy. Existing technical articles and existing content fall outside this copy rewrite. No new decorative status, version, place, weather, section numbering or scroll cues. |
| Page theme, accent and shape locks; one design system | PASS. Whole-page system/light/dark theme, approved warm tokens, one coral action accent and existing corner-radius scale. Embedded template previews retain their own authored design. Syntax token colours express the language grammar. |
| CTA/button/form contrast and desktop wrapping | PASS after correcting the selected creation method. WCAG browser scans include creation/options, library and workspace dialogs. New controls retain focus indicators and readable labels. |
| Serif and italic discipline | N/A. UI uses the existing Onest family, with no new italic or serif treatment. Authored template previews are independent content. |
| Premium-consumer palette | N/A. This is an existing developer workspace with an approved palette. |
| Hero fit, top padding, stack and eyebrow count | PASS. Docs has a two-line desktop title, 18-word description and three workflows visible in the first mobile viewport. Studio uses a compact task heading. No added eyebrow hierarchy. |
| Split-header and zigzag bans; floating explanations | PASS. Section titles and descriptions stay together. The home has two purposeful compositions; no repeating decorative zigzag sequence. |
| Duplicate CTA intent | PASS. Each home workflow has one primary destination; Studio has one New project entry. Persistent global navigation provides access across routes. |
| Logo wall, trusted-by placement and labels | N/A. No logo wall or invented social proof. Approved TrafficOps marks are preserved in the product chrome. |
| Bento backgrounds, rhythm and cell count | N/A. No marketing bento layout. Saved projects use compact rows; template cards show real renderings. |
| Real imagery, no fake screenshots or decorative SVGs | PASS in product context. Catalogue thumbnails render actual templates in sandboxed iframes. The docs example parses and renders through the real runtime. No generated marketing photography is needed. |
| Image overlays and photo-credit decoration | PASS. No new decorative overlays or credits. Existing Starter metadata describes an actual catalogue item. |
| Motion motivation, marquee cap, motion claimed/shown | PASS. Motion 2 means feedback and existing transitions. No marquees, scroll choreography or new animation library. |
| GSAP skeletons, scroll listeners, reduced motion, animation cleanup | N/A for GSAP/client-leaf animation. Existing reduced-motion behavior is retained; new disclosure transitions respect it. Native dialog and observer effects clean up their listeners, observers and pending focus restoration. |
| Desktop navigation height and line count | PASS. Docs navigation stays on one 64px line. Studio's desktop chrome stays compact; mobile editing uses explicit panel navigation. |
| Section-layout variety, long lists and density | PASS in product context. Documentation is reading/navigation rather than an eight-section landing page. Real language-reference tables retain their content and local horizontal scrolling. Projects and conversations use searchable management interfaces. |
| Quotes, version footers/hero labels, micro-copy strips, progress tracks | PASS. None added. Saving/run indicators represent real state rather than visual scoring. |
| Decorative dots, borders on every row | PASS. New project rows use one container boundary; no new decorative dots. Existing state badges retain their semantic purpose. |
| Dark tokens, mobile collapse, viewport stability | PASS. Light/dark checked; docs responsive sweep covers 320/768/960/1280/1920. Studio checks include browser/PWA and narrow Files/Edit/Preview. Dialogs scroll within a bounded dynamic viewport. |
| Empty/loading/error states and card restraint | PASS. Empty Projects and no matches are distinct, skeletons remain, manager failures appear inside its visible surface, retained-edit conflicts remain actionable. Cards are used for real template previews rather than every text block. |
| Icons | PASS with existing-brand exception. Existing Lucide icons are retained; replacing the project's icon dependency solely to match a marketing skill would conflict with the approved system. No new hand-drawn icon set. |
| No AI tells | PASS. Existing approved typography/palette; concrete copy, no invented proof or giant AI onboarding hero. AI is a creation choice and an installed-editor capability. |
| Core Web Vitals and Lighthouse | Production measurements and their limits are recorded in validation.md. Lighthouse does not measure long-session editing latency or prove an OS-level PWA installation. |

All marketing-only boxes are evaluated above as N/A with a specific reason. They do not justify deleting reference content, changing template content or introducing decorative assets into the editor.
