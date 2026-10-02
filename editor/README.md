# Landing Studio by TrafficOps

A static application for creating reusable TrafficOps templates and landing pages, where every project is a folder of plain files: a folder you choose on your computer (Chromium browsers) or the browser's private storage (OPFS). It includes an AI code assistant. Built with React, Vite, Monaco Editor, Tailwind CSS and daisyUI. It uses the shared `@trafficops/template-runtime` workspace, so CLI and editor generation have the same behavior.

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

`App` supplies Studio chrome and a `FolderHost` (`src/hosts/FolderHost.js`) for the
open project to `@trafficops/template-editor-shell`. The host reads and writes the
project's root directory, either a user-chosen folder or an OPFS directory, in the
folder-first format below. The same shell is mounted by the embedded entry through
`HttpHost`. Host ports and capabilities come from `@trafficops/template-editor-core`;
the shell does not own storage, compiler policy, lifecycle rules or credentials.
In standalone Studio, AI creation, editing, content filling, image generation and
BYOK settings are available in ordinary browser tabs and in the installed app alike.
Installation only changes install and update chrome. This is specific to Studio's
hosts; it does not change the embedded PWApps editor's `HttpHost` capabilities. Both
text and image requests use the user-owned AI port.

## Workflow

1. Open **Projects → New project**, choose **Landing page** or **Reusable template**, then start **From template** or **From scratch**. The home page also offers an AI chat: choose **Landing page** or **Reusable template**, describe the result, optionally attach references, and send the brief to create a project and continue its conversation. The **New project → With AI** dialog is also available. Included starters work offline after the application is cached. Your own templates appear alongside them; each template lives in its own folder, so choosing a template card asks for access to that folder in its own click, and **Create** then opens the folder picker for the new project. Using a template creates an independent copy and never modifies the source template.
   - **Where projects live.** In Chromium browsers (Chrome, Edge) every project is a folder you choose. Creation asks for the folder: an empty folder is used directly, a folder that already holds a Studio project can be opened instead (never overwritten), and a non-empty folder gets a new subfolder for the project. In browsers without the folder picker (Safari 26+, Firefox 111+) projects live in the browser's private storage (OPFS) and creation needs no picker. Studio asks the browser to keep that storage persistent and shows a backup note; export a source ZIP regularly, because clearing site data removes browser-stored projects. A browser with neither a folder picker nor OPFS (or one that blocks OPFS in private windows) shows an "update your browser" screen.
2. The library lists the folders and browser projects Studio knows, with search and template/landing filters. Each card shows **Folder** or **In this browser**. A listed folder whose permission lapsed shows **Needs permission**; opening it asks again. A folder that was moved, renamed or deleted shows **Folder unavailable** with **Reconnect** (pick the folder again; it must hold the same project) and **Remove from list**.
   - **Open folder** (Chromium) opens a folder: a Studio project is opened, a folder of plain files is adopted as a project (Studio adds `.trafficops/`), and an empty folder becomes a blank project that stays untouched until the first save.
   - **Import ZIP** always creates a new project in a new folder; it never overwrites an existing one. The archive's project ID is kept unless Studio already knows it; then the import becomes a copy with a new ID, remapped history and interrupted runs. Imported `.tpl`, `.tpl.html` or HTML projects retain assets and customized values; a common enclosing directory is removed automatically. When a destination folder must be chosen, **Import ZIP** has an explicit second button so the picker opens in the click.
   - **Duplicate** copies a project, with its history, into a new folder. If the source needs permission, a second button asks for it first.
   - **Delete** removes the project from the list; a project folder stays on disk. A project in browser storage is deleted for good, with its dialogue history.
   - **Save a copy…** (shown when an outside change conflicts or the folder is unavailable) writes the editor's unsaved state and the history to a new root.
   - In a landing editor, **Save as template** asks for a new folder first, then writes a template there with the current files and values and no history. Projects autosave.
