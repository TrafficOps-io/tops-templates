# JavaScript template runtime

Shared browser and Node.js implementation used by the editor and `@trafficops/cli`. This is a private workspace package; the CLI bundles its source into its public npm artifact. It never evaluates JavaScript from a template, contacts a server, or uploads images.

The authoritative language contract and PHP engine live in [`../template-dsl`](../template-dsl/). The JavaScript implementation supports the source language described below and deliberately rejects unsupported output contexts. It is not a reader for serialized PHP JSON definitions.

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
| `validateValues(definition, values)` | Validate JSON values and return normalized values with missing defaults filled. Unknown fields are rejected. |
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
| `@layout`, `@if`, `@each` | Supported. A string `"0"` is falsey, as in PHP. |
| `@include` | Supported; paths are relative to the including file, cannot traverse upward and must end in `.tpl` or `.tpl.html`. |
| `{{path}}`, sections, inverse sections, parent/root paths | Supported. Scalar values are escaped and never rescanned. |
| `{{& path}}` | Supported only for Markdown/Wysiwyg fields, sanitized with the PHP engine's tag/attribute allowlist. |
| `{query.name}`, `{locale}`, `{actions.name}` | Supported with explicit bounded context, safe HTML placement and encoded URL components. Unknown request-token families are rejected. |
| Named JSON partials / `{{>partial}}` | Not supported; source authors should use typed blocks and includes. |
| Application field aliases and custom dialects | Not supported. Use the PHP engine for host-specific behavior. |

The portable input contract uses actual JSON numbers and booleans. It intentionally rejects numeric strings and `0`/`1` boolean coercions accepted by some PHP integrations. Missing defaults, required values, numeric constraints, select values and repeater bounds are validated. `Image` values must be relative file paths. Rich text uses Marked with GFM disabled and raw Markdown HTML stripped, followed by `sanitize-html`; CommonMark edge cases and sanitizer serialization can differ from PHP. Do not depend on byte-identical HTML formatting across implementations.

Page discovery occurs after include expansion. Included files are fragments, even if they supply a complete layout; their including entry determines the output name. Source `.tpl` and `.tpl.html` suffixes become `.html`. Shared declarations across pages must agree. Duplicate paths ignoring case and file/directory output collisions are rejected. Hidden paths, absolute paths, traversal, backslashes and URL-like paths are disallowed.

## Rendering boundaries

Settings remain opaque until final rendering. Their text cannot become a directive, Mustache expression or runtime token. The HTML scanner respects quoted `>` characters and exact raw-text element endings. It allows escaped text in `title`/`textarea`, supported quoted attributes, and typed `Color`/`Number`/`Range` values in CSS. It rejects dynamic JavaScript, event handlers, unquoted attributes, comments, declarations, tag names, unsafe URL schemes, dynamic executable element attributes and rich HTML inside attributes or raw-text elements. Legacy nested/HTML-comment-escaped script syntax is explicitly unsupported.

Templates themselves are author-controlled HTML; static scripts or external asset URLs in a template are not sanitized as if they were user data. Hosts should preview untrusted projects in an isolated sandbox. Only rich-text setting values are sanitized. Image paths are references, and retained asset bytes never leave the host unless the host explicitly exports them.

`context` accepts only `{query: {...}, locale: 'en-GB', actions: {...}}`. Actions must be HTTPS or a safe absolute local path and fill an entire quoted `href`, `action` or `formaction`. Query/locale values in URLs need an author-controlled host or path prefix. Empty/missing runtime values render as empty text.

Limits include 2 MiB expanded source, 20,000 expanded lines, 12 include levels, 100 pages, 200 fields, six custom-type nesting levels, 50 repeater items, 10,000 normalized/default values, 100,000 render operations, 8 MiB HTML per page, 500 files and 32 MiB per imported/generated project. Rich text is limited to 100,000 bytes, sanitized nesting to 32, and Markdown delimiters to 1,000 per line.

Run `npm test --workspace=@trafficops/template-runtime` from the root. PHP differential fixtures run when the root Composer autoloader and PHP are available; CI also runs them explicitly after installing Composer dependencies.
