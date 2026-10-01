# @trafficops/studio-ui

Primitives, workspace, i18n and chat contract shared by TrafficOps studios. Task 17 extends this file.

## Browser checks

Keyboard and role checks for the primitives run in system Chrome (macOS) against an esbuild bundle of `test/fixtures/Playground.jsx`. Run from the repository root with a caller-supplied Playwright:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node packages/studio-ui/test/primitives-browser.mjs .
```

Focus rings come from `.studio-root :focus-visible`; consumers must render studio UI inside an element with the `studio-root` class.