3. Use **Project files** to create files or folders, upload local files, and drag files or whole folders to a new location in the tree. Select a source file for syntax highlighting and IntelliSense: directives, snippets, project types, parameter paths, blocks and includes. Hover shows references; `@render` calls show argument hints. Use **Hide preview** for more editing space. Moving or renaming files does not rewrite includes or asset paths.
4. **Content** builds inputs from template declarations, including groups, repeaters, numbers, colors and choices. Image fields support uploads, local assets, crop, positioning and resize, respecting `aspect_ratio` and `sizes`. Load/save settings JSON to reuse values with the CLI. **Conversations** holds independent AI dialogues. Describe your task, attach references or mention files and preview sections with **@**. Image mentions show local thumbnails in the file picker, selected references and messages. **Conversation history** opens the searchable list; the conversation scrolls independently while the composer stays in reach. The assistant selects source editing, content changes or discussion; each run keeps a separate draft for review. The installed project workspace has a single project toolbar; its help button opens the quick start guide and documentation.
5. Choose a generated page and desktop/mobile preview. All `.tpl` pages with an `@layout` block are generated; declaration-only files serve as includes. The editor preview runs the page's JavaScript, local modules, links and form handlers. Changes prepare a replacement page while the previous preview stays visible. **Refresh preview** runs the latest source again; **Pause automatic preview** keeps the current page and its interactive state while you edit.
6. **Export → Landing for hosting** exports generated HTML and assets. **Export → Editable project** retains source, assets, empty folders, values and `.trafficops/project.json` identity. Conversation history is included by default and can be excluded. Reopening a source ZIP creates a new project (see **Import ZIP**); it preserves the landing/template type. API keys are excluded. Hosting ZIPs contain no Studio sidecars.

Use **Format** in the source toolbar, **Format Document** in the context menu, or **Shift+Alt+F** to format the current file. TPL formatting shares the VS Code extension's standalone formatter, indents declarations and HTML with two spaces by default, and is one undoable edit. Imported files are only reformatted when you request it. Press **Ctrl+Space** to show suggestions; **Tab** accepts a snippet and moves through its placeholders. Enter automatically indents TPL blocks and HTML elements. Ordinary HTML, CSS, JavaScript and JSON files use Monaco's bundled language services. All authoring services and formatting run locally in the browser.

Creating or renaming a file, and creating a folder, suggests existing project folders as you type, including empty and nested folders. Click a suggestion or use **↑/↓**, then **Enter** or **Tab**, to complete the folder path with a trailing `/`. Continue with the new name. **Esc** hides suggestions; a second **Esc** closes the dialog. New paths can still be typed freely.

A project is the folder itself; there is no separate library database. Studio writes this layout (format v1):

```text
index.tpl, css/, images/, …            your files, exactly as you see them
.trafficops/project.json               identity: schema, projectId, name, kind, optional pendingAi
.trafficops/values.json                saved field values
.trafficops/conversations/<id>.json    one file per AI dialogue
.trafficops/conversations/blobs/<sha256>   attachments and file snapshots, content-addressed
.trafficops/conversation-tombstones.json   keeps dialogue revisions monotonic after a delete
```

Dialogue ids that are not simple (`a-z`, `0-9`, `_`, `-`, up to 200 characters) are stored as `~<sha256>.json`, so names stay safe on case-insensitive and Windows file systems. Other tools may edit the user files; the `.trafficops/` folder is Studio's. Folders are normalised on save, and after a partial save failure the next open rebuilds from disk.

Files autosave to the folder. Before each write Studio compares the folder with what it last saved. If a file, `project.json` or `values.json` changed outside Studio, saving stops and the editor shows a conflict instead of overwriting: **Save a copy…** keeps your unsaved edits, assets and empty folders in a new root, and **Reload saved project** discards them in favour of the folder. Dialogue files are merged per dialogue, so another window's conversations are picked up without a conflict.

If Studio loses access (permission revoked) or the folder is moved or deleted, the project pauses as **Folder unavailable** and edits stay in the editor. **Reconnect** accepts only a folder holding the same project ID and writes the pending edits; **Save a copy…** and an export remain available. Leaving an unavailable project asks for confirmation. The last project reopens on startup when its permission is still granted.

Studio keeps only a small recent-projects list in the browser (IndexedDB database `trafficops-studio-recent`: project ID, name, kind, folder handle, last opened time) so the library can find your folders; OPFS projects are listed from the browser's private directory instead. No project data lives in IndexedDB, and clearing it does not delete a folder. The OpenRouter connection is stored separately (see below).

Browsers expose a chosen folder's name, not its full path, so Studio never shows where a folder is on disk. Projects are reached from the library or the editor's project switcher: **Open folder** points Studio at a folder, and **Reconnect** at a moved one.

Changed files show a dot and new files show `+` relative to the last saved revision. Indicators clear after a successful save. AI changes have a separate pending-review indicator. Project navigation saves pending edits first. AI generation and pending drafts do not block editing, creating another dialogue or switching projects.

## Selected-block AI edits

In Studio, mark complete source elements with static labels such as
`data-block="order_form"` or `data-block="Comment"`. AI-created sections, forms and
repeated cards are instructed to include these markers. To annotate an existing
project, ask the ordinary assistant to add markers while preserving the page, then
review and apply its draft.

