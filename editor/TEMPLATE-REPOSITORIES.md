# Template repositories

In **Settings → Template repositories**, add the direct URL of an `index.json`.
Studio lists its templates under the repository name in **Templates** and in
**New project → From template**. The same catalog works in a browser tab and in
the installed PWA. There is no registry server or account requirement.

Repositories are preferences shared by all projects in the current browser profile.
Share an index URL with teammates; each teammate adds it once. They are not written
into individual project folders or included in project ZIP exports.

## Index format (v1)

```json
{
  "schemaVersion": 1,
  "repository": {
    "name": "Acme landing templates",
    "description": "Our team's approved campaign pages.",
    "author": "Acme Creative",
    "homepage": "https://example.com/design"
  },
  "templates": [
    {
      "id": "product-launch",
      "name": "Product launch",
      "description": "A product page with benefits and an order form.",
      "version": "1.0.0",
      "preview": "previews/product-launch/index.html",
      "thumbnail": "thumbnails/product-launch.png",
      "archive": "archives/product-launch-1.0.0.zip"
    }
  ]
}
```

Required fields: `schemaVersion: 1`, `repository.name`, the `templates` array,
and each template's `id`, `name`, `archive`. All other fields shown are optional.
`author` is a display string. `preview` links to a rendered demo page; `thumbnail`
links to an image. Without a thumbnail, Studio tries a sandboxed iframe of the
preview. Without either, it shows a placeholder. A **Preview** link opens the
demo separately when a host prohibits embedding.

An optional `sha256` is the 64-character hexadecimal SHA-256 digest of the exact ZIP
bytes. Studio verifies it before opening the archive. Use `shasum -a 256 file.zip`
or equivalent when publishing. IDs are unique within the repository: 1–80 ASCII
letters, digits, dots, underscores or hyphens, starting with a letter or digit.
The same ID may appear in different repositories. Names have a 160-character limit,
descriptions 2,000, and version labels 80. `version` is an opaque label; v1 offers
one current entry per ID, not a version resolver. Unsupported schema versions and
invalid entries reject the entire update and leave the last good catalog available.

All URLs can be absolute HTTP(S) URLs or relative to the **index file**, including
its directory after a redirect. Credentials in URLs and non-HTTP(S) protocols are
rejected. Use versioned archive URLs and/or `sha256` when updating a template so its
offline cache cannot be mistaken for a newer release. The index may contain up to
500 templates and must be UTF-8 JSON of at most 1 MiB. A browser can save up to 50
repositories, subject to its storage quota.

## Hosting

Publish the index, archives and previews on any static or HTTP(S) host: Netlify,
GitHub Pages, object storage, your own web server, or a GitHub repository accessed
through `raw.githubusercontent.com`. Paste a raw file URL, not GitHub's HTML file
viewer. Relative paths in a raw index resolve within that repository and branch.

Studio fetches indexes and archives directly from the browser, without cookies,
authorization headers or a proxy. Cross-origin hosts must allow these GET requests
with `Access-Control-Allow-Origin: *` (or the Studio origin). Redirect destinations
also need CORS. Hosts requiring authentication are not supported by v1. Use HTTPS
for repositories accessed from HTTPS Studio; browsers block mixed-content HTTP
requests. Preview pages must permit framing to appear inline. A thumbnail image
works independently of a page's frame policy. The app's bundled repository uses
images for thumbnails and separate demo links.

For example, a static host's response headers for repository files can include:

```text
Access-Control-Allow-Origin: *
Cache-Control: no-cache
```

Set `Content-Type: application/json` on the index and `application/zip` on ZIPs
where possible. Studio can also read raw-content hosts that return a generic MIME
type. Never return an HTML fallback or login page for the index or archive.

## Publish with the CLI

Node.js 22 or newer is required. Create a source repository, copy in a template and
bundle a directory ready for your static host:

```sh
npx @trafficops/cli repo init ./team-templates \
  --name "Acme landing templates" --author "Acme Creative" \
  --description "Our approved campaigns" --homepage https://example.com/design
npx @trafficops/cli repo add ./team-templates \
  --path ./campaign --name "Product launch" --id product-launch \
  --description "Benefits and a signup form" --version 1.0.0 \
  --thumbnail ./preview.png --data ./values.json
npx @trafficops/cli repo bundle ./team-templates
```

All commands work noninteractively. The directory defaults to the current working
directory; `repository` is an alias for `repo`. Only `--name` is required for
`init`; `add` requires `--path` and `--name`. The other shown flags are optional.
Without `--id`, `add` derives a slug from the name. The default version is `1.0.0`.
A thumbnail can be a local image file or an HTTP(S) URL. Optional `--data` JSON
sets field values for both the editable project and its generated preview,
overriding matching top-level fields from an imported `.trafficops/values.json`.
Use a directory for `--path` to include all local assets.

