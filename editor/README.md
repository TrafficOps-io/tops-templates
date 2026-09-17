# TrafficOps Template Studio

A static browser application for authoring TrafficOps templates and downloading generated pages. Built with React, Vite, Monaco Editor, Tailwind CSS and daisyUI. It uses the shared `@trafficops/template-runtime` workspace, so CLI and editor generation have the same behavior.

## Run

From the monorepo root, with Node.js 22 or later:

```sh
npm ci
npm run dev --workspace @trafficops/template-editor
npm run test --workspace @trafficops/template-editor
npm run build --workspace @trafficops/template-editor
```

Vite writes the deployable static site to `editor/dist`. The root Netlify configuration handles deployment. The editor package is private and is not published to npm.

## Workflow

1. Start with the included example, choose **New project**, or **Open ZIP** containing `.tpl` / `.tpl.html` pages and assets. A common enclosing directory is removed automatically.
2. Select a file and edit it in **Source code**. Create files with paths such as `blocks/header.tpl` or `pages/about.tpl`. Renaming does not rewrite references; update includes and asset paths in your source.
3. **Customize** builds labeled inputs from template declarations, including nested groups, repeaters, numbers, colors, choices and relative image paths. Load/save a settings JSON file to use the same values with the CLI.
4. Choose a generated page and desktop/mobile preview. All `.tpl` pages with an `@layout` block are generated; files containing only declarations serve as includes.
5. **Download pages** exports generated HTML plus unchanged assets. **Save template ZIP** exports the editable source project. Save settings separately with **Save JSON**.

Changes live in memory. Download source and settings before closing; there is no automatic cloud or local-storage persistence. Browser navigation prompts when there are unsaved changes.

## Privacy and preview

ZIP import, parsing, generation and ZIP download happen in the browser. There is no API, account, analytics, upload endpoint, or remote image storage. Monaco, fonts, scripts and styles are bundled locally; no CDN is required. Ordinary site hosting still receives requests for the application itself.

Image controls accept relative paths, for example `images/hero.jpg`. Existing image files remain byte-for-byte in the archive. The preview creates temporary in-memory data URLs for included images, CSS and fonts; exports preserve the original relative paths. Assets not present in the project cannot appear in the local preview.

Preview HTML runs in an iframe with an empty sandbox and a restrictive Content Security Policy. Scripts, forms, navigation, frames, external images/styles/fonts and network connections are disabled. Local CSS and image URLs are resolved relative to the selected page. Responsive `srcset` is omitted in preview (the `src` fallback is used); generated output is unchanged. This is a static layout preview, not a test environment for executable page scripts.

The JavaScript runtime deliberately supports a documented portable subset of the PHP DSL; see [runtime compatibility](../runtime/README.md). Unsupported constructs produce a visible error and disable generation.

## Import bounds

- ZIP: at most 20 MiB compressed, 32 MiB expanded, and 500 entries.
- Files: at most 8 MiB each; editable UTF-8 source: at most 2 MiB each. Generated HTML export permits the runtime’s 8 MiB per-page output budget.
- Traversal, absolute paths, hidden files/directories, control characters, ambiguous paths, duplicate entries, symlinks, encrypted files, multi-volume archives and ZIP64 are rejected.
- Metadata and local ZIP headers are checked before decompression. Import runs in a separate worker with a 15-second timeout.

Source templates have additional parser and rendering limits enforced by the shared runtime. Preview expansion has a separate 32 MiB encoded budget and a 12-level CSS import limit; exceeding these shows an error while generated ZIP download remains available. Large media projects should be reduced before import.

## Branding

The warm cream/coral palette, typography and logo derive from the original `packages/ui/resources/css/theme.css`, `BRAND_GUIDELINES.md` and TrafficOps SVG mark. Onest is bundled through `@fontsource-variable/onest`. Small button text uses dark text on coral as specified by the brand contrast guidance.

## Implementation references

- [Monaco ESM integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)
- [daisyUI with Vite](https://daisyui.com/docs/install/vite/)
- [fflate ZIP APIs](https://github.com/101arrowz/fflate)