Enable **Select elements** above preview, then use **Choose sections** to search
and select one or more sections of the displayed page, or click blocks in the
preview. The list and preview selection stay in sync; repeated labels include
instance numbers. Choose **Edit selected** to open a scoped conversation. Click
again to remove a block; chips also provide removal, clear and parent selection.
Selection mode intercepts links and forms while scrolling remains available.
Turning it off restores page interactions and retains the assistant's scope.
Refresh, page/language changes and replacement preview documents invalidate the
selection; an outdated preview, including one retained after a pause or error,
cannot start a scoped edit.

The assistant plans a shared-template, selected-instance content or mixed edit.
Shared-template edits affect every instance of that TPL fragment. Instance content
uses the actual field/repeater path traced by the renderer, including nested
`@render` and loops; labels and DOM order are never used as field paths. A field
used outside the selection, including on another page or in a hidden condition,
cannot be changed. Select all affected blocks or use ordinary project editing.
A repeated item with hardcoded/shared content has no independent content path.
Ambiguous or unsupported requests ask for clarification before writing.

Scoped tools preserve other files, source outside selected fragments and unrelated
saved values. They allow local markup/inline styles and existing leaf values;
global CSS/JavaScript, new field declarations, repeater structure and new assets
require ordinary project editing. Attachments stay reference-only. Source edits
cannot introduce new field consumers or change loop/control bindings while a
scope is fixed. Layout changes can still move neighbouring elements. Review,
Apply/Discard, cancellation and local draft recovery retain the same scope.
Service identifiers are preview-only and never enter source or generated exports;
the authored `data-block` attributes remain ordinary HTML attributes.

## Installed app

The production build includes a web app manifest and an offline service worker. The installed **Landing Studio by TrafficOps** launches `/?studio=1` in standalone display mode, restoring the last project or showing the library. Projects open as a permanent workspace with project navigation, creation and export actions. The installed editor has no collapse control or Escape-to-collapse behavior. Installing changes only the install and update chrome: AI and folder access work the same in ordinary tabs. After the application has been cached, local editing, included starters and ZIP export work offline. AI requests require a network connection.

Studio checks for service-worker updates when connectivity or focus returns and periodically while open. **Update Studio** saves current edits before applying an update and asks before interrupting active AI runs; an update started in another window does not automatically reload this window. Storage, registration and update failures are shown in the interface.

## Content editing

The **Content** tab provides visual editors for `Wysiwyg` and `Markdown` fields.
Use the formatting toolbar for headings, emphasis, lists, quotes, links and images;
images can be selected from the project or uploaded, with alt text and WYSIWYG
captions. Markdown also offers an optional source view with a sanitized live
preview. Visual edits save HTML for WYSIWYG and Markdown source for Markdown;
project image paths stay relative in saved values and exports. Existing figures
and captions survive text edits. Opening legacy WYSIWYG values repairs plain-text
paragraphs and escaped attribute quotes. **Use template default** restores that
field's `@param` default. Saved content overrides source defaults. Templates render
both formats with `{{& field }}` inside a `div`, `article` or `section`.

## Project conversations

Each project keeps searchable dialogue history with rename, archive, restore and deletion of inactive archived dialogues. Messages and referenced file versions are saved before an AI connection starts. Each app window executes up to two assistant runs concurrently, with one run per dialogue; further requests in that dialogue become bounded clarifications. Stop targets one run. Changing tabs or projects preserves active execution and drafts.

The compact composer accepts text, image and document references and keyboard-accessible **@** file and section mentions. Typing **@** searches both; the **File** and **Section** buttons open filtered pickers with search. Section references retain their source fragment, page, language and actual instance values in history. They provide context within the chosen task scope. Refresh and reselect an outdated section reference before sending. **Files → Edit with AI** and preview block selection open a scoped conversation; file and block restrictions still apply. Optional **Tools** settings constrain the task to content or discussion. Source edits are prepared separately from canonical files, and only **Review changes → Apply to project** commits them. Previewing a draft does not change the editor or autosave it.

Applying uses the run's frozen source and language. Independent file/value changes merge into the current project; overlapping changes require continuing with the current project. Changed read context requires reviewing the updated candidate and explicitly confirming it. Final analysis and rendering run again before the versioned save. Applied-run IDs commit with project content, so a crash cannot apply a run twice. A reload marks orphaned runs interrupted, retains completed work and never repeats a paid request automatically. Continuing is explicit.

