# TrafficOps Demo

A complete static template repository, enabled by default in Landing Studio and its
installed PWA. It contains **five** independent, editable landing-page templates:

| Template | Scenario | Included content |
| --- | --- | --- |
| Tandem SaaS | Product launch | Product-board illustration, features, pricing and call to action |
| Clay School | Creative course | Pottery artwork, curriculum, instructor and enrollment details |
| Common Ground | Event | Poster layout, schedule, speakers, venue and tickets |
| Juniper Cafe | Local business | Coffee artwork, editable menu, opening hours and address |
| Still Portfolio | Photography portfolio | Selected work, local sample illustrations, biography and contact |

Each project includes `index.tpl`, `styles.css` and its own local assets. Edit
headlines, descriptions, brand, accent, button text and destination through Studio's
Content tab; each template also declares fields specific to its scenario. No
remote fonts, image services, accounts or build steps are needed to use a template.
Names, prices, schedules and artwork are example content intended for replacement.

## Connection

Studio automatically includes the repository at
`/template-repositories/demo/index.json`. Existing profiles receive it once when
they upgrade. Turn off **Settings → Template repositories → TrafficOps Demo →
Enabled** to hide its templates; the choice persists after reload. Removing the
repository also persists and keeps any projects made from its templates.

The settings page offers **Use the included TrafficOps Demo repository** to restore
it after removal. The original TrafficOps starters remain a separate repository.

## Source and published files

- `repository.json`: repository metadata and the five template entries.
- `templates/<id>/`: editable template source and assets.
- `<id>.png`: thumbnails captured from the actual rendered pages.
- `../../editor/public/template-repositories/demo/`: ready-to-host `index.json`,
  five source ZIPs, thumbnails and rendered preview pages.

From the `tops-templates` root, build the CLI and rebuild the static repository with:

```sh
npm run build:cli
node tops-cli/dist/cli.js repo bundle repositories/demo --output editor/public/template-repositories/demo --force
```

After visual changes, refresh the thumbnails using Playwright and rebuild again:

```sh
node editor/scripts/capture-repository-previews.mjs repositories/demo editor/public/template-repositories/demo
node tops-cli/dist/cli.js repo bundle repositories/demo --output editor/public/template-repositories/demo --force
```

The capture script uses system Chrome on macOS. Set `PLAYWRIGHT_MODULE` and/or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` when using another installation. The publisher
generates deterministic ZIPs and their SHA-256 checksums. Keep source and published
files together in changes so the shipped repository matches its editable sources.
The CLI also supports `repo init` and `repo add` for authoring new repositories; see
[the command reference](../../tops-cli/README.md#template-repositories).

## Hosting independently

Copy the contents of `editor/public/template-repositories/demo/` to an HTTPS static
host with CORS enabled. Add that host's `index.json` URL in Studio. All index links
are relative, so the directory can move as a unit. The source repository can live
on GitHub; users should add the **raw** URL of the published `index.json`. Use a
web host for rendered preview pages, or rely on the PNG thumbnails for raw hosting.

See [the repository format](../../editor/TEMPLATE-REPOSITORIES.md) for the schema,
hosting headers, archive limits and cache behavior.

## Verification

```sh
node --test editor/test/demo-repository.test.js editor/test/template-repositories.test.js
npm run build:editor
node editor/test/demo-repository-browser.mjs editor/dist
```

The browser check uses isolated storage. It verifies all five project creations,
desktop/mobile rendering, local assets, persistent disable/remove/restore and
offline PWA use. Review captures in `/tmp/studio-demo-repository-qa/`.
