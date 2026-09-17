# TrafficOps Templates

A template language and a local-first toolkit for building static pages: a PHP package, a terminal generator, a browser editor, a VS Code extension and installable agent skills. All tools live in this monorepo under the MIT license.

| Directory | Purpose | Distribution |
| --- | --- | --- |
| `template-dsl/` | Authoritative PHP DSL, typed fields and safe HTML renderer | `trafficops/template-dsl` on Packagist |
| `runtime/` | Shared portable JavaScript parser and renderer | Bundled into CLI/editor |
| `tops-cli/` | Commander.js CLI and Ink parameter form | `@trafficops/cli` on npm |
| `editor/` | Monaco, React, Tailwind CSS and daisyUI editor | Static Netlify deployment |
| `vscode-extension/` | Syntax, diagnostics, completion and formatting | VSIX in GitHub Releases |
| `docs/` | VitePress documentation site and language reference | GitHub Pages |
| `skills/` | Template authoring and PHP integration skills | `npx skills add` |

## Generate a page

After the first npm release:

```sh
npx @trafficops/cli --template ./my-template
npx @trafficops/cli --template ./my-template --data ./values.json --output ./site
npm install --global @trafficops/cli
```

Without `--data`, a terminal form is built from the template parameters. With `--data`, generation is non-interactive. Images remain relative file paths and project assets are copied without uploading them. See [CLI usage](tops-cli/README.md) and [portable runtime support](runtime/README.md).

For development before npm publication:

```sh
npm ci
npm run build:cli
node tops-cli/dist/cli.js --template ./examples/campaign --data ./examples/campaign-data.json --output /tmp/trafficops-site
```

## Edit in the browser

[Open Template Studio](https://trafficops-templates.netlify.app), or run locally:

```sh
npm ci
npm run dev
```

Start a project or open a ZIP, edit files in Monaco, fill in template parameters, preview and download generated pages as a ZIP. The editor runs entirely in the browser. Project images and documents are never sent to an API. The design uses the TrafficOps warm cream/coral theme and local Onest fonts derived from the UI package.

See [editor details](editor/README.md). `netlify.toml` builds this workspace from the repository root.

## PHP

After registering the repository on Packagist:

```sh
composer require trafficops/template-dsl
```

Use the `TrafficOps\TemplateDsl` namespace; Laravel discovers its service provider. The root `composer.json` maps directly to `template-dsl/src`, so the repository is one Composer package without split repositories. See [PHP API](template-dsl/README.md), [language v1](docs/language-v1.md), [dialects](docs/dialects.md) and [security boundary](SECURITY.md).

## Agent skills

```sh
npx skills add trafficops-io/tops-templates
npx skills add trafficops-io/tops-templates --skill trafficops-template-authoring --agent codex --agent claude-code
```

Skills are self-contained: their references travel with the installation. See [available skills](skills/README.md).

## VS Code

Download the `.vsix` file from [GitHub Releases](https://github.com/trafficops-io/tops-templates/releases), then run **Extensions: Install from VSIX**. To build it locally:

```sh
npm ci
npm run build:vsix
```

## Documentation

The documentation site covers the language, host-selected dialects, PHP/Laravel integration, CLI and browser editor. Run it locally with:

```sh
npm ci
npm run docs:dev
```

Production output is built with `npm run docs:build`. After successful CI on `main`, GitHub Actions publishes it to [trafficops-io.github.io/tops-templates](https://trafficops-io.github.io/tops-templates/). Repository Pages must use **GitHub Actions** as its publishing source.

## Development and releases

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and [RELEASING.md](RELEASING.md) for initial registry setup, GitHub environments, secrets and release commands. A checked-in workflow is publication configuration; it does not mean a package has already been registered or published.