Each dialogue is its own file with its own revision; saves compare that revision, rebase a stale copy per dialogue and never overwrite another window's dialogue. Folder errors keep the history in memory and show a warning; later access retries. Runtime ownership and write serialization use Web Locks where available and an in-process FIFO mutex otherwise. The `host.conversations` port keeps these features separate from published version history. Every host with the `ai` capability must provide it (`load` and `save`; `runHostConformance` rejects AI hosts without it); hosts without AI omit it.

## OpenRouter BYOK

Open **Conversations → AI settings** (the conversation header menu), enter an OpenRouter API key, and choose a text model with tool calling. `openrouter/auto` is the text default. Set a separate image model ID from the OpenRouter catalog to enable image generation. The connection is stored in a separate IndexedDB database, outside project folders and exports. **Remove key** deletes the connection. AI settings are available in ordinary tabs and the installed app.

**New project → With AI** saves a separate project and its brief (up to 6,000 characters), then starts generation if a connection is already configured. The initial request is claimed once before calling the provider. Reloading keeps the brief (`pendingAi` in `project.json`) for a manual retry and never automatically repeats a paid run. Without a configured key, connect in the editor and start the request manually.

- **Edit project** seeds the working copy with existing files. The agent reads text files on demand, uses `edit_file` for exact replacements and `delete_file` for requested text-file deletions, writes complete files incrementally, and preserves untouched files and binary assets. The prompt, field values, file manifest and source read through tools reach OpenRouter and the selected provider. Only explicitly attached reference images are sent as image inputs; other binary assets stay local.
- **Files → Edit file with AI** opens an assistant for the selected file. Enter a prompt and optionally attach images, PDF or UTF-8 text documents. TPL, CSS, HTML, JavaScript, JSON, SVG and other stored text files use the text model; PNG, JPEG and WebP edits use the configured image model with the original image as the first reference. An independent reviewer checks the draft. Compare the original and edited file, then **Apply changes** or **Discard**. Applying replaces only that file, retaining its path and raster format, all other project files and saved field values. Cancellation or failure preserves the original. The selected file and supplied references reach OpenRouter and the provider; attachments stay out of project exports. Image planning and review require a text model that accepts images. Text files are limited to 64 KiB of input and 200 KiB of edited output; raster inputs are limited to 8 MiB and 4096 pixels per side. References support four files, 12 MiB total, with 4 MiB per image/PDF and 256 KiB per text document. Reference images are also bounded to 4096 pixels per side and 16 megapixels. Supported text references are TXT, MD, CSV, TSV, JSON and HTML; Office documents must first be exported as PDF or text.
- **Create new** inside the assistant starts a replacement working copy for the current project, including file deletions in the project folder when applied. A confirmation explains this before generation. Use the library's **New project** flow to create a separate project.
- **Fill content** updates declared fields in small streamed tool calls, retaining template source and validating field types, repeaters and local image paths. It supports long articles and generated illustrations inside rich text or Markdown as well as Image fields. A response without changes gets one announced request for actual field updates within the existing step/time budget; a second empty response stops. Output token exhaustion is reported separately without a blind retry. New fields, sections or additional fixed review slots require **Edit project**.
- **Generate image with AI** sends the image brief and field description to the dedicated `POST /api/v1/images` endpoint. The returned raster image is opened locally for crop/resize and added to `images/` only after confirmation.

Change-producing assistant workflows run **Plan → Generate → Review → Revise**; discussions return an answer without a draft. The planner and reviewer use independent conversations with the selected text model. Reviewer findings return to the writer for up to two repair passes, followed by another review. The result is ready only after a successful review and host validation; unresolved findings remain in a draft marked as needing attention.

Use **Attach images** in the assistant or **New project → With AI** for website screenshots, design references or photos. You can also paste an image from the clipboard into the prompt with **Ctrl+V** or **⌘V**, including in **Edit file with AI**. Pasted images appear in the reference list and follow the same validation as uploaded files; ordinary text pastes into the prompt as usual. PNG, JPEG and WebP are supported: up to four references, 4 MiB each and 12 MiB total. The selected text model must support image input. References reach the planner, writer and reviewer as image inputs. **Use attached images on the page** additionally makes the attached photos available as local project assets; reference-only screenshots stay out of source and landing ZIPs. New-project briefs retain their references in the local library without repeating generation on reload.

