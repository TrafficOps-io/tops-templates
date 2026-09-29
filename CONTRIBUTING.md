# Contributing

Use Node.js 22+ and PHP 8.4+ (DOM, Mbstring, Intl). From the repository root:

```sh
npm ci
composer install
npm run check
npm test
npm run build
npm run build:vsix
composer check
npm run test:runtime --workspace=tops-templates
```

`npm run dev` opens the frontend development server. The PHP package is the reference implementation ([ADR-0001](docs/adr/0001-php-is-the-reference-implementation.md)); the JavaScript runtime must produce the same result or reject more. A PHP behaviour change needs a parity fixture in [`fixtures/parity`](fixtures/parity/README.md), which both test suites run, and the matching JavaScript change. Update the language documentation in `docs/` when changing parsing or rendering. Keep user values as data and image references as paths. No runtime may fetch include files from a network.

The extension retains `fastLandingsTemplates.*` configuration keys and language identifiers for compatibility; its default dialect is `safe-html-v1`.

Submit focused pull requests with an example, test results and compatibility implications. Contributions are under the MIT license. Report security defects privately through GitHub Security Advisories.
