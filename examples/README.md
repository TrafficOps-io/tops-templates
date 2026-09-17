# Example templates

`campaign/` is a complete two-page project. It demonstrates typed cards, generated form fields, conditional sections, safe Markdown, a configurable CSS color and local image paths.

```sh
npx @trafficops/cli --template ./examples/campaign --output ./generated
npx @trafficops/cli --template ./examples/campaign --data ./examples/campaign-data.json --output ./generated --force
```

Before the first npm release, run `node tops-cli/dist/cli.js` instead of `npx @trafficops/cli` after `npm ci && npm run build:cli` from the repository root. Open `generated/index.html` in your browser. Zip the contents of `campaign/` to import the example into the browser editor.

Keep JSON input outside the template project directory when it should not be copied to the generated site. Directory generation retains every non-template asset; `.tpl` and `.tpl.html` source files are never exported.