After an image model is configured, **Generate images requested in the brief** is selected by default for AI creation and editing. The default is resolved from the current connection at the start of each run, including direct workflow calls; an explicit opt-out is preserved across mode changes and the creation handoff. Image-enabled plans must explicitly list the requested raster images (or an empty list for text/vector-only work); a missing list triggers one schema correction and then stops before writing if still invalid. The prompt determines whether new images are needed and how many: the writer generates only requested photos or raster art, without a fixed image-count cap, through the selected model's [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation). Requested raster art cannot be completed with an SVG/CSS/text placeholder; the review receives evidence of successful image-provider assets, and planned images must exist and be referenced from source or values. SVG icons, logos and explicitly requested vector artwork remain supported. Generated images and marked page photos stay in the review draft until **Apply changes**, which commits files and content together. **Discard** or cancellation keeps the original project.

Creating an AI project before connecting an image model leaves the choice automatic. Connecting the model later in the editor enables requested image generation; the initial missing connection is never saved as an opt-out.

Source agents use streamed tool calls, a maximum of 16 steps per writer pass (12 for content), a shared fifteen-minute run budget with five minutes per provider call, and no SDK retries. Each provider request gets up to three announced retries for transient 408/429/5xx or network failures before any output starts. Retries respect Retry-After and the run time budget but do not spend model steps or call limits; a run-wide pool of three retries per allowed call bounds a provider that keeps failing. Authentication, payment, permission and moderation failures are never retried. An upstream idle timeout can instead resume a retained source draft with compact individual file writes, using that same recovery allowance. Their final changes must pass the real parser and renderer after the last mutation. Editing tools limit changed source to 256 KiB per file and 1 MiB total; binary assets are retained but cannot be rewritten by text tools. Stopping generation retains completed work as an unapproved draft; discarding restores the saved project. Validation failures are returned to the model for repair within the run budget, with the last three steps reserved for checks and corrections. Completed writes survive invalid output, provider failures and timeouts as a draft marked as needing attention. Users can continue from that draft in a new run; unfinished file strings are never retained, while strictly complete file objects from an interrupted batch can be recovered after normal path/type/size checks. Independent file tools are enabled in the same response, reducing provider round trips, while validation runs after mutations. During generation or review the user can send up to eight clarifications, each at most 6,000 characters, without cancelling. They reach the next provider step, even if the previous step ended in a final summary, and require validation again within the same run budget. The user can inspect live source/preview, then **Apply changes** or **Discard**. Legacy embedded assistants can still lock source edits during their draft flow; installed Studio conversations keep canonical editing and project switches available.

Completed AI drafts are kept with the dialogue in `.trafficops/conversations/` and recover after reload without restarting generation. Recovery preserves accepted files, image bytes, the full brief and user clarifications separately from the saved project. Older-revision drafts remain separate and can be downloaded or discarded. Storage errors show a source ZIP backup action. A creation brief that has not started yet is stored as `pendingAi` in `.trafficops/project.json`, together with the new project; it is claimed once, so a reload never repeats a paid run. A malformed brief is dropped with a warning instead of blocking the project.

Source edits use `set_values` for saved content: changing a `@param` default alone does not override existing saved values. Successful final validation proceeds directly to independent review without another summary-only provider request. Content updates are serialized and batched by logical sections; planning and Fill Content stages receive field schemas, values and file metadata instead of full source. Requests requiring source edits are reported as needing **Edit project** rather than silently reducing the brief. Review uses the actual updated schema and draft.

**Run diagnostics** exports stage timings, selected models, request sizes, usage, status codes, provider names and generation IDs. It excludes keys, prompts, source, values, attachment bodies and freeform provider messages. Detailed provider error explanations remain visible in the panel. Terminal image failures stop repeated generation attempts across revision passes while preserving successful assets and content.

Tool continuations preserve the ordered reasoning blocks and signatures returned by the provider, including distinct signed blocks with identical text. A request-local compatibility layer contains the OpenRouter SDK's adjacent-block merge and history deduplication behavior without changing SSE bytes or adding model requests. Reasoning content and signatures never enter exported diagnostics.

Text runs using `google/gemini-3.8-flash` request its supported `low` reasoning effort instead of its default `medium`, reducing deliberation during tool workflows. Other model IDs and image requests retain their provider defaults. Actual latency remains provider-dependent.

Text requests use `https://openrouter.ai/api/v1/chat/completions` with provider data collection disabled and strict parameter routing. Sampling parameters such as temperature are omitted so reasoning models can participate. Planner and reviewer stages expose a single tool with automatic tool selection, supporting providers that cannot force a named function; only a schema-valid tool submission completes either stage. All draft content is validated locally. Image requests use the [dedicated Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) and the selected model’s provider policies. Requests are billed to the user’s OpenRouter account; provider latency and model support vary.

