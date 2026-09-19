# Landing Studio by TrafficOps

A static application for creating reusable TrafficOps templates and landing pages, with a local project library. The installed PWA also provides an AI code assistant and direct folder access through the File System Access API. Built with React, Vite, Monaco Editor, Tailwind CSS and daisyUI. It uses the shared `@trafficops/template-runtime` workspace, so CLI and editor generation have the same behavior.

[Open Landing Studio](https://studio.trafficops.io).

## Run

From the monorepo root, with Node.js 22 or later:

```sh
npm ci
npm run dev --workspace @trafficops/template-studio
npm run test --workspace @trafficops/template-studio
npm run build --workspace @trafficops/template-studio
```

Vite writes the deployable static site to `editor/dist`. The root Netlify configuration handles deployment. The editor package is private and is not published to npm.

## Host capabilities

`App` supplies Studio chrome and a `LibraryHost` for browser projects or a
`StudioHost` for folder projects to `@trafficops/template-editor-shell`.
The same shell is mounted by the embedded entry through `HttpHost`. Host ports and
capabilities come from `@trafficops/template-editor-core`; the shell does not own
storage, compiler policy, lifecycle rules or credentials. In standalone Studio,
AI creation, editing, content filling, image generation and BYOK settings are
available only in the installed PWA, as is File System Access folder access.
Ordinary browser tabs retain manual library, template, blank-project and ZIP
workflows. This restriction is specific to Studio's hosts; it does not change the
embedded PWApps editor's `HttpHost` capabilities. Both text and image requests
in installed Studio use the user-owned AI port.

## Workflow

1. Open **Library → New project**, choose **Landing page** or **Reusable template**, then start **From template** or **From scratch**. The installed PWA also offers **With AI**. Included starters work offline after the application is cached. Your own templates appear alongside them. Each new project has its own files and field values; using a template creates an independent copy and never modifies the source template.
2. The library supports search, template/landing filters, duplication, deletion and **Import ZIP**. Imported `.tpl`, `.tpl.html` or HTML projects retain assets and customized values; a common enclosing directory is removed automatically. In a landing editor, **Save as template** copies the current files and values into a new reusable template. Library projects autosave in ordinary browser tabs and the installed PWA.
3. Use **Project files** to create files or folders, upload local files, and drag files or whole folders to a new location in the tree. Select a source file for syntax highlighting and IntelliSense: directives, snippets, project types, parameter paths, blocks and includes. Hover shows references; `@render` calls show argument hints. Use **Hide preview** for more editing space. Moving or renaming files does not rewrite includes or asset paths.
4. **Content** builds inputs from template declarations, including groups, repeaters, numbers, colors and choices. Image fields support uploads, local assets, crop, positioning and resize, respecting `aspect_ratio` and `sizes`. Load/save settings JSON to reuse values with the CLI. In the installed PWA, the **AI assistant** edits source or fills content, shows streamed changes, and lets you review the result before applying it.
5. Choose a generated page and desktop/mobile preview. All `.tpl` pages with an `@layout` block are generated; declaration-only files serve as includes. Preview is static: scripts, forms and external network requests are disabled.
6. **Download landing** exports generated HTML and assets. **Download project → Source ZIP** retains editable source, assets, empty folders and `.trafficops/values.json`, so customized values survive import. Neither export includes API keys. Source ZIPs are portable backups; HTML ZIPs are the generated pages for hosting.

For direct disk editing, install the PWA in Chrome or Edge and choose **Open folder** or **Folders → Add project folder**. Studio remembers multiple directory handles; empty folders receive a starter template. Changes, uploads, empty folders, moves and deletions autosave to disk, with field values in `.trafficops/values.json`. External file changes stop saving until you reload. Ordinary browser tabs do not open or reconnect remembered folder handles, even if permission was previously granted in the PWA. Browsers without folder access can use the local library and ZIP import/export.

Use **Format** in the source toolbar, **Format Document** in the context menu, or **Shift+Alt+F** to format the current file. TPL formatting shares the VS Code extension's standalone formatter, indents declarations and HTML with two spaces by default, and is one undoable edit. Imported files are only reformatted when you request it. Press **Ctrl+Space** to show suggestions; **Tab** accepts a snippet and moves through its placeholders. Enter automatically indents TPL blocks and HTML elements. Ordinary HTML, CSS, JavaScript and JSON files use Monaco's bundled language services. All authoring services and formatting run locally in the browser.

Creating or renaming a file, and creating a folder, suggests existing project folders as you type, including empty and nested folders. Click a suggestion or use **↑/↓**, then **Enter** or **Tab**, to complete the folder path with a trailing `/`. Continue with the new name. **Esc** hides suggestions; a second **Esc** closes the dialog. New paths can still be typed freely.

The library stores separate project records, binary assets, folders, field values and the active selection in IndexedDB. Saves complete only after the transaction commits. Revision checks prevent another tab from silently overwriting newer edits or recreating a deleted project; conflicts keep the editor's changes available for export before reloading. Browser storage is local to this device and browser profile. It is not cloud synchronization, and clearing site data removes the library; keep source ZIP backups.

The last selected library project reopens on startup; otherwise Studio shows the library or, in the installed PWA, restores the last folder workspace. Existing single-workspace ZIP sessions migrate into the library. Folder recovery snapshots preserve pending changes when access expires or disk content differs. In the installed PWA, **Reconnect folder** requests permission and saves an independent library copy of recovered edits before opening the folder. Directory handles and display labels remain separate from library projects.

Browsers expose the selected directory name, not its absolute filesystem path. **Manage folders & paths** accepts an optional full path label for the project selector. This label is display metadata; it never changes the actual directory handle.

Changed files show a dot and new files show `+` relative to the last saved revision. Indicators clear after a successful save. AI changes have a separate pending-review indicator. Project navigation saves pending edits first and waits for active operations or AI review to finish.

## Installed app

The production build includes a web app manifest and an offline service worker. The installed **Landing Studio by TrafficOps** launches `/?studio=1` in standalone display mode, restoring the last project or showing the library. Projects open with the expanded editor; its toolbar keeps library navigation, creation and save actions accessible. Opening `?studio=1` in an ordinary browser tab or entering browser fullscreen does not enable installed-app capabilities. AI and direct folder access require the installed PWA; installing the app does not enable them in ordinary tabs. After the application has been cached, local editing, included starters and ZIP export work offline. AI requests require a network connection.

Studio checks for service-worker updates when connectivity or focus returns and periodically while open. **Update Studio** saves current edits before applying an update; an update started in another window does not automatically reload this window. Storage, registration and update failures are shown in the interface.

## OpenRouter BYOK

In the installed PWA, open **AI assistant → AI connection settings**, enter an OpenRouter API key, and choose a text model with tool calling. `openrouter/auto` is the text default. Set a separate image model ID from the OpenRouter catalog to enable image generation. The connection is stored in a separate IndexedDB database, outside project folders, recovery snapshots and exports. **Remove key** deletes the connection. Ordinary Studio browser tabs expose neither AI settings nor AI operations, including when a connection or an AI creation brief was saved previously.

**New project → With AI** saves a separate project and its brief (up to 6,000 characters), then starts generation if a connection is already configured. The initial request is claimed once before calling the provider. Reloading keeps the brief for a manual retry and never automatically repeats a paid run. Without a configured key, connect in the editor and start the request manually.

- **Edit project** seeds the working copy with existing files. The agent reads text files on demand, uses `edit_file` for exact replacements and `delete_file` for requested text-file deletions, writes complete files incrementally, and preserves untouched files and binary assets. The prompt, field values, file manifest and source read through tools reach OpenRouter and the selected provider. Binary image contents are not sent to the text model.
- **Create new** inside the assistant starts a replacement working copy for the current project, including disk deletions for a folder project when applied. A confirmation explains this before generation. Use the library's **New project** flow to create a separate project.
- **Fill content** sends field definitions, authoring instructions, current values and available image paths. It retains the template structure and validates values with the runtime.
- **Generate image with AI** sends the image brief and field description to the dedicated `POST /api/v1/images` endpoint. The returned raster image is opened locally for crop/resize and added to `images/` only after confirmation.

Text agents use streamed tool calls, a maximum of 16 steps, a fifteen-minute run budget with five minutes per provider call, and no SDK retries. An upstream idle timeout allows one announced recovery attempt within that same call/time budget, switching to compact individual file writes; other errors are not retried. Their final changes must pass the real parser and renderer after the last mutation. Editing tools limit changed source to 256 KiB per file and 1 MiB total; binary assets are retained but cannot be rewritten by text tools. Explicit cancellation/discard restores the original project. Validation failures are returned to the model for repair within the run budget, with the last three steps reserved for checks and corrections. Completed writes survive invalid output, provider failures and timeouts as a draft marked as needing attention. Users can continue from that draft in a new run or keep it in the editor for manual correction; unfinished file strings are never retained, while strictly complete file objects from an interrupted batch can be recovered after normal path/type/size checks. Independent file tools are enabled in the same response, reducing provider round trips, while validation runs after mutations. During file generation the user can send up to eight clarifications, each at most 6,000 characters, without cancelling. They reach the next provider step, even if the previous step ended in a final summary, and require validation again within the same run budget. The user can inspect live source/preview, then **Apply changes** or **Discard**. Concurrent source edits and project switches are blocked until review ends.

Text requests use `https://openrouter.ai/api/v1/chat/completions` with provider data collection disabled. Content filling prefers strict JSON schema and has a locally validated JSON fallback for unsupported endpoints. Image requests use the [dedicated Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) and the selected model’s provider policies. Requests are billed to the user’s OpenRouter account; provider latency and model support vary.

## Privacy and preview

ZIP import, parsing, generation and ZIP download happen in the browser. There is no TrafficOps API, account, analytics, upload endpoint, or remote image storage. Monaco, fonts, scripts and styles are bundled locally; no CDN is required. Ordinary site hosting still receives requests for the application itself. OpenRouter is the only optional remote workflow and runs only after the user supplies their own key and starts an AI request; the data boundary is described above.

Image controls accept relative paths, for example `images/hero.jpg`, and provide project-file selection plus a local upload/drop zone. Images are added under `images/`. **Use original** preserves original bytes for unconstrained fields; **Use image** exports the chosen crop as PNG. Output dimensions are bounded at 4096 px per side, and image decode is limited to 64 megapixels. The preview creates temporary in-memory data URLs for included images, CSS and fonts; exports preserve the original relative paths. Assets not present in the project cannot appear in the local preview.

Preview HTML runs in an iframe with an empty sandbox and a restrictive Content Security Policy. Scripts, forms, navigation, frames, external images/styles/fonts and network connections are disabled. Local CSS and image URLs are resolved relative to the selected page. Responsive `srcset` is omitted in preview (the `src` fallback is used); generated output is unchanged. This is a static layout preview, not a test environment for executable page scripts.

The JavaScript runtime deliberately supports a documented portable subset of the PHP DSL; see [runtime compatibility](../runtime/README.md). Unsupported constructs produce a visible error and disable generation.

## Import bounds

- ZIP: at most 20 MiB compressed, 32 MiB expanded, and 500 entries.
- Files: at most 8 MiB each; editable UTF-8 source: at most 2 MiB each. Generated HTML export permits the runtime’s 8 MiB per-page output budget.
- Library projects: at most 500 files and folders combined, with JSON field values bounded to 2 MiB. Browser storage quota still applies across projects.
- Traversal, absolute paths, hidden files/directories (except the exported `.trafficops/values.json` sidecar), control characters, ambiguous paths, duplicate entries, symlinks, encrypted files, multi-volume archives and ZIP64 are rejected.
- Metadata and local ZIP headers are checked before decompression. Import runs in a separate worker with a 15-second timeout.

Source templates have additional parser and rendering limits enforced by the shared runtime. Preview expansion has a separate 32 MiB encoded budget and a 12-level CSS import limit; exceeding these shows an error while generated ZIP download remains available. Large media projects should be reduced before import.

## Branding

The warm cream/coral palette, typography and logo derive from the original `packages/ui/resources/css/theme.css`, `BRAND_GUIDELINES.md` and TrafficOps SVG mark. Onest is bundled through `@fontsource-variable/onest`. Small button text uses dark text on coral as specified by the brand contrast guidance.

The browser adapter reuses `@trafficops/template-language` in the `safe-html-v1` dialect and lazily loads `@trafficops/template-language/formatter`. Vite bundles the published language package; no VS Code application or server is required.

## Implementation references

- [Monaco ESM integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)
- [daisyUI with Vite](https://daisyui.com/docs/install/vite/)
- [fflate ZIP APIs](https://github.com/101arrowz/fflate)

Monaco language, IntelliSense, formatting and Vite worker registration now live in
`@trafficops/template-editor-monaco`. Each code model receives the host dialect
descriptor; missing or unknown descriptors disable TPL assistance. Studio supplies
its safe descriptor in `studio-dialect.js`, and the HTTP editor reads the descriptor
from the authoritative server payload. Concurrent editor projects use distinct URI
authorities.

Host contracts and the pure project/archive model live in
`@trafficops/template-editor-core`. `src/hosts/LibraryHost.js` adapts versioned
browser projects through `src/studio-library.js`; `src/hosts/StudioHost.js` adapts
folders and recovery sessions. `embedded/src/HttpHost.js` adapts the existing PWApps protocol.
`npm run check` checks the host implementations against `contract.d.ts`, including
AI transport/settings and optional ports. The conformance suite uses disposable
folder handles and a fetch-level protocol mock, plus a third trusted-dialect host.

The embedded mount accepts `initialAiRequest: { id, prompt, mode: 'create', autoStart: true }`
for a newly created page. The assistant opens with that prompt and claims it through
`POST {endpoint}/ai-kickoff` (`requestId`, `revision`) before beginning the team's AI
run. The host returns `{ started: true }` only once. Reloads can pass the same prompt
with `autoStart: false` and `mode: 'edit'` for manual recovery. The server owns request
identity and project access; client settings do not authorize a paid run by themselves.

Page payloads can set `canSaveTemplate: true` to expose **Save as team template**.
The named action submits all current editor state and `templateName` to
`POST {endpoint}/save-template`. The response includes the saved page state and an
optional `notice`. Shared-shell lifecycle descriptors also support an optional
`input: { label, value, maxLength, help }`; its trimmed value reaches the host as
`inputValue`. Failed actions keep this dialog and entered name available for correction.

The single diagnostic corpus lives in `packages/template-editor-core/fixtures/`.
PWApps installs the core tarball as a development dependency and reads that
package; the two repositories no longer maintain copies of the fixture. To test a
staged corpus before packing, set `TEMPLATE_EDITOR_CORE_FIXTURES` for PHP tests.

## Shared-shell browser checks

Use a Playwright installation supplied by the caller. On macOS the checks use the
system Chrome executable; on Linux install the matching Playwright Chromium.

```sh
npm run build:editor
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/library-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/library-ai-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/recovery-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/studio-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/pwa-access-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/agent-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/autosave-browser.mjs
npm run build:embed --workspace=@trafficops/template-studio
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/creation-browser.mjs
node editor/test/consumer/build.mjs /tmp/template-editor-consumer
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/consumer/browser.mjs /tmp/template-editor-consumer/dist
```

The second build installs only packed public packages into an independent project.
Its third host has opaque revisions, a trusted dialect, no AI/lifecycle or HTML
export, and a PHP project that cannot render locally. Browser checks also send an
unknown dialect ID and schema and assert plain Monaco mode while file creation
and saves still work. No runtime compiler or PWApps code is installed there.

The agent browser check uses a paused, mock OpenRouter SSE response and no paid requests.
It verifies partial source in the assistant and Monaco before tool completion,
clarifications delivered at the next step, edit/delete tools, preview, apply/discard,
and rollback on cancellation or provider failure without retries.

The PWA access check verifies that ordinary tabs cannot use AI or remembered
folder handles, even with saved credentials, a pending AI brief, `?studio=1`,
browser fullscreen or an `appinstalled` event. It also checks that browser tabs
preserve folder recovery and that simulated installed mode exposes AI and folders.

The library browser check covers creation, template copies, saved fields,
duplication/deletion, source ZIP export, mobile layout and offline editing after
a real service-worker reload, using an isolated browser profile.

The autosave browser check exercises pending-save navigation and failed-save
recovery with a disposable host. It does not use production projects or credentials.

The recovery browser check uses isolated simulated folder handles and real
IndexedDB transactions to exercise detached saves, unreadable-folder fallback and
conflict rescue. Set `STUDIO_NATIVE_HANDLES=1` to probe persisted OPFS handles on a
browser that supports them; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides its executable.
