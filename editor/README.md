# Landing Studio by TrafficOps

A static browser application for authoring TrafficOps templates and downloading generated pages. Built with React, Vite, Monaco Editor, Tailwind CSS and daisyUI. It uses the shared `@trafficops/template-runtime` workspace, so CLI and editor generation have the same behavior.

[Open Landing Studio](https://studio.trafficops.io).

## Run

From the monorepo root, with Node.js 22 or later:

```sh
npm ci
npm run dev --workspace @trafficops/template-editor
npm run test --workspace @trafficops/template-editor
npm run build --workspace @trafficops/template-editor
```

Vite writes the deployable static site to `editor/dist`. The root Netlify configuration handles deployment. The editor package is private and is not published to npm.

## Host capabilities

`App` accepts an optional `ai.Panel` capability. The public browser view has no AI or folder integrations; the installed PWA enables these capabilities. Display-mode detection is reactive and cannot be enabled by the launch query alone. The OpenRouter panel receives the current project, preview/busy callbacks, and validated apply callbacks. There is no TrafficOps AI proxy or server-side key.

## Workflow

1. Install the PWA in Chrome or Edge, then choose the top project selector → **Add project folder** to connect a local folder with read/write access. Studio remembers multiple folder projects and lets you switch between them. Empty folders are initialized with a starter template. Other browsers retain the ZIP workflow: start with the included example, choose **New project**, or **Open ZIP** containing `.tpl` / `.tpl.html` pages and assets. A common enclosing directory is removed automatically.
2. Use **Project files** to create files or folders, upload local files, and drag files or whole folders to a new location in the tree. Select a source file to edit it with syntax highlighting and IntelliSense. Suggestions include directives/snippets, built-in and project types, parameter paths, typed blocks and include files. Hover shows reference information; `@render` calls show argument hints. HTML tags and attributes also have completion. Use **Hide preview** to expand the code editor; **Show preview** restores the preview without losing edits. Renaming or moving files does not rewrite references; update includes and asset paths in your source.
3. **Customize** builds labeled inputs from template declarations, including nested groups, repeaters, numbers, colors and choices. Image parameters support upload, existing local assets, crop, zoom, positioning and resize. Field `aspect_ratio` and `sizes` constraints are respected. AI images use the same crop flow. Load/save a settings JSON file to use the same values with the CLI. The installed app’s **AI assistant** tab edits existing files, creates new projects or fills content. Source changes appear in the sidebar and preview as each tool operation completes; the activity log and elapsed time remain visible while the provider responds.
4. Choose a generated page and desktop/mobile preview. All `.tpl` pages with an `@layout` block are generated; files containing only declarations serve as includes.
5. Connected folder projects automatically save source changes, uploads, empty folders, moves and deletions back to disk. Customize values are stored in `.trafficops/values.json`. Studio checks changed files before overwriting them and asks you to reload if another program edited the same file. **Download landing** exports generated HTML plus unchanged assets. **Export project** downloads source, assets, empty folders and `.trafficops/values.json` so customized values survive a ZIP round trip. It does not include API keys.

Use **Format** in the source toolbar, **Format Document** in the context menu, or **Shift+Alt+F** to format the current file. TPL formatting shares the VS Code extension's standalone formatter, indents declarations and HTML with two spaces by default, and is one undoable edit. Imported files are only reformatted when you request it. Press **Ctrl+Space** to show suggestions; **Tab** accepts a snippet and moves through its placeholders. Enter automatically indents TPL blocks and HTML elements. Ordinary HTML, CSS, JavaScript and JSON files use Monaco's bundled language services. All authoring services and formatting run locally in the browser.

Creating or renaming a file, and creating a folder, suggests existing project folders as you type, including empty and nested folders. Click a suggestion or use **↑/↓**, then **Enter** or **Tab**, to complete the folder path with a trailing `/`. Continue with the new name. **Esc** hides suggestions; a second **Esc** closes the dialog. New paths can still be typed freely.

In the PWA, the last workspace (including ZIP projects, binary assets and customized values) is saved to IndexedDB after a short debounce. Folder handles and the last selected project are remembered. On restart, a granted folder opens automatically. When permission has expired, the recovery copy remains available and **Reconnect folder** requests access from a user gesture. Recovered unsaved disk changes must be exported before reloading the disk copy. The public browser demo remains a session editor: export before closing.

Browsers expose the selected directory name, not its absolute filesystem path. **Manage folders & paths** accepts an optional full path label for the project selector. This label is display metadata; it never changes the actual directory handle.

Changed files show a dot and new files show `+` in both sidebar modes. Folder indicators clear after a successful disk write; session indicators clear after **Export project**. Saving a recovery copy on the device does not mark source as exported. AI changes have a separate pending-review indicator. Navigation prompts while disk/device saves or AI review are pending.

## Installed app

The production build includes a web app manifest and an offline service worker. The installed **Landing Studio by TrafficOps** launches `/?studio=1` in standalone display mode and opens the full editor immediately. The top toolbar keeps project switching, app settings and **Download landing** accessible. The Exit control is intentionally absent in installed display mode, while external TrafficOps and documentation links open outside the app. Service-worker updates are user-triggered so they cannot reload an unsaved session.

## OpenRouter BYOK

Open the toolbar’s **Settings** page, enter an OpenRouter API key, and choose a text model with tool calling. `openrouter/auto` is the text default. Set a separate image model ID from the OpenRouter catalog to enable image generation. The connection is stored in a separate IndexedDB database, outside project folders, recovery snapshots and exports. **Remove key** deletes the connection.

- **Edit project** seeds the working copy with existing files. The agent reads text files on demand, applies exact patches or batches complete file writes, and preserves untouched files and binary assets. The prompt, field values, file manifest and source read through tools reach OpenRouter and the selected provider. Binary image contents are not sent to the text model.
- **Create new** starts a new working copy. Applying it replaces the current project, including disk deletions for a folder project. The UI explicitly states this before generation.
- **Fill content** sends field definitions, authoring instructions, current values and available image paths. It retains the template structure and validates values with the runtime.
- **Generate image with AI** sends the image brief and field description to the dedicated `POST /api/v1/images` endpoint. The returned raster image is opened locally for crop/resize and added to `images/` only after confirmation.

Text agents use streamed tool calls, a maximum of 16 steps, a five-minute timeout and no automatic retry of paid calls. Their final changes must pass the real parser and renderer after the last mutation. Editing tools limit changed source to 256 KiB per file and 1 MiB total; binary assets are retained but cannot be rewritten by text tools. Cancellation, invalid output and provider failure discard the working copy and leave the original project intact. The user can inspect live source/preview, then **Apply changes** or **Discard**. Concurrent source edits and project switches are blocked until review ends.

Text requests use `https://openrouter.ai/api/v1/chat/completions` with provider data collection disabled. Content filling prefers strict JSON schema and has a locally validated JSON fallback for unsupported endpoints. Image requests use the [dedicated Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) and the selected model’s provider policies. Requests are billed to the user’s OpenRouter account; provider latency and model support vary.

## Privacy and preview

ZIP import, parsing, generation and ZIP download happen in the browser. There is no TrafficOps API, account, analytics, upload endpoint, or remote image storage. Monaco, fonts, scripts and styles are bundled locally; no CDN is required. Ordinary site hosting still receives requests for the application itself. OpenRouter is the only optional remote workflow and runs only after the user supplies their own key and starts an AI request; the data boundary is described above.

Image controls accept relative paths, for example `images/hero.jpg`, and provide project-file selection plus a local upload/drop zone. Images are added under `images/`. **Use original** preserves original bytes for unconstrained fields; **Use image** exports the chosen crop as PNG. Output dimensions are bounded at 4096 px per side, and image decode is limited to 64 megapixels. The preview creates temporary in-memory data URLs for included images, CSS and fonts; exports preserve the original relative paths. Assets not present in the project cannot appear in the local preview.

Preview HTML runs in an iframe with an empty sandbox and a restrictive Content Security Policy. Scripts, forms, navigation, frames, external images/styles/fonts and network connections are disabled. Local CSS and image URLs are resolved relative to the selected page. Responsive `srcset` is omitted in preview (the `src` fallback is used); generated output is unchanged. This is a static layout preview, not a test environment for executable page scripts.

The JavaScript runtime deliberately supports a documented portable subset of the PHP DSL; see [runtime compatibility](../runtime/README.md). Unsupported constructs produce a visible error and disable generation.

## Import bounds

- ZIP: at most 20 MiB compressed, 32 MiB expanded, and 500 entries.
- Files: at most 8 MiB each; editable UTF-8 source: at most 2 MiB each. Generated HTML export permits the runtime’s 8 MiB per-page output budget.
- Traversal, absolute paths, hidden files/directories (except the exported `.trafficops/values.json` sidecar), control characters, ambiguous paths, duplicate entries, symlinks, encrypted files, multi-volume archives and ZIP64 are rejected.
- Metadata and local ZIP headers are checked before decompression. Import runs in a separate worker with a 15-second timeout.

Source templates have additional parser and rendering limits enforced by the shared runtime. Preview expansion has a separate 32 MiB encoded budget and a 12-level CSS import limit; exceeding these shows an error while generated ZIP download remains available. Large media projects should be reduced before import.

## Branding

The warm cream/coral palette, typography and logo derive from the original `packages/ui/resources/css/theme.css`, `BRAND_GUIDELINES.md` and TrafficOps SVG mark. Onest is bundled through `@fontsource-variable/onest`. Small button text uses dark text on coral as specified by the brand contrast guidance.

The browser adapter reuses `vscode-extension/src/language.js` in the `safe-html-v1` dialect and lazily loads `vscode-extension/src/formatter.js`. Vite bundles these private workspace modules; no VS Code application or server is required.

## Implementation references

- [Monaco ESM integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)
- [daisyUI with Vite](https://daisyui.com/docs/install/vite/)
- [fflate ZIP APIs](https://github.com/101arrowz/fflate)
