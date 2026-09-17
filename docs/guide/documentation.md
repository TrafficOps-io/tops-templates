# Publishing the documentation

The site lives in `docs/`, is built with VitePress, and is deployed to GitHub Pages.

## Local development

From the monorepo root:

```sh
npm ci --prefix docs
npm run docs:dev
```

Build and preview the production output with:

```sh
npm run docs:build
npm run docs:preview
```

Static output is written to `docs/.vitepress/dist` and is not committed.

Use a `tpl` fence for template-language examples. VitePress loads the same
TextMate grammar as the VS Code extension, so directives, declarations,
options, expressions, HTML, and embedded PHP stay highlighted consistently.

````md
```tpl
@param title String required
```
````

## GitHub Pages

The `.github/workflows/deploy-docs.yml` workflow:

1. runs after successful CI for a push to `main`, or manually;
2. installs the isolated documentation dependencies with `npm ci --prefix docs`;
3. builds VitePress with the `/tops-templates/` base path;
4. uploads a Pages artifact;
5. deploys it to the `github-pages` environment.

In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the publishing source once. After merge, the site is published at:

<https://trafficops-io.github.io/tops-templates/>

## File map

- navigation and metadata: `docs/.vitepress/config.mjs`;
- theme: `docs/.vitepress/theme/style.css`;
- template syntax grammar: `vscode-extension/syntaxes/fast-landings-tpl.tmLanguage.json`;
- guides: `docs/guide/*.md`;
- full language specification: `docs/language-v1.md`;
- dialect API: `docs/dialects.md`;
- deployment workflow: `.github/workflows/deploy-docs.yml`.
