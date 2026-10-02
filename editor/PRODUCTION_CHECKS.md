# Landing Studio verification

> Historical log. Storage notes below (LibraryHost, IndexedDB library, folder recovery, `pwa-access-browser`, `recovery-browser`) are superseded by folder-first storage: see `docs/superpowers/specs/2026-10-02-folder-first-storage-design.md`. Current checks are `storage-access-browser.mjs`, `folder-access-browser.mjs` and `storage-contract-browser.mjs`.

## Sections and mentions production publication — 2026-10-01

The searchable section multi-select and file/section chat mentions were published to [studio.trafficops.io](https://studio.trafficops.io) through the existing Netlify ZIP deployment path. Deployment `6abe58a1e63dea32c7739656` became ready and was published at 2026-10-01 15:57:07 EEST (2026-10-01T12:57:07.218Z). Its [immutable deployment](https://6abe58a1e63dea32c7739656--trafficops-templates.netlify.app) contains 47 files; the uploaded ZIP SHA256 is `d667fae17ecd5f994717c6078d7cfec8bcc364f016020b642a319949f15e7bde`. The previous deployment is `6abe48c477717e275094345e`.

- The source passed 442 Studio tests, 110 shared-shell tests and the Studio TypeScript check. A fresh production build and the frozen release's browser checks passed before upload.
- All 45 public deployment files, including HTML, main JavaScript/CSS, manifest, service worker and Workbox, match the frozen release by SHA256. Root HTML, immutable asset caching, mutable PWA resources and security headers passed verification.
- Disposable Chrome contexts on the published site passed searchable multi-selection, repeated-instance labels, file and section mentions together, reference deduplication, prompt preservation, persisted section references and source navigation. Existing history, review, file scope and export flows passed. Layouts fit 1024 and 320 px without horizontal overflow; the composer remains usable at a 720 px viewport height.
- The production service worker activated and controlled the page. An offline reload retained the project and allowed section mentions. No page errors, real credentials or paid AI requests were used.

This publication updates the standalone Studio site. The pinned embedded-editor artifact in PWApps is managed separately.

## UI/UX production publication — 2026-10-01

The updated conversations, image mention previews, single installed-project header and home AI chat were published to [studio.trafficops.io](https://studio.trafficops.io) through the existing Netlify ZIP deployment path. Deployment `6abe48c477717e275094345e` became ready and published at `2026-10-01T11:49:26.321Z`. Its [immutable deployment](https://6abe48c477717e275094345e--trafficops-templates.netlify.app) contains 47 files; the uploaded ZIP SHA256 is `748769805337c77997d5fb1c777a94d0778fd3f38528a83e4b711b61bc0851ac`. The previous deployment is `6abe38fc76d16b3c275c98c0`.

- Before publication, 442 Studio tests and 105 shared-shell tests passed, together with TypeScript checks, the production build and browser checks for home creation, conversation layout/lifecycle, browser capability restrictions and existing editor workflows. Conversation checks covered image mentions, history controls, 320/1024 px layouts and a 720 px tall viewport with multiple references and a resized composer.
- Production HTML, main JavaScript/CSS, manifest, service worker and Workbox loader match the frozen release by SHA256. Service-worker, HTML, manifest and immutable asset caching headers passed, as did the security-header checks.
- Disposable Chrome contexts on the live site passed ordinary-browser capability restrictions, homepage layouts at desktop/390/320 px, template creation with an attachment and a brief saved without credentials, and landing creation through generation, draft review and apply. The installed workspace has one full-height project header and retains help/documentation controls; returning to the library restores its home header.
- The real production service worker activated and controlled the page. An offline reload retained the applied landing and the single project header. No page errors were recorded. Installed display mode was simulated, and all four AI provider requests were intercepted with synthetic responses; no paid requests or real folder access were used.

This publication updates the standalone Studio site. The pinned embedded-editor artifact in PWApps is managed separately.

## Production publication — 2026-10-01

The current editor, shared shell/core and runtime changes were rebuilt and published to [studio.trafficops.io](https://studio.trafficops.io) through the existing Netlify ZIP deployment path. Production deployment `6abe38fc76d16b3c275c98c0` became ready and published at `2026-10-01T10:42:06.856Z`. Its [immutable deployment](https://6abe38fc76d16b3c275c98c0--trafficops-templates.netlify.app) contains 47 files; the uploaded ZIP SHA256 is `08d85d9c2c13d0ac6e4e89df0f2d1d2f1ea3f4b821efdf08dc674c1527c17534`.

- Live HTML, main JavaScript/CSS, manifest, service worker and Workbox loader match the built files by SHA256. The service worker uses `no-store`, `/index.html` and the manifest use `no-cache`, and hashed assets use immutable caching. Security headers are present.
- Disposable Chrome profiles passed the ordinary-browser capability restrictions and the simulated installed workspace, including its permanent editor, imported conversation history, separate draft review, rename/archive/restore/search, file mentions, a local text reference and settings navigation.
- The unified Export menu produced an editable ZIP with project identity/history and a generated hosting ZIP. The real production service worker supported offline reload, Monaco editing, a verified durable autosave from revision 1 to 2, source ZIP export and retention of the edit after another offline reload.
- Layout checks passed at 1024 and 320 pixels without horizontal overflow. The live check recorded no page errors, external requests or AI provider calls. Installed display mode was simulated; real folders were not accessed.

This publication updates the standalone Studio site. The pinned embedded-editor artifact in PWApps is managed separately.

## Project conversations and portable identity — 2026-10-01, local build

- Studio uses a persistent conversation list per project and a single message composer with attachments and file mentions. Each conversation prepares its own reviewable draft. Up to two runs execute concurrently per app window; editing, project switching and other conversations remain available. Applying a draft merges against the current saved project and requires explicit review when files or referenced context have changed.
- Conversation checkpoints are saved before subsequent provider requests. Stopping, leaving or reloading never repeats a paid request automatically. Interrupted drafts remain available for review or explicit continuation. Applied run markers protect against duplicate application after reload.
- Saving a device project to a folder preserves its project ID and conversation history. Portable source ZIPs carry the same ID and optional history; importing a known ID offers continuation or an independent copy. Folder transfers and nonempty destinations are reviewed before replacement, and storage failures preserve the device recovery copy.
- Installed mode keeps the editor open. Project storage has descriptive controls, and one Export menu separates an editable source ZIP from the generated landing ZIP. Hosts without the optional conversation port retain the existing assistant workflow.
- All 836 JavaScript workspace tests, workspace type/syntax checks, production PWA and embedded builds passed. Existing large-bundle and upstream annotation warnings remain. The browser scenarios below use isolated profiles and mocked provider responses, with no real credentials or paid AI requests.
- Production browser checks cover two simultaneous runs with manual edits and project switching, reviewed application that preserves manual values, same-ID source ZIP import and interruption after reload without a provider replay. Conversation UI checks cover history, search, archive/restore/delete, file scope, full diffs and narrow layouts. AI creation, single-file/image edits and selected-block edits retain their review/apply behavior.
- The library/PWA checks passed for ordinary-tab capability restrictions, permanent installed workspace, source/hosting exports, service-worker offline reload and Monaco autosave. Recovery and autosave checks passed for failed storage, detached recovery, malformed folders and stale-tab conflicts. Existing content/source/review workflows also passed through a built host variant that omits the optional conversation port.
- Folder browser checks passed with real OPFS file operations and IndexedDB: same-ID transfer with a history checkpoint arriving during copying, reload, cancelled alternate binding, an untouched empty folder until Save, a concurrent cache-save conflict, and same-ID ZIP continuation. On this macOS runner, native serialization of OPFS directory handles into IndexedDB crashes both tested Chromium variants; the successful local run uses `STUDIO_NATIVE_HANDLES=0` to replace only the persisted handle reference with an OPFS-name bridge. Native handle serialization/reload remains a release check on an installed browser. CI keeps the test's native default.

Browser verification is recorded against local builds only; this does not publish Studio or replace the pinned embedded artifact used by PWApps.

## Image routing — 2026-10-01, local build

- AI creation and editing default to the configured image model for requested raster images. Explicit opt-outs remain preserved; creating a brief without a connection does not turn the missing connection into an opt-out.
- The source prompt no longer suggests SVG stand-ins for missing art. Image-enabled plans require an explicit image list. Completion checks require successful generated raster assets referenced in the draft; provider failures cannot become successful placeholder substitutions. Requested vector artwork remains supported.
- 412 Studio tests and 16 shared-shell tests passed, along with the Studio TypeScript check and production PWA/embedded builds. Existing bundle-size and upstream annotation warnings remain.
- A separate loopback origin exercised the production PWA through the actual UI with a mocked OpenRouter transport. Creating before connection, then selecting a model, enabled image generation. Create new project and Edit project each sent exactly one image request to the selected model, created PNG assets, applied them and retained them after reload. No real credentials or paid provider requests were used.
- This records local source/build verification. It does not publish the PWA or replace PWApps' pinned embedded-editor artifact.

## Current capability scope — 2026-09-19

AI creation, AI-assisted source editing, content filling, image generation and AI/BYOK settings are available only in the installed Studio PWA. File System Access folder operations also require the installed PWA, including restoring or reconnecting remembered folders whose permission was previously granted. Ordinary Studio browser tabs retain the manual local library, template/blank creation, source editing and ZIP import/export workflows. Neither `?studio=1` nor browser fullscreen unlocks installed-app capabilities. The embedded PWApps `HttpHost` follows its own host capabilities and is unaffected.

The clarified boundary was checked against the local production build:

- All 178 Studio and 14 shared-shell unit tests, workspace type/syntax checks, and both Studio and embedded production builds passed. Port tests cover denied storage/provider/filesystem access, saved connections, capability changes during asynchronous operations and queued saves.
- `pwa-access-browser.mjs` (since replaced by `storage-access-browser.mjs`) passed in Chrome: ordinary tabs expose no AI creation, assistant, image generation, connection settings or folder controls. Saved credentials and a pending AI brief do not start or claim generation. Previously granted folder handles are not loaded or accessed, and folder recovery survives ordinary library navigation, project creation and reload.
- `?studio=1`, an `appinstalled` event and browser fullscreen do not unlock a tab. DOM fullscreen is exercised directly; its media query is additionally simulated because headless Chrome does not consistently expose it. Installed launch mode is simulated in an isolated context and exposes AI and the explicit folder picker.
- A simulated standalone → fullscreen transition retains the open AI settings and working folder picker. Returning to browser mode revokes them; entering fullscreen again cannot restore them. Installed confirmation belongs only to the current window and is cleared on return to browser mode.
- Studio, AI-agent, library-AI, library/offline, folder-recovery and embedded-creation browser checks passed after applying the restriction. AI responses are mocked and folder recovery uses isolated test handles; this pass sends no paid requests and does not claim a native installation or real-folder retest.
- The access regression is included in CI. The embedded PWApps editor retains its host-provided AI capabilities.

The records below retain the earlier broader verification results. This pass does not record a deployment.

## Local library and PWA verification — 2026-09-19

This pass covered the source tree and local production build before the capability-scope clarification above. It does not record a deployment.

- Studio now has separate local templates and landings, creation from a template/blank page/AI, three bundled starters, gallery previews, search, duplicate/delete, source ZIP import and a save-as-template action. Copies include editable values, files and binary assets and do not mutate their source.
- LibraryHost (since removed; see folder-first storage) committed versioned IndexedDB records before reporting success. Saves protect against stale tabs and deleted records; navigation flushes through the editor so its revision stays synchronized. Storage failures pause automatic retries while keeping edits and explicit retry available.
- Legacy ZIP recovery migrates into the library. Detached folder recovery stays detached even after an in-memory save, and unreadable folders open the recovery copy. A conflicted project can be saved as a new independent project.
- AI startup is claimed durably before contacting the provider. Reloading preserves the brief without repeating generation. Pending application navigation blocks starting a new AI run.
- PWA registration replays update readiness, checks updates on return/online and periodically, reports failures, and does not reload other windows without their acceptance. The update action flushes edits first.

Validation completed:

- `npm test`: 319 passing tests across the JavaScript workspaces.
- `npm run check`: passed.
- Production Studio and embedded editor builds: passed. Service worker precaches 45 entries, approximately 15.5 MiB, including Monaco workers and fonts.
- Chrome library flow: blank creation and restore; template-to-landing independence; autosaved content; save as template; source ZIP field roundtrip; duplication, deletion, search and filtering.
- Chrome PWA flow: actual service-worker caching, offline reload, restored projects, Monaco editing and autosave, source ZIP download and a second offline reload. Installed display mode is simulated in an isolated browser context.
- Chrome AI creation flow: mocked provider, persisted claim before the first request, streamed draft, validation, apply/autosave, no repeat on reload, missing-key Settings flow, cancellation and recovery after a provider error. This pass sends no paid requests.
- Shared shell and embedded regressions: fullscreen layout, focus/Escape behavior, mobile preview, source export, streamed edit/delete/clarifications, cancellation, named template action and HTTP kickoff.
- Recovery browser checks (superseded by `folder-access-browser.mjs`): detached copies survive save/reload, malformed folder settings open the recovery, and a project deleted in another tab can be rescued with its edits, binary assets and folders. These use isolated simulated folder handles with real IndexedDB transactions; the native OPFS probe disconnected both tested Chromium processes in this environment. A minimal blank page with no Studio code reproduced the disconnect when reading the persisted handle after reload.
- Real React autosave hook: failed storage does not create a retry loop; manual retry, external operation lock and revision-safe flush work.
- Library and creation dialog fit a 390 px mobile viewport without horizontal overflow. Desktop and mobile screenshots were inspected.

The CI workflow now includes these browser checks with pinned Playwright and Chromium. Existing build warnings concern the size of bundled Monaco/formatter chunks and upstream Zod annotations; they do not prevent the build or offline precache.

## Historical verification — 2026-09-17

The notes below describe the earlier editor revision and its live-provider/native-install checks. The current browser/library behavior is described above.

Verified locally on 2026-09-17. This records the editor changes and their validation; it is not a deployment record.

## Automated checks

- `npm test`: 200 passing tests (runtime 22, CLI 7, editor 66, VS Code extension 105), no failures.
- `npm run check`: passed.
- `npm run build:editor`: passed, including the manifest and service worker.
- `git diff --check`: passed.

Focused editor coverage includes installed-mode capability detection, generated landing export, source ZIP/settings round trips, crop bounds, image response validation, existing-file AI edits, runtime validation, cancellation, file conflicts and unsaved file indicators.

## Browser scenarios

Checked with isolated desktop Chrome contexts and a 390 px mobile viewport. Installed display mode was simulated; no personal browser profile or real API key was used.

- Public browser view, including `?studio=1`, hides AI and folder integrations.
- Installed mode opens the full workspace with the project selector, settings and landing download in the toolbar.
- Settings are on a separate page. Device recovery restores customized values and source files.
- A streamed, mocked OpenRouter conversation updates source files, the file tree and rendered preview before review. Applying changes preserves existing customized values; cancellation preserves the original project and raises no unhandled browser errors.
- Uploaded and generated images enter the crop/resize dialog and become project assets after confirmation.
- Source ZIP export retains customized values and binary assets. Landing ZIP export contains generated HTML with current values and assets. Neither export includes the API key.
- Two serializable directory handles were exercised using browser-local test directories: restore the last project, switch projects, display path labels and persist values/source changes. Source indicators clear after a successful disk write.
- Source indicators remain visible in expanded and collapsed sidebars and clear after source export for ZIP projects.
- File/folder creation and file renaming suggest nested and empty project folders. Filtering, mouse/touch selection, keyboard completion and Escape handling are checked in Chrome.
- The built production app reloads offline, restores values, loads Monaco and exports a project without browser errors.
- The mobile workspace has no horizontal page overflow.

## Scope and remaining release checks

- The initial automated browser checks used mocked OpenRouter responses. The later native Chrome checks below exercised real free text models and one paid Nano Banana image generation with the user’s authorization.
- Persistent folder access was exercised with browser-local test handles and, after explicit user authorization, the real macOS folder `/tmp/studio—demo` (resolved by macOS to `/private/tmp/studio—demo`).
- Browsers do not reveal absolute local folder paths. The full path shown in the selector is optional user-supplied display metadata.
- The build still reports large Monaco/formatter chunks and third-party annotation warnings. Offline caching includes these bundles; first installation requires downloading the application assets.
- Publishing the built site and validating the deployed host were outside this local verification.

## Native Chrome and installed PWA checks

On 2026-09-17, the production build at `http://127.0.0.1:4174/` was also tested through native computer use, with actual Chrome and macOS dialogs:

- Installed the application using Chrome's install prompt. It was named **Landing Studio by TrafficOps** and opened directly into the workspace. The ordinary browser view hid AI, while the installed app exposed it.
- Changed a headline, cropped an existing image to 320 × 320, and verified the new local asset and its unsaved indicator. Downloaded the filled landing and source ZIP through the app. Source export cleared the indicator.
- Quit and reopened the installed app. It launched the manifest start URL and restored the customized headline and cropped image.
- Updated the installed app twice using its **Update** notification, retaining the project and unsaved markers. Update discovery was triggered through Chrome DevTools' service-worker **Update** control; activation used the app's own button.
- With Chrome DevTools' **Offline** enabled for the test app, reloaded the workspace, opened Monaco and exported a filled landing. A missing offline codicon font was found and fixed by including TTF assets in precache. Repeated the offline source-editor check without console resource errors, then restored online mode.
- Created an empty nested folder and used arrow keys plus Tab to complete `blocks/cards/` when creating a file. The created file appeared in the tree with its new-file indicator.
- Used the user's temporary OpenRouter connection with `openrouter/free`, sending only synthetic demo content. Creation produced a validated Clay Day template. Editing added a visible FAQ while preserving the other file. Content filling produced Russian field values while preserving structure and color. Changes were visible before applying.
- Found a live-model no-op that was incorrectly presented as a successful edit. Added identical-write/patch rejection and a final check that the draft differs from its original; added regression tests. The repeated live edit showed the FAQ in both source and rendered output.
- Cancelled an actual streaming response after text began arriving. The original project remained intact and controls became available again. Routed SDK stream errors through the sanitized UI handler so expected cancellation no longer logs a raw error. Repeated cancellation without console errors.
- Opened `https://studio.trafficops.io/` in Chrome: it still served the older **Template Studio BETA** interface. This local build was not deployed.

## Native folder and paid image follow-up

The user explicitly authorized creating `/tmp/studio—demo`, granting Studio access, and testing Nano Banana image generation.

- Created that folder with a synthetic starter template. Selected it in the native macOS folder picker and accepted Chrome’s permission for this exact folder. The app read its template, stylesheet and image.
- Changed the headline in Customize. Confirmed `.trafficops/values.json` on disk contains the new value. Set `/tmp/studio—demo` as the display path label; it survived restarting the app.
- Selected `google/gemini-2.5-flash-image` in Settings and sent one synthetic vase prompt through **Generate image with AI**. The live OpenRouter Image API returned a 1024 × 1024 PNG, which opened directly in crop/resize. Resized it to 512 × 512, accepted it, and verified the PNG plus its parameter reference were saved to disk.
- Downloaded the filled landing through the app. Inspected the actual downloaded ZIP: customized HTML references the generated image, the archived image bytes match the file on disk, and no API-key pattern is present.
- Created `qa-note.css` through the UI and edited it in Monaco. Observed its new-file marker while queued, then its removal after successful disk save. Verified the written comment on disk.
- Switched to a new session project and back to the connected folder using the toolbar selector. The saved values, image, source file and display path were retained.
- Found a native launch race: Customize restored correctly, but Chrome’s preview iframe retained its earlier starter document. Recreated the iframe when its generated HTML changes, rather than allowing competing `srcdoc` navigations in one frame. Rebuilt, activated the update through the app, then quit/reopened the installed PWA. The restored headline and generated image appeared immediately in the actual preview without toggling the panel.
- Re-ran all 200 tests, the workspace check, production build and whitespace check successfully after this correction.

The real-folder and paid-image checks are complete. No additional approval is pending. Deployment and validation on the public host remain separate release work.

The tested model was Nano Banana (`google/gemini-2.5-flash-image`), not Pro. Its published image-output rate is about $0.039 per 1024 image plus prompt tokens; the exact account charge was not read. See [OpenRouter’s model page](https://openrouter.ai/google/gemini-2.5-flash-image) and [Google’s pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-image). The latter currently schedules retirement of this model for October 2, 2026, so the model remains configurable rather than hardcoded as a production default.
