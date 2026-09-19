# Releases and deployment

The default branch is `main`. The four TrafficOps repositories are independent versioned repositories; this repository starts at `0.1.0`. Composer discovers the version from a Git tag. The root package is `trafficops/template-dsl`; no subtree split is needed.

## One-time registry setup

1. Submit `https://github.com/trafficops-io/tops-templates` on [Packagist](https://packagist.org/packages/submit) and keep its GitHub auto-update integration enabled.
2. Ensure the npm account can publish in the `@trafficops` scope. Publish the first version interactively, then configure npm's GitHub trusted publisher: organization `trafficops-io`, repository `tops-templates`, workflow `release.yml`, environment `release`, and allow direct `npm publish`. OIDC publication uses npm 11 and a GitHub hosted runner, so no long-lived npm token is stored in GitHub.
3. Create a Netlify site for this repository. The checked-in `netlify.toml` uses root npm workspaces, builds `editor`, and publishes `editor/dist`. Either use Netlify's Git integration or enable the Actions deployment below.
4. For Actions deployment, add `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` to the `netlify` environment and set repository variable `NETLIFY_DEPLOY_ENABLED=true`. The workflow deploys the editor artifact from successful `main` push CI. Do not also enable automatic Git deployment if a single CI-gated deployment path is desired.

The CLI and Composer package are public OSS packages. Do not create production tags before registry setup is complete. CI artifacts remain available independently.

## Cut a release

Update versions in root `package.json`, `tops-cli/package.json`, `vscode-extension/package.json`, all four manifests in `packages/`, and internal workspaces/dependencies together, then run `npm install --package-lock-only`. Record changes in `CHANGELOG.md`.

```sh
npm ci
npm run check
npm test
npm run build
npm run build:vsix
composer install
composer check
npm run test:runtime --workspace=tops-templates
node scripts/check-release.mjs 0.1.0
git tag -a v0.1.0 -m 'TrafficOps Templates 0.1.0'
git push origin v0.1.0
```

The `Release` workflow runs the complete reusable CI on the tagged commit. Only after it passes does it publish language, Monaco, core, shell and CLI using explicit workspace names and create a GitHub Release with their tarballs, Composer archive and VSIX. Packagist discovers the tag through its GitHub integration. Never move a published tag. npm package versions are immutable; review partial failures before retrying a release.

`CI` builds downloadable artifacts for every main push/PR without publishing a version. The VS Code extension is distributed as VSIX; a Marketplace account/token is not required.

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Packagist GitHub integration](https://packagist.org/about)
- [Netlify monorepos](https://docs.netlify.com/build/configure-builds/monorepos/)
- [Netlify ZIP deploy API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)

The release tag must also match `packages/template-language/package.json`. CI packs the language package alongside the CLI. Release publishing uses explicit workspace names so the vendored editor tarball is never accidentally published by a wildcard.

The public `@trafficops/template-editor-monaco` package is versioned and packed with
the language package. Publish language first, then Monaco, before consuming releases.

`@trafficops/template-editor-core` ships its type contract and canonical host
fixtures with the headless runtime helpers. Pack it with the other public packages;
PWApps consumes the packed fixture corpus in its PHP tests. Core must remain free
of React, Monaco, language-core and template-runtime dependencies.

`@trafficops/template-editor-shell` is the public React shell. Its CSS and translations
ship in the same tarball. The private Studio app and the prebundled embed artifact
are not registry publication targets. Verify the clean consumer in `editor/README.md`
before publishing the four public editor packages.
