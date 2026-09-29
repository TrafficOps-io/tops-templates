# Parity fixtures

Shared cases that pin the behaviour of the PHP reference implementation (`template-dsl`) and the portable JavaScript runtime (`runtime`). Per [ADR-0001](../../docs/adr/0001-php-is-the-reference-implementation.md) PHP is the reference: every expectation here is what PHP does, and JavaScript must match it or reject more.

## Runners

Both runners read every `*.json` file in this directory, in file-name order, and run each entry of its `cases` array as one test named `<file>: <case name>`:

- PHP: `template-dsl/tests/ParityFixturesTest.php` (part of `composer test`). It parses with `TemplateSourceParser::parsePages()` (entry `index.html`), then calls `validateValues()`, `defaults()` and `renderPages()`.
- JavaScript: `runtime/test/parity-fixtures.test.js` (part of `npm test`). It builds a project with `parseProject()`, then calls `validateValues()`, `getDefaults()` and `generateProject()`.

A new file needs no registration. Neither runner rewrites results before comparing them: values, warning paths and numbers are compared as each implementation returns them.

## File shape

```json
{
  "description": "What the file pins.",
  "cases": [
    {
      "name": "Boolean accepts the string \"1\" as true",
      "source": "@param flag Boolean\n@layout\n[{{flag}}]\n@endlayout",
      "values": {"flag": "1"},
      "expect": {"ok": true, "html": "[1]", "values": {"flag": true}}
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `name` | Test name; write it as a specification sentence. |
| `source` | The entry template source (`index.tpl`, output `index.html`). |
| `pages` | Optional map of further page sources, e.g. `{"about.tpl": "..."}`, output `about.html`. All pages render with the same values. |
| `includes` | Optional map of include paths to sources for `@include`. |
| `values` | The values document passed to validation and rendering. Defaults to `{}`. |
| `context` | Optional runtime context (`query`, `locale`, `actions`). |
| `expect.ok` | `true` when PHP accepts the case, `false` when it rejects it (at parse, validation or render time). A rejected case asserts nothing else; `reason` may explain it. |
| `expect.defaults` | The defaults of the definition, compared exactly. |
| `expect.values` | The normalized values returned by `validateValues()`, compared exactly (PHP distinguishes `10` from `10.0`). |
| `expect.warnings` | Warning paths for dropped unknown keys, dotted and relative to the values root (`comments.1.legacy`). |
| `expect.html` | Entry page HTML. Whitespace between tags is removed and whitespace runs collapse to one space before comparing. |
| `expect.pages` | Map of output path to HTML, normalized the same way. |
| `portableReject` | A reason JavaScript deliberately rejects a case accepted by PHP. The PHP runner still checks all reference expectations; JavaScript asserts rejection. It is only valid when `expect.ok` is `true`. |

Two value helpers keep large inputs readable anywhere in `values` and `expect`:

- `{"$repeat": ["a", 10000]}` is the string `"a"` repeated 10,000 times;
- `{"$concat": ["https://example.com/", {"$repeat": ["a", 2040]}]}` joins its expanded parts.

## Stricter portable input

No parity case is skipped. The `portableReject` cases record stricter JavaScript input where JSON has erased a PHP integer/float distinction or number spelling would differ. Numeric Boolean input is rejected; numbers and numeric Select inputs stay within the portable precision and magnitude restrictions. PHP assertions always execute, including its float type expectations (`10.0` rather than `10`). JavaScript checks the equivalent number and identical HTML for accepted input.

The restrictions are in [runtime/README.md](../../runtime/README.md#portable-restrictions-and-numeric-representation). Add `portableReject` only for a documented stricter rule; never skip a PHP expectation to conceal a JavaScript difference. Both runners reject the old `residual` marker.

## Adding a case

A change to PHP behaviour needs a fixture here that pins the new behaviour. Add the case, run `composer test` to confirm the expectation against PHP, then `npm test --workspace=@trafficops/template-runtime` and make the JavaScript runtime match.