## Privacy and preview

ZIP import, parsing, generation and ZIP download happen in the browser. There is no TrafficOps API, account, analytics, upload endpoint, or remote image storage. Monaco, fonts, scripts and styles are bundled locally; no CDN is required. Ordinary site hosting still receives requests for the application itself. The application's optional OpenRouter workflow runs only after the user supplies their own key and starts an AI request; the data boundary is described above. Authored preview pages can independently load HTTPS resources, call APIs and submit forms to their configured HTTPS destinations.

Image controls accept relative paths, for example `images/hero.jpg`, and provide project-file selection plus a local upload/drop zone. Images are added under `images/`. **Use original** preserves original bytes for unconstrained fields; **Use image** exports the chosen crop as PNG. Output dimensions are bounded at 4096 px per side, and image decode is limited to 64 megapixels. The editor preview creates temporary in-memory blob URLs inside its isolated frame for included images, CSS, fonts and JavaScript; exports preserve the original relative paths. Missing local assets cannot appear in preview.

Editor preview HTML runs in an iframe with `sandbox="allow-scripts allow-forms"`, without `allow-same-origin`, top navigation or popup permissions. Its opaque origin cannot read the Studio document, library, saved directory handles or OpenRouter settings. The local runner receives only a generated project snapshot and sends a readiness notification; it has no API for parent storage or privileged requests. Its CSP blocks nested frames, objects and workers. Library thumbnails continue to use the static renderer with scripts disabled.

Inline and classic scripts, local ES modules (including static, dynamic and cyclic imports), import maps, local JSON/assets through `fetch`, and multipage links work offline. JavaScript module paths, `import.meta.url`, ordinary `location` navigation and project resource URLs are adapted to the local snapshot. A page change or refresh creates a new JavaScript document. Remote HTTPS scripts and APIs still require connectivity and the remote server's normal CORS rules; preview fetches omit credentials by default. Local resources support read-only GET/HEAD requests, and local GET forms navigate between generated pages. PHP, backend handlers and local POST processing are not provided by the browser preview. Exported source and generated files are unchanged.

The JavaScript runtime deliberately supports a documented portable subset of the PHP DSL; see [runtime compatibility](../runtime/README.md). Unsupported constructs produce a visible error and disable generation.

## Import bounds

- User files: at most 32 MiB expanded and 500 entries outside `.trafficops/`. Files: at most 8 MiB each; editable UTF-8 source: at most 2 MiB each. Generated HTML export permits the runtime’s 8 MiB per-page output budget. JSON field values are bounded to 2 MiB.
- ZIP: at most 20 MiB compressed without history, and at most 512 MiB with conversation history (`.trafficops/conversations/`). Hosting, template and server-side imports keep the 20 MiB limit.
- History caps: 100 dialogues per project, 10 000 blobs per archive, 16 MiB per dialogue file and 24 MiB per blob. Limits are checked before any blob is read; Studio packs and unpacks history ZIPs in a worker. Browser storage quota or disk space still applies.
- Traversal, absolute paths, hidden files/directories (except `.trafficops/project.json`, `.trafficops/values.json`, well-formed history entries under `.trafficops/conversations/`, and `.trafficops/conversation-tombstones.json`, which is accepted from a zipped project folder and ignored), control characters, ambiguous paths, duplicate entries, symlinks, encrypted files, multi-volume archives and ZIP64 are rejected.
- Metadata and local ZIP headers are checked before decompression. Import runs in a separate worker with a timeout that scales with the archive: 15 seconds, or 1 second per 2 MiB when that is longer.

Source templates have additional parser and rendering limits enforced by the shared runtime. Interactive preview snapshots have a 32 MiB project budget. Static library thumbnails additionally bound encoded asset expansion to 32 MiB and CSS imports to 12 levels. Exceeding a preview budget shows an error while generated ZIP download remains available. Large media projects should be reduced before import.

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
`@trafficops/template-editor-core`. `src/hosts/FolderHost.js` adapts a project root
(a chosen folder or OPFS directory) through `src/storage/*` (roots, project-root, files,
write, project-meta, locks, recent registry and the directory conversation store);
`src/folder-choice.js` runs the picker and folder questions. `embedded/src/HttpHost.js` adapts the existing PWApps protocol.
`npm run check` checks the host implementations against `contract.d.ts`, including
AI transport/settings and optional ports. The conformance suite uses disposable
folder handles and a fetch-level protocol mock, plus a third trusted-dialect host.

