# JavaScript template runtime

Shared browser and Node.js implementation used by the editor and `@trafficops/cli`. This is a private workspace package; the CLI bundles its source into its public npm artifact. It never evaluates JavaScript from a template, contacts a server, or uploads images.

The authoritative language contract and PHP engine live in [`../template-dsl`](../template-dsl/). Per [ADR-0001](../docs/adr/0001-php-is-the-reference-implementation.md) the PHP package is the reference: this runtime produces the same output or rejects more, never less, and its numeric limits are the PHP values. The shared cases in [`../fixtures/parity`](../fixtures/parity/) run against both implementations (`test/parity-fixtures.test.js` and `template-dsl/tests/ParityFixturesTest.php`). It is not a reader for serialized PHP JSON definitions.

```js
import {
  parseTemplate, parseProject, getDefaults, validateValues,
  renderTemplate, generateProject,
} from '@trafficops/template-runtime';

const files = {
  'index.tpl': '@param title String = "Welcome"\n@layout\n<h1>{{title}}</h1>\n@endlayout',
  'assets/logo.png': new Uint8Array(/* local file bytes */),
};
const {definition, pages} = parseProject(files);
const defaults = getDefaults(definition);
const values = validateValues(definition, {...defaults, title: 'Hello'});
const output = generateProject(files, values);
// { 'index.html': '<h1>Hello</h1>\n', 'assets/logo.png': Uint8Array(...) }
```

All APIs are synchronous. Errors are `TemplateError` instances with a readable message.

| API | Contract |
| --- | --- |
| `parseTemplate(source, options?)` | Parse one UTF-8 source string. `options.filename` defaults to `index.tpl`. `options.resolveInclude(path, fromFilename)` must synchronously return an authorized source string. |
| `parseProject(files)` | Accept `Record<string, string \| Uint8Array>`. Return `{definition, pages, files}`, where `pages` is an array of parsed definitions and `definition` is the entry page. `index.tpl`/`index.tpl.html` take precedence, then lexical order. |
| `getDefaults(definition)` | Build bounded editable values, including default groups and minimum repeater rows. Required fields may initially be empty. |
| `validateValues(definition, values, options?)` | Validate JSON values and return normalized values with missing defaults filled. Keys that no field declares are dropped; pass `options.warnings` (an array) to collect them as `{path, message}`, where `path` is dotted and relative to the values root with repeater rows as numeric segments (`comments.1.legacy`), the same grammar as the PHP `$warnings` keys. Type violations and missing required values throw. |
| `renderTemplate(definition, values?, context?)` | Render a definition returned by these parsing APIs. Returns HTML. Definitions carry an internal parsed program; cloning them through JSON is unsupported. |
| `generateProject(files, values?, context?)` | Render every page, retain non-template assets without changing their bytes, and return a new file map. |

Definitions expose `version`, `name`, `description`, `sections`, `fields`, `html`, `entrypoint`, `source`, `partials`, and optional preview metadata. `fields` is a convenience list of root fields; canonical groups are `sections[].fields`. Each field has `name`, `author_type`, `type`, `label`, `help`, `required`, optional `default`, and type-specific properties. Groups/repeaters have `fields`; selects have an `options` value-to-label object.

## Source compatibility

| Language feature | JavaScript behavior |
| --- | --- |
| `@template`, `@previewData`, `@section`, `@param` | Supported, including named sections, metadata and validated preview values. |
| All built-in author types | Supported. Image settings are safe relative project paths. No image upload or crop operation is performed. |
| `@type`, groups and custom `Type[]` repeaters | Supported with bounded defaults, nesting, cardinality and validation. |
| `@block`, `@render` | Supported with typed arguments, lexical scope and recursion checks. |
| `@layout`, `@if`, `@unless`, `@each` | Supported with PHP truthiness: `""` and `"0"` are the only falsey strings, `0` and empty lists are falsey, a group with fields is truthy. `@if` over a list is rejected; use `@each`. |
| `@include` | Supported; paths are relative to the including file, cannot traverse upward and must end in `.tpl` or `.tpl.html`. At most 10 nested include levels, as in PHP. |
| `{{path}}`, sections, inverse sections, parent/root paths | Supported. Scalar values are escaped and never rescanned. |
| `{{& path}}` | Supported only for Markdown/Wysiwyg fields, sanitized with the PHP engine's tag/attribute allowlist. |
| `{query.name}`, `{locale}`, `{actions.name}` | Supported with explicit bounded context, safe HTML placement and encoded URL components. Unknown request-token families are rejected. |
| Named JSON partials / `{{>partial}}` | Not supported; source authors should use typed blocks and includes. |
| Application field aliases and custom dialects | Not supported. Use the PHP engine for host-specific behavior. |

## Value contract

Values follow the PHP engine's rules, with the stricter portable restrictions below:

