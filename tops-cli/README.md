# TrafficOps CLI

Generate static websites and publish template repositories for Landing Studio. The CLI uses Commander.js for commands and Ink for a form built from each template's schema. Node.js 22 or newer is required.

```sh
npx @trafficops/cli --template ./my-template --output ./generated
npx @trafficops/cli --template ./my-template --data ./values.json --output ./generated

npm install -g @trafficops/cli
tops --template ./my-template/index.tpl --data ./values.json
```

Without `--data`, the terminal form walks through text, number/range, boolean, select, image-path, rich-text, nested group and repeater fields. Use arrows for choices, Space to toggle booleans, Enter to advance, Ctrl+U to clear, Ctrl+B to go back, and Esc to cancel. Repeater item counts determine the following item forms. Type `\n` for multiline content. Required values and constraints are checked before generation.

With `--data`, generation is fully noninteractive and works in scripts or CI. Omitted fields use defaults. JSON numbers and booleans must have their actual JSON types, and unknown field names are rejected. Example:

```json
{
  "title": "A new campaign",
  "accent": "#7c3aed",
  "showCards": true,
  "cards": [{ "title": "Start here", "body": "Tell your story." }]
}
```

| Option | Purpose |
| --- | --- |
| `-t, --template <path>` | Required `.tpl`/`.tpl.html` file or directory. |
| `-d, --data <json>` | JSON setting values; bypass the form. |
| `-o, --output <directory>` | Output directory, default `./generated`. |
| `--context <json>` | Optional safe runtime context containing query, locale and actions. |
| `-f, --force` | Replace generated files that already exist. |
| `--help`, `--version` | Show usage or package version. |

Directory mode generates all entry pages and copies non-template assets unchanged. Keep configuration/secrets outside the project directory. Hidden files/directories, `node_modules` and `vendor` are omitted, and symlinks are rejected. File mode reads only that file and its include graph; use directory mode to copy CSS, images and other assets. Relative image paths stay as written, with no upload, download or image processing.

Source suffixes `.tpl` and `.tpl.html` become `.html`; included fragments do not become standalone pages. Shared field definitions are available across pages. The output directory must be outside a source project directory. Existing generated paths require `--force`, symlink destinations are rejected, and all destinations are checked before any file is written. Force replaces only generated files and preserves unrelated output files.

Runtime context example:

```json
{
  "locale": "en-GB",
  "query": { "campaign": "summer" },
  "actions": { "submit": "/submit" }
}
```

The [runtime compatibility documentation](https://github.com/trafficops-io/tops-templates/tree/main/runtime) describes supported syntax and intentional limits. In particular, HTML/Markdown formatted values are sanitized; values are never evaluated as code or rescanned for template directives. The PHP engine remains authoritative for host-specific dialects and serialized JSON definitions.

## Template repositories

A repository is a folder you maintain locally, then bundle into static files for hosting. These commands use flags and work without an interactive terminal, including in CI. `tops repository` is an alias for `tops repo`.

```sh
# Create the source repository.
tops repo init ./team-templates \
  --name "Acme landing templates" \
  --description "Approved campaign pages" \
  --author "Acme Creative" \
  --homepage https://example.com/design

# Copy a template and its assets into the repository.
tops repo add ./team-templates \
  --path ./campaign \
  --name "Summer launch" \
  --id summer-launch \
  --description "Product campaign with benefits and a signup form" \
  --version 1.0.0 \
  --thumbnail ./campaign-preview.png \
  --data ./values.json

# Produce a ready-to-host directory.
tops repo bundle ./team-templates
```

The directory argument defaults to the current directory for all three commands. Relative flag paths, such as `--path`, `--data`, `--thumbnail`, and `--output`, are resolved from your current working directory.

| Command | Options |
| --- | --- |
| `repo init [directory]` | Required `--name`; optional `--description`, `--author`, `--homepage`. Creates `repository.json` and `templates/`. |
| `repo add [directory]` | Required `--path` and `--name`; optional `--id`, `--description`, `--version`, `--thumbnail`, `--data`. Copies the template into `templates/<id>/` and adds its catalog entry. |
| `repo bundle [directory]` | Optional `-o, --output` (default `<repository>/dist`) and `-f, --force`. Publishes the catalog, source ZIPs, previews, thumbnails and hosting headers. |

`--id` defaults to a slug derived from the template name and must be unique within the repository. `--version` defaults to `1.0.0`. `--thumbnail` accepts a local image or an HTTP(S) image URL; a local image is copied into the repository. `--data` accepts JSON field values used by the preview and included in the editable template package. Imported `.trafficops/values.json` values are retained; `--data` overrides matching top-level fields. Other omitted fields use template defaults. Use a project directory for `--path` to include all assets; a single `.tpl` file includes only its include graph.

Adding a template makes an independent snapshot: subsequent edits to the original `--path` do not change the repository. Edit the files in `templates/<id>/` and the catalog metadata in `repository.json`, then bundle again. Source metadata is for authoring; the generated `dist/index.json` is the URL to share with Studio users.

A bundle contains:

- `index.json` with repository and template metadata and portable relative links;
- one source ZIP per template, with its SHA-256 digest recorded in the index;
- rendered preview pages with their local assets;
- copied local thumbnails and headers for static hosting.

An existing output directory, even when empty, requires `--force` to rebuild. Force replaces generated files and preserves unrelated output files. Keep the output separate from template source folders. For a different destination:

```sh
tops repo bundle ./team-templates --output ./public/templates --force
```

Upload the **contents** of the output directory to an HTTPS static host, then add its `index.json` URL under **Landing Studio → Settings → Template repositories**. No server runtime or Studio rebuild is required. Cross-origin index and ZIP requests must allow `Access-Control-Allow-Origin: *` (or the Studio origin). The generated `_headers` file configures compatible hosts such as Netlify; other servers need equivalent header configuration.

GitHub raw-content URLs work for indexes, ZIPs and thumbnail images. Use the raw URL of the generated index, rather than GitHub's HTML file viewer. Raw hosts do not render HTML preview pages as a website; publish the previews on a static web host or use thumbnail images. See the [repository format and hosting guide](https://github.com/trafficops-io/tops-templates/blob/main/editor/TEMPLATE-REPOSITORIES.md) for URL resolution, CORS and browser import limits.

## Develop and verify

From the repository root:

```sh
npm ci
npm run build:cli
node tops-cli/dist/cli.js --template examples/campaign --data examples/campaign-data.json --output generated
npm test --workspace=@trafficops/cli
npm run test:pack --workspace=@trafficops/cli
```

`test:pack` packs the real npm artifact, installs it in an isolated temporary consumer and runs version, page-generation and repository init/add/bundle checks, including the resulting ZIP and preview. The CLI bundle includes the private runtime source; published packages have no dependency on a workspace path. Commander, Ink, React, Marked, sanitize-html and fflate remain ordinary public npm dependencies. `tops` and `trafficops` are equivalent executable names.

To verify a CLI bundle in Landing Studio with isolated browser storage (Playwright and Chrome required):

```sh
npm run build:editor
node tops-cli/test/repository-browser.mjs editor/dist
```

This check creates a repository with the built CLI, relocates the bundle to a separate local static server, then adds it in Studio and creates a project with its saved values and assets.