The embedded mount accepts `initialAiRequest: { id, prompt, mode: 'create', autoStart: true }`
for a newly created page. The assistant opens with that prompt and claims it through
`POST {endpoint}/ai-kickoff` (`requestId`, `revision`) before beginning the team's AI
run. The host returns `{ started: true }` only once. Reloads can pass the same prompt
with `autoStart: false` and `mode: 'edit'` for manual recovery. The server owns request
identity and project access; client settings do not authorize a paid run by themselves.

### Embedded conversation history (embed 0.7.0)

The embedded editor stores AI chat history on the host. `HttpHost` enables AI only when
the `GET {endpoint}` payload has both `aiEnabled: true` and `conversationsEnabled: true`.
It then provides `host.conversations` through `embedded/src/http-conversation-store.js`
(project key `embed:<endpoint path>`), so the embed uses the same conversation chat as
Studio. Without `conversationsEnabled: true`, the embed has no AI capability: no chat, no
`ai` port and `availability.ai: false`. Chat portals (mention menus, dialogs) mount
inside the editor's shadow root through `StudioUiProvider`'s `portalContainer`.

Paths are relative to `endpoint`. Every request carries `X-CSRF-TOKEN` and
`credentials: 'same-origin'`, like the other editor calls.

| Method and path | Request | Success response | Errors |
|---|---|---|---|
| `GET /conversations` | — | `200 { "threads": Thread[] }`: every stored thread, each with its current server `revision` | — |
| `PUT /conversations/{id}` | `Content-Type: application/json`, `If-Match: "<revision>"`, body: one `Thread` | `200 { "revision": <new revision> }` | `409` revision mismatch, `413` thread too large, `422` invalid thread or missing blob, `428` (recommended) `If-Match` missing |
| `DELETE /conversations/{id}` | `If-Match: "<revision>"` | `204`, also when the thread is already missing (`404` is accepted too) | `409` revision mismatch, `428` (recommended) `If-Match` missing |
| `PUT /conversation-blobs/{sha256}` | `Content-Type: application/octet-stream`, raw bytes | `201` created or `200` already stored | `413` blob too large, `422` hash mismatch |
| `GET /conversation-blobs/{sha256}` | `Accept: application/octet-stream` | `200` raw bytes | `404` unknown blob |

- **Revisions.** `If-Match` holds the decimal revision in double quotes (an entity tag),
  for example `If-Match: "3"`. `"0"` means "create": it succeeds only when the thread does
  not exist. A write succeeds only when the stored revision equals the `If-Match` value; the
  server then assigns the next revision and returns it. The `revision` field in the request
  body is ignored. Revisions should stay monotonic across delete and recreate (keep the
  last revision of a deleted id, and continue from it), so a stale client can never match a
  recreated thread. A request without `If-Match` should be rejected with `428`.
- **Identifiers.** Thread ids match `^[A-Za-z0-9_-]{1,160}$`, and the id in the path must
  equal the body's `id`. Blob names are SHA-256 digests as 64 lowercase hex digits. The
  server checks that the SHA-256 of the uploaded body equals the path and answers `422`
  otherwise. Clients also verify downloaded blobs.
- **Threads and blobs.** A `Thread` is a split dialogue file (`schema: 1`, `id`,
  `revision`, `title`, `updatedAt`, `messages`, `runs`). Large values (file snapshots,
  attachments) are replaced inside the thread JSON by blob references
  `{ "$trafficopsBlob": "<sha256>", "encoding": "utf8" | "bytes" | "dataUrl", "size": <bytes>, "mime"?: "<type>" }`
  (`mime` is present for `dataUrl`). The server can find every referenced blob by walking
  the JSON for objects with a `$trafficopsBlob` key. It must answer `422` to a thread that
  references a blob it does not have. The client uploads blobs before the thread, and after
  a `422` it uploads all of the thread's blobs once more and retries.
- **Limits.** A thread body is at most 16 MiB, and one blob is at most 24 MiB. Larger
  requests get `413` with a `message`. The web server and PHP must accept these bodies,
  for example `client_max_body_size 25m` in nginx and `post_max_size` /
  `upload_max_filesize` of at least 25M in PHP. Otherwise the proxy returns its own `413`.
- **Status mapping in the embed.** `409` becomes a `ConflictError`: the runtime reloads
  and retries the change. `422` becomes a `ValidationError`. `413` shows the server's
  `message`, or "The dialogue exceeds the server limit.". `404` on a blob download shows
  "A conversation attachment is missing on the server.". Other statuses show the
  server's `message`. Error bodies are JSON `{ "message": "..." }`.
