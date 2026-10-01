# Browser-local interactive preview

`buildInteractivePreview(files, page)` accepts the generated file map, including assets, and returns `{ html, sandbox, readyToken, dispose }`. Mount `html` as `srcdoc` in an iframe with exactly `allow-scripts allow-forms`; never add `allow-same-origin`. Refresh by creating a new descriptor and iframe from the latest generated files. The builder creates no object URLs in the Studio origin, so its `dispose` is intentionally empty.

`module-source.js` uses Acorn to rewrite import specifiers, dynamic imports, `import.meta.url` and ordinary global `location` references. Imported modules use stable project URLs. Original file bytes remain available to `fetch` and exports; transformed code is used only for execution in preview.

`runtime.js` is a self-contained function serialized into the iframe. It allocates all blob URLs inside the opaque document, creates an import map for local module dependencies and aliases, resolves CSS and media paths, and adapts local fetches to read-only snapshot responses. Navigation creates a fresh blob document containing the same snapshot. The runner needs neither a project server nor a service-worker registration, so installed and ordinary browser modes work offline with the same local files.

The browser sandbox and CSP are the security boundary. URL/fetch/navigation adapters provide project compatibility; author code may replace them without gaining parent access. The snapshot must contain only generated project files, never host state, AI connection settings, filesystem handles or a parent request broker. HTTPS resources, CORS requests and form destinations are allowed; nested frames, workers, objects, popups and top navigation remain unavailable. Local POST handlers are not emulated.

After the rendered document's `load` event and two animation frames, the runner sends `{ type: 'trafficops-preview-ready', token: readyToken }` to its parent. The shell must accept it only from the exact pending iframe window with the matching token, and use it only to reveal that prepared frame. It must never grant authority based on this signal. Arbitrary application background work started after page load is outside this readiness boundary.

Run the module-preparation tests with `node --test editor/test/interactive-preview.test.js`. The browser functional check bundles the runtime with production minification and verifies execution, local modules/assets/fetch, offline navigation and latest-source refresh. The separate security browser check exercises the actual shared preview component.

## Selection bridge

`buildInteractivePreview(files, page, { selection: { pages } })` optionally enables
selection. Each page contains only `{ id, label, ancestorIds }` display descriptors;
source ranges, saved values and host credentials remain in the parent. The builder
returns an optional `{ version: 1, token }` selection descriptor. Every navigated
document creates its own `documentToken` and announces its logical page.

The parent sends `trafficops-preview-selection-control`; the iframe sends
`trafficops-preview-selection-ready` and `trafficops-preview-selection-change`.
All messages include protocol version, preview token and document token. The shell
accepts changes only from its displayed iframe window/current document and resolves
IDs against its source snapshot. Capture handlers install before author scripts;
highlights live in a separate shadow overlay. Disable selection to restore page
interaction. This bridge grants no storage, filesystem or provider authority and
does not change the iframe sandbox or CSP.