`repository.json` is the **source manifest**. Template files are copied into
`templates/<id>/`, so the original source stays independent. Edit these copied
files and the manifest for later releases. `bundle` generates `<repository>/dist`
with the **public index** (`index.json`), source ZIPs, SHA-256 digests, rendered
preview pages, local thumbnails and `_headers` for hosts such as Netlify. Upload
that directory's contents and share the public index URL. Other servers may need
manual CORS configuration, as described above.

To rebuild existing output, use `tops repo bundle ./team-templates --force`.
Use `--output ./public/templates` to choose another output directory. Neither
publishing nor updating an external repository needs a Studio rebuild. See the
[CLI reference](../tops-cli/README.md#template-repositories) for all command options.

## Creating archives

Use **Export → Editable project**, **exclude conversation history**, and publish
the resulting source ZIP. Plain ZIPs of template files also work. Include source
`.tpl`/HTML, CSS, scripts, images and other assets. A single enclosing folder is
removed automatically. `.trafficops/values.json` preserves field values; empty
directories and binary assets are retained. Source project identity and pending AI
briefs are not applied to a new project. ZIPs containing conversation history are
not template packages; re-export without history.

ZIP downloads are limited to 20 MiB; the existing project importer enforces 32 MiB
expanded data, 500 files/folders, 8 MiB per binary file and 2 MiB per text file, and
rejects invalid paths. The ZIP downloads and validates when a template is selected.
Only after it is ready can **Create** ask for a destination folder. Every use
creates an independent project; it never changes the archive or repository.

Only add repositories whose templates you trust. Catalog text is rendered as text;
inline catalog previews are sandboxed without script execution. A template's code
can execute when opened in the editor's interactive project preview, like code from
an imported project.

## Updates, removal and offline use

Enabled indexes refresh when Studio starts. **Refresh** in Settings fetches a new
index immediately. Errors include a recovery hint; failed requests never replace a
valid catalog with an empty one. **Enabled** controls visibility without forgetting
the URL. **Remove** deletes the saved repository and its downloaded ZIP cache; it
does not remove any projects created from it. Settings sync between open tabs of
the same origin.

Studio saves the last valid index in local storage. Validated archives are kept in
Cache Storage (up to 20 downloads per repository), keyed by archive URL, template
ID, version and checksum. Downloading a template online refreshes its archive;
offline or failed network connections may use a matching cached ZIP. HTTP errors,
invalid archives and checksum mismatches remain errors. Browser cache eviction or
clearing site data removes this offline availability. Both included repositories'
indexes, archives and previews are precached with the PWA, so their templates are also
available offline before their first use once the app is fully cached.

## Bundled repositories

The default TrafficOps repository is a normal index at
`editor/public/template-repositories/trafficops/index.json`. Its catalog and ZIPs
are static files, not a JavaScript template array. It can be disabled or removed;
Settings offers its URL again when absent. **TrafficOps Demo** is a second default
repository at `editor/public/template-repositories/demo/index.json`, containing
five complete templates: Tandem SaaS, Clay School, Common Ground, Juniper Cafe and
Still Portfolio. Both repositories can be disabled independently.

Existing browser preferences receive Demo once, without re-enabling the original
repository or other disabled sources. The saved `knownDefaults` list records which
bundled repositories have been offered, so disabled and removed defaults stay that
way after reload. Settings offers each missing bundled repository for manual
restoration. Only the minimal **From scratch** document remains in application code.

Demo's sources, publishing commands and verification workflow are documented in
[`repositories/demo/README.md`](../repositories/demo/README.md).

The original starter sources live in `repositories/trafficops/templates/<id>/`, metadata
and thumbnail paths in `repositories/trafficops/repository.json`. From the monorepo
root, regenerate published files after editing sources (and refresh screenshots
when needed):

```sh
npm run build:cli
node tops-cli/dist/cli.js repo bundle repositories/trafficops \
  --output editor/public/template-repositories/trafficops --force
```

The CLI writes deterministic ZIPs, SHA-256 digests, rendered demo pages,
`index.json` and hosting headers, and copies thumbnail images. The legacy
`node editor/scripts/build-template-repository.mjs [source] [output]` helper remains
available for the same source-folder layout; it defaults to the TrafficOps starter
repository and rebuilds existing output.

Alternatively, author an index by hand and use your preferred ZIP publishing
workflow. No Studio rebuild is needed to add or update an external repository.

## Verification

```sh
node --test editor/test/template-repositories.test.js editor/test/studio-catalog.test.js
npm run build:editor
node editor/test/template-repositories-browser.mjs editor/dist
```

The browser check uses Playwright (optionally `PLAYWRIGHT_MODULE`) and system Chrome
on macOS. It starts two local origins and an isolated profile; no external service,
user projects, credentials or paid AI calls are used. It verifies addition,
persistence, grouping, ZIP import, refresh failure recovery, disable/remove races,
mobile layout and actual offline creation through the PWA service worker.
