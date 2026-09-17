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

`npm run dev` opens the frontend development server. PHP and JavaScript runtimes have separate compatibility contracts: update the relevant language documentation and add behavior tests when changing parsing/rendering. Keep user values as data and image references as paths. No runtime may fetch include files from a network.

The extension retains `fastLandingsTemplates.*` configuration keys and language identifiers for compatibility; its default profile is `safe-html-v1`.

Submit focused pull requests with an example, test results and compatibility implications. Contributions are under the MIT license. Report security defects privately through GitHub Security Advisories.
