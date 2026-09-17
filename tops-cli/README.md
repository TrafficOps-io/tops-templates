# TrafficOps CLI

Generate static websites from TrafficOps templates. The CLI uses Commander.js for commands and Ink for a form built from each template's schema. Node.js 22 or newer is required.

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

## Develop and verify

From the repository root:

```sh
npm ci
npm run build:cli
node tops-cli/dist/cli.js --template examples/campaign --data examples/campaign-data.json --output generated
npm test --workspace=@trafficops/cli
npm run test:pack --workspace=@trafficops/cli
```

`test:pack` packs the real npm artifact, installs it in an isolated temporary consumer and runs version and page-generation checks. The CLI bundle includes the private runtime source; published packages have no dependency on a workspace path. Commander, Ink, React, Marked and sanitize-html remain ordinary public npm dependencies. `tops` and `trafficops` are equivalent executable names.