- **Garbage collection is the host's job.** The embed never deletes blobs. A host may
  remove blobs that no stored thread references, after a grace period that covers uploads
  whose thread write is still in flight (the reference stores use 10 minutes).
- There is no change feed. Other tabs see new history after they reload.

`editor/test/support/conversation-endpoints.js` is a reference implementation of these
endpoints over `createMemoryConversationStore()`. It is used by the protocol mock and
by `creation-browser.mjs`.

**Upgrading PWApps.** Embed 0.7.0 no longer keeps dialogues in the browser's IndexedDB,
and earlier embedded dialogues are not migrated. A host that installs 0.7.0 without these
endpoints and without `conversationsEnabled: true` loses AI in the editor: the chat is
hidden. If such a host passes `initialAiRequest`, the request is dropped and the console
logs `TrafficOps editor: AI is disabled because the host does not expose conversation
endpoints (conversationsEnabled).` Stay on 0.6.x until the endpoints ship, then set
`conversationsEnabled: true` in the project payload.

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
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/conversations-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/conversation-ui-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/home-chat-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/project-folder-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/file-ai-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/block-ai-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/primitives-browser.mjs .
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/preview-block-selection-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/fill-content-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/optiheart-ai-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/folder-access-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/studio-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/storage-access-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/storage-contract-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/agent-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/ai-panel-ui-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/branches-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/clipboard-images-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/rich-text-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/openrouter-settings-browser.mjs editor/dist
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/retained-draft-settings-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/autosave-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/interactive-preview-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/interactive-preview-security-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node editor/test/interactive-editor-browser.mjs
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
and rollback on cancellation or provider failure after tool input starts without replaying writes.

The OptiHeart browser check runs the complete reported Polish prelanding brief
against a synthetic persisted Russian project, with every OpenRouter URL
intercepted. It verifies source edits and actual saved field values together,
three video placeholders, independent review, Apply/autosave/reload, private
diagnostic downloads and the rendered page at 390px and 1280px. It never opens
the user's installed app or spends OpenRouter credits.

An optional standalone AI harness defaults to the same free synthetic workflow:

```sh
node editor/test/ai-live-check.mjs --dry-run --mode edit --out /tmp/studio-ai-check
node editor/test/ai-live-check.mjs --dry-run --fail-planner-once --out /tmp/studio-ai-retry-check
```

It writes `report.json`, `values.json`, `source/` and `rendered/` under the specified
temporary directory. Reports identify the fixture as synthetic and contain
request timings, byte counts, model/tool metadata, returned token usage, cost,
generation IDs and normalized provider errors. They exclude API keys, request
headers and provider request/response bodies. The project artifacts are separate
and intentionally contain the generated page. Synthetic runs prove integration
behavior; they do not verify that a live provider can complete the brief.

Real-provider verification is a separate manual opt-in that uses paid credits.
Only run it after the user explicitly authorizes those requests. Set
`STUDIO_OPENROUTER_TEST_KEY` securely in the environment, then provide `--live`:

```sh
node editor/test/ai-live-check.mjs --live --model xiaomi/mimo-v2.6-flash --mode edit --max-calls 12 --max-cost 0.25 --timeout-ms 300000 --out /tmp/studio-ai-live-check
```

`--fixture` accepts an exported project JSON with `files` and `values` or
`settings`, without connection settings. Binary files may be numeric arrays or
objects with a `base64` property. The harness invokes the production workflow
and host validator, then independently renders the draft and checks structural
requirements and local assets. The POST count and whole-run timeout are hard
limits. The cost limit prevents later calls once returned usage reaches the
threshold; unavailable cost remains unknown, and one call can cross that
threshold. Inspect the rendered mobile layout and factual sources as well as
the automated checks before accepting a live result.

The storage access check (`storage-access-browser.mjs`) verifies that AI and project folders are offered in ordinary tabs, that a browser without the folder picker stores projects in OPFS, that one without OPFS shows the unsupported screen, and that a stored AI key never makes a provider call without a request.

The library browser check covers creation, template copies, saved fields,
duplication/deletion, source ZIP export, mobile layout and offline editing after
a real service-worker reload, using an isolated browser profile.

The autosave browser check exercises pending-save navigation and failed-save
recovery with a disposable host. It does not use production projects or credentials.

The folder access check (`folder-access-browser.mjs`) uses real OPFS folders to exercise outside changes (conflict without overwriting), Save a copy…, Reload saved project, revoked access, a moved folder and Reconnect. `storage-contract-browser.mjs` runs the storage contract against real OPFS.