| Rule | Behavior (PHP and JavaScript) |
| --- | --- |
| Unset optional field | Empty (`""`); `Boolean` is `false`, a repeater is `[]` unless `min_items` requires rows. A declared default applies. |
| Unknown keys | Dropped with a warning (`validateValues(..., {warnings})`, paths such as `comments.1.legacy`); never an error. Type violations and missing required values throw. |
| `Boolean` | Accepts `true`/`false` and `"0"`/`"1"`. PHP also accepts integer `0`/`1`; JavaScript rejects numeric input because it cannot distinguish those integers from PHP-rejected JSON floats `0.0`/`1.0`. `null` is rejected. |
| `Number`, `Range` | Accepts JSON numbers and PHP numeric strings (`"20.5"`, `" 20"`, `"1e1"`, `"5."`); stores a number. Portable numbers have at most 14 significant decimal digits and are zero or have magnitude from `0.0001` (inclusive) to `1e14` (exclusive). `min`/`max`/`step` apply with PHP's step tolerance. An optional field accepts `""` or `null` as empty. |
| `Select` | Accepts an option key or a number whose string form is a key; numeric input follows the same portable number restrictions and rejects negative zero. A string key avoids numeric conversion. `""` is valid for an optional field. |
| Text types | Strings only; `null` becomes `""`. At most 10,000 bytes (`String`, `Color`, `Url`, `Image`, `Email`, `Select`) or 100,000 bytes (`Text`, `Wysiwyg`, `Markdown`) of UTF-8; tab, LF and CR are allowed, other control characters are rejected. A required field rejects PHP-blank whitespace. |
| `Url` | Absolute HTTP(S) URL up to 2048 bytes without credentials; relative paths are rejected. Percent-encoding is decoded up to five times and must not leave controls, spaces, `//` or `%`. |
| `Image` | Same HTTP(S) rule, or a relative path without a leading slash, `:`, `?`, `#`, empty, `.` or `..` segments. Query strings and fragments are rejected. |
| `Email` | Dot-atom local part and a dotted DNS domain (`a@b.c` passes, `user@localhost` does not). |
| Rich text | Stored as authored; sanitized at render. Every image source must satisfy the `Image` rule. |

### Converged with PHP

These former divergences now behave as in the PHP reference and are pinned by the parity fixtures:

1. `Boolean`/`Number` coercion of `"1"`, `"0"` and numeric strings;
2. text limits of 10,000 and 100,000 bytes;
3. `Url` rejects relative paths;
4. image paths reject `?` and `#` instead of stripping them;
5. PHP truthiness (`"0"` falsey, a group with fields truthy);
6. include depth 10;
7. 8 MiB rendered output per page and for all pages together;
8. an unset optional `Number` stays `""`;
9. `@if` over a list is rejected ("Use @each for lists.").

### Portable restrictions and numeric representation

JavaScript erases PHP's integer/float distinction. The runtime rejects numeric Boolean input and numeric values whose scalar spelling can differ from PHP's default 14-digit float precision. These rules apply to field values, declared defaults and numeric Select inputs. Use the PHP renderer for numbers outside the portable range. Every shared fixture executes in both suites; `portableReject` pins cases PHP accepts and JavaScript deliberately rejects.

Numeric strings such as `"1e1"` or `"5."` normalize to PHP floats (`10.0`, `5.0`) and JavaScript numbers (`10`, `5`). This representation difference remains because JavaScript has a single number type; their rendered HTML is identical. The fixture's PHP expectations preserve and check the float type, while JavaScript checks the equivalent numeric value. Hosts needing float-preserving JSON storage must use PHP.

Where JavaScript cannot reproduce a PHP rule exactly it is stricter: `Image` paths additionally go through `safePath` (no `%`, hidden segments or executable extensions, at most 255 bytes); `Email` rejects quoted local parts and IP-literal domains; `Url` requires printable ASCII and DNS-shaped host labels; lone surrogates are rejected. Rich text uses Marked with GFM disabled and raw Markdown HTML stripped, followed by `sanitize-html`; CommonMark edge cases and sanitizer serialization can differ from PHP. Do not depend on byte-identical HTML formatting across implementations.

Page discovery occurs after include expansion. Included files are fragments, even if they supply a complete layout; their including entry determines the output name. Source `.tpl` and `.tpl.html` suffixes become `.html`. Shared declarations across pages must agree. Duplicate paths ignoring case and file/directory output collisions are rejected. Hidden paths, absolute paths, traversal, backslashes and URL-like paths are disallowed.

## Rendering boundaries

Settings remain opaque until final rendering. Their text cannot become a directive, Mustache expression or runtime token. The HTML scanner respects quoted `>` characters and exact raw-text element endings. It allows escaped text in `title`/`textarea`, supported quoted attributes, and typed `Color`/`Number`/`Range` values in CSS. It rejects dynamic JavaScript, event handlers, unquoted attributes, comments, declarations, tag names, unsafe URL schemes, dynamic executable element attributes and rich HTML inside attributes or raw-text elements. Legacy nested/HTML-comment-escaped script syntax is explicitly unsupported.

Templates themselves are author-controlled HTML; static scripts or external asset URLs in a template are not sanitized as if they were user data. Hosts should preview untrusted projects in an isolated sandbox. Only rich-text setting values are sanitized. Image paths are references, and retained asset bytes never leave the host unless the host explicitly exports them.

`context` accepts only `{query: {...}, locale: 'en-GB', actions: {...}}`. Actions must be HTTPS or a safe absolute local path and fill an entire quoted `href`, `action` or `formaction`. Query/locale values in URLs need an author-controlled host or path prefix. Empty/missing runtime values render as empty text.

Limits follow the PHP reference: 2 MiB expanded source, 20,000 expanded lines, 10 include levels, 100 pages, 200 fields, six custom-type nesting levels, 50 repeater items, 10,000 normalized/default values, 100,000 render operations, and 8 MiB of rendered HTML both per page and for all pages of a project together. Additionally, a project accepts at most 500 files and 32 MiB of input or output including assets. Rich text is limited to 100,000 bytes, sanitized nesting to 32, and Markdown delimiters to 1,000 per line.

Run `npm test --workspace=@trafficops/template-runtime` from the root. PHP differential fixtures run when the root Composer autoloader and PHP are available; CI also runs them explicitly after installing Composer dependencies.
