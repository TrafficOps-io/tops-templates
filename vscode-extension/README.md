# TrafficOps Templates for VS Code

Syntax highlighting, IntelliSense and a formatter for the **TrafficOps Template Language** (TPL), the language of `.tpl` files rendered by the `trafficops/template-dsl` PHP package, the portable JavaScript runtime, the CLI and Template Studio. Record types such as `Comment` are declared by the template author with `@type`; the extension reads those declarations and the files pulled in through `@include`.

Extension id: `trafficops-io.tops-templates`, version 0.1.0, workspace package `tops-templates` in this monorepo. The language id, settings namespace and snippets file still carry their historical `fast-landings` names; see [Planned rename](#planned-rename).

## Features

- Highlighting of directives, types, fields, blocks, values and `{{ expressions }}` together with HTML, CSS and JavaScript.
- Directive completion and snippets for the template header, sections, types, blocks, loops and conditions.
- Built-in and author-defined types after `@param` and in `@block` arguments.
- `Wysiwyg` and `Markdown` fields: highlighting and completion of `{{& path}}`, hover and Go to Definition for formatted output.
- Record members after a dot: `{{ comment.author. }}` lists the fields of the `Author` type.
- Block arguments and loop aliases with correct nesting and lexical scope.
- Completion of block names and type-matching arguments in `@render`, plus signature help.
- Field options: `label`, `help`, `aiInstructions`, `required`, numeric bounds, `Select` options, repeater bounds, `aspect_ratio` and `sizes` for images.
- `aiInstructions` on fields and blocks: highlighting, completion and the instruction text on hover.
- Optional `previewData` and `previewUrl`: hints, JSON validation, highlighting and formatting of the preview block.
- `@include` paths, Go to Definition, hover, Outline and folding.
- Unsaved edits in open files take part in analysis immediately.
- **Format Document** and format on save for TPL declarations plus embedded HTML, CSS and JavaScript through bundled Prettier.
- Two host-selected dialects: the safe shared `safe-html-v1` and the trusted `fast-landings-v1`.

## Installation

Download the `.vsix` file from [GitHub Releases](https://github.com/trafficops-io/tops-templates/releases) and run **Extensions: Install from VSIX…**. To build it from the repository root:

```sh
npm ci
npm run build:vsix
code --install-extension vscode-extension/dist/tops-templates-0.1.0.vsix
```

The extension supports VS Code **1.85+**. Development and packaging need Node.js **22+**. No Marketplace account is required to install a VSIX.

## Getting started

Files named `*.tpl`, `*.tpl.html`, `*.tpl.txt` and `*.tpl.php` open in **TrafficOps Templates** mode. Plain `.html`, `.txt` and `.php` files switch to it automatically when they start with an `@template` declaration (`fastLandingsTemplates.autoDetect`); other HTML files keep their mode. `.tpl.php` sources belong to the `fast-landings-v1` dialect only; the safe dialect reports them as a diagnostic.

For a file with another name, pick **TrafficOps Templates** in the language picker or run the command **Use TrafficOps Templates Language**. Explicit associations can be configured per project:

```json
{
  "files.associations": {
    "templates/**/*.html": "fast-landings-tpl"
  }
}
```

Open `examples/template.tpl` together with `examples/blocks/comment.tpl`, then press **Ctrl+Space** after the dot in `{{ comment.author. }}` to see the fields of the author type.

```html
@template "Comments" version=1

@type Comment
  @param author String = "Guest" label="Author"
  @param body Text label="Comment"
@endtype

@param comments Comment[] min_items=1 max_items=20

@block commentItem(comment: Comment)
  <article>
    <h3>{{ comment.author }}</h3>
    <p>{{ comment.body }}</p>
  </article>
@endblock

@layout
  <section>
    @each comment in comments:
      @render commentItem(comment)
    @endeach
  </section>
@endlayout
```

Directives sit on their own lines. Language version 1 has `@if … @endif` and `@unless … @endunless` but no `@else`. The complete language contract is [docs/language-v1.md](../docs/language-v1.md).

## Dialects

The host application or the workspace selects the dialect through `fastLandingsTemplates.dialect`. Template text can never raise its own capabilities or switch the dialect. The default, and the fallback for an unknown identifier, is `safe-html-v1`; an unknown identifier is reported as a warning on the first line of each document. `fast-landings-v1` is only for an external application that ships a trusted executable dialect.

- `safe-html-v1` is the non-executable shared dialect. Only the runtime tokens `{query.name}`, `{locale}` and `{actions.name}` are available. `@validation`, `headers`, `body`, wildcard tokens, PHP and `.tpl.php` sources are diagnosed as unavailable.
- `fast-landings-v1` is the trusted Fast Landings dialect: PHP blocks, `@validation` and `{query…}`, `{headers…}`, `{body…}` including nested paths and `*`.

For a project built on the shared `template-dsl` package:

```json
{
  "fastLandingsTemplates.dialect": "safe-html-v1"
}
```

## Template preview

To generate a preview image, provide an optional JSON object with sample field values. Declare the block at the top level, outside `@type`, `@section`, `@block` and `@layout`:

```html
@template "Comments" version=1
@previewData
{
  "title": "Stories from our readers",
  "comments": [{ "author": "Anna", "body": "Thanks for the detailed review!" }]
}
@endpreviewData

@param title String = "New headline"
```

`previewData` is used for the preview only and does not change the default values of a landing created from the template. The values must match the template's fields, including nested records and lists; a key that names no field is a definition error. One block or the short header form is allowed: `@template "Comments" version=1 previewData='{"title":"Demo"}'`. In the header form, JSON backslashes must be escaped again under the TPL string rules; the multi-line block contains plain JSON.

If a public preview exists, add `previewUrl="https://example.com/demo"` to the `@template` line. A public HTTP(S) page or image URL takes precedence over `previewData` when the preview is generated. The server checks that the address is reachable and allowed.

The snippets `tpl-preview-data` and `tpl-preview-url` insert ready-made declarations. The formatter formats the JSON separately, preserves its values and does not interpret HTML or `{{…}}` inside strings. An invalid or unclosed block is left unchanged. The extension flags JSON errors, a duplicate `previewData`, a missing closing directive and a malformed URL. Field conformance and URL safety are finally checked by the host.

## Images: aspect ratio and sizes

`Image` fields accept two mutually exclusive options:

```html
@param cover Image label="Cover" aspect_ratio="16:9"
@param avatar Image label="Avatar" sizes="128x128|256x256"
```

`aspect_ratio` sets the crop ratio; a number such as `1.5` is also accepted. `sizes` lists exact output sizes in pixels. Once one option is present, the other is no longer suggested. Completion works inside `@type` as well, including fields of repeated records.

The snippets `tpl-image-ratio` and `tpl-image-sizes` insert ready-made declarations. Highlighting recognizes option names and values, and the formatter keeps the declaration on one line without changing its values. Range and size validation is performed by the host when the template is imported; the extension does not replace it.

## AI instructions

Add `aiInstructions="…"` to a field declaration or after the arguments of a block:

```html
@type Article
  @param title String aiInstructions="Write a short headline."
  @param body Text aiInstructions="Use plain language.\nSplit the text into paragraphs."
@endtype
@param article Article aiInstructions="Keep the headline and body consistent."
@param related Article[] aiInstructions="Each entry covers a distinct topic."

@block articleBody(value: Article) aiInstructions="Start with a brief introduction."
  <h1>{{value.title}}</h1>
  <p>{{value.body}}</p>
@endblock
```

Completion offers the option on every `@param`, including inside `@type`, and after the closing parenthesis of `@block`. An option that is already present is not offered again. The snippet `tpl-ai-instructions` inserts the annotation, and hovering a field or block shows its text. The formatter preserves quotes, spaces and escape sequences in the instruction.

Hosts store the instructions as template metadata: on fields as `aiInstructions`, on named blocks as `blocks.<name>.aiInstructions`. A UTF-8 string of up to 10,000 bytes is allowed, including an empty one. The declaration stays on one line; use `\n` for a line break inside the instruction. The annotation by itself does not trigger AI generation and does not change HTML or field values.

## WYSIWYG and Markdown

```html
@param body Wysiwyg = "<p>Text with <strong>formatting</strong>.</p>" label="Article"
@param details Markdown = "## Details\n\n![Photo](assets/photo.jpg)" label="Details"

@layout
  <article>{{& body}}</article>
  <aside>{{& details}}</aside>
@endlayout
```

`{{& path}}` outputs sanitized HTML from a `Wysiwyg` or `Markdown` field; a plain `{{path}}` escapes the stored string. Values are stored exactly as the author entered them and sanitized when rendered. Use formatted output inside `article`, `div`, `section` and similar body containers. Attributes, `script`, `style` and a wrapping `p` are not suitable; triple braces are not supported.

Completion works after `&` and after a dot, including fields of `@type` records, block arguments, loop aliases and declarations from `@include`. In formatted expressions the editor offers rich-text fields and records that contain them. Primitive aliases from `customTypes` are available too; the host checks whether an alias maps to an editor, because the extension does not execute PHP type registration.

Snippets: `tpl-wysiwyg`, `tpl-markdown`, `tpl-rich-value`. See `examples/rich-text/template.tpl` for an included type, a block and repeated articles. The formatter preserves HTML/Markdown values, image references and `{{& …}}` expressions.

Image insertion and upload happen in the host's editors; they are not TPL options and need no VS Code configuration. In the CLI and Template Studio, images are referenced by relative paths and nothing is uploaded.

## Request tokens and validation (fast-landings-v1)

Values of the current HTTP request are available through single braces: `{query.subid}`, `{headers.user-agent}`, `{body.name}`. Nested paths such as `{body.customer.name}` are supported; `{query.*}`, `{headers.*}` and `{body.*}` output the whole source as JSON. `{{title}}` still reads the stored template field.

Declare rules at the top level of the page they apply to, for example in `index.tpl.php`:

```html
@validation query fallback="/error"
  @param subid String required
  @param pixel String length=10 required
@endvalidation
```

A submitted form can be checked in `success.tpl.php`:

```html
@validation body fallback="submit-error"
  @param phone String required mask="+380 ... ... ..."
  @param name String required min=4
@endvalidation

@layout
  <p>Thank you for your order, {body.name}! We will call you back on {body.phone}.</p>
@endlayout
```

Request types are `String`, `Number`, `Integer` and `Boolean`. `required` demands a value; `min` and `max` bound the string length in Unicode characters or the numeric value. `length` sets an exact string length; the historical spelling `lenght` is accepted as an alias. In a string `mask`, each dot matches one digit and every other character must match literally. Header names are case-insensitive. The optional local `fallback` redirects an invalid request before the page renders; without it the server answers `422 Invalid request.`.

Fields inside `@validation` belong to the HTTP request: they do not create landing fields. Rules and completions apply to their own page and its explicitly included files; neighbouring pages do not inherit them. Tokens are also allowed inside a landing's values, for example `Thanks, {body.name}!`; such a string is substituted when a visitor requests the page.

Completion after `{` offers the sources, and after a dot the declared fields, nested paths, common headers and `*`. Go to Definition, hover with type and rules, Outline and folding of `@validation` are supported. Snippets: `tpl-validation` and `tpl-macro`. Examples live in `examples/runtime/`.

A literal token is escaped with a backslash: `\{body.name}`. Request values may appear in text and in safe HTML attributes; `script`, `style` and event handlers are not suitable. For JavaScript, pass the value through a `data-*` attribute and read it from the DOM.

PHP blocks `<?php … ?>` and `<?= … ?>` are opaque to TPL: their contents create no fields or token completions, and the formatter leaves the code unchanged. Tokens are written in the template markup outside PHP. PHP strings, comments and heredocs are preserved as well.

## Formatting

Run **Format Document** (macOS: **Shift+Option+F**, Windows/Linux: **Shift+Alt+F**). The whole file is formatted with the nesting of `@type`, `@section`, `@block`, `@layout`, `@if`, `@unless`, `@each` and `@validation` taken into account. Inside markup, HTML, `<style>` and `<script>` are formatted. Indent size and tabs/spaces follow the current editor settings.

For format on save, add to your VS Code settings:

```json
{
  "[fast-landings-tpl]": {
    "editor.defaultFormatter": "trafficops-io.tops-templates",
    "editor.formatOnSave": true,
    "editor.insertSpaces": true,
    "editor.tabSize": 2
  },
  "fastLandingsTemplates.format.enable": true,
  "fastLandingsTemplates.format.printWidth": 100
}
```

`@param` and the other TPL declarations stay on one line: a line break would change their meaning to the compiler. Quoted values, interpolations and the contents of `pre`/`textarea` are preserved. If a passage is still incomplete and cannot be parsed, the formatter keeps its original text.

For an element whose text formatting is special, for example `white-space` set through an external CSS class, put `<!-- prettier-ignore -->` before the opening tag and its contents are left as they are. `pre`, `textarea` and elements with an explicit inline `white-space: pre`, `pre-wrap`, `pre-line` or `break-spaces` are protected automatically.

Prettier and the required HTML/CSS/JavaScript parsers ship inside the VSIX. Neither a separate Prettier extension nor npm dependencies in the template project are needed. The formatter does not load or execute configuration files or plugins from the workspace; `.prettierrc` is not used, the settings above apply.

## Included files

`@include "blocks/comment.tpl"` is always resolved relative to the template package root, also from nested includes. The root is the nearest `template.html`, `template.txt`, `template.tpl`, `index.tpl` or `index.tpl.html` (and `index.tpl.php`, `template.tpl.php` in the trusted dialect) that includes the current file. The search is limited to the open workspace; a file outside the workspace uses its own folder.

Declarations of a neighbouring template that is not connected through `@include` do not leak into completions. A missing or unfinished include does not block editing of the other files. Sources are read as text and never executed.

## Settings

```json
{
  "fastLandingsTemplates.dialect": "safe-html-v1",
  "fastLandingsTemplates.autoDetect": true,
  "fastLandingsTemplates.customTypes": ["Headline", "Spacing"],
  "emmet.includeLanguages": {
    "fast-landings-tpl": "html"
  }
}
```

`customTypes` is only needed for primitive aliases registered by the application developer in `TemplateFieldTypes`. Record types from `@type` are discovered automatically and need not be listed. Emmet is optional. The extension does not replace the full HTML/CSS/JavaScript language services: IntelliSense is provided for TPL, and the built-in TextMate grammars highlight markup, styles and scripts.

## Planned rename

The language is the TrafficOps Template Language, but several identifiers still carry the historical Fast Landings name. Renaming them is a breaking change for user settings, `files.associations` and Marketplace metadata, so it is tracked separately and will ship in a dedicated release with a migration note. The planned mapping is:

| Today | Planned |
| --- | --- |
| Language id `fast-landings-tpl` | `tops-tpl` |
| Grammar scope `text.html.fast-landings-tpl`, injection `fast-landings-tpl.injection` | `text.html.tops-tpl`, `tops-tpl.injection` |
| Grammar file `syntaxes/fast-landings-tpl.tmLanguage.json` | `syntaxes/tops-tpl.tmLanguage.json` |
| Snippets file `snippets/fast-landings-tpl.json` | `snippets/tops-tpl.json` |
| Settings `fastLandingsTemplates.dialect`, `.autoDetect`, `.customTypes`, `.format.enable`, `.format.printWidth` | `topsTemplates.dialect`, `.autoDetect`, `.customTypes`, `.format.enable`, `.format.printWidth` |
| Command `fastLandingsTemplates.setLanguage` (category "Fast Landings") | `topsTemplates.setLanguage` (category "TrafficOps") |
| Configuration default block `[fast-landings-tpl]` | `[tops-tpl]` |

The dialect identifier `fast-landings-v1` is not part of this rename: it names the trusted application dialect and stays as documented in [docs/dialects.md](../docs/dialects.md).

## Development and checks

```sh
npm run check --workspace=tops-templates
npm test --workspace=tops-templates
npm run test:integration --workspace=tops-templates
npm run test:runtime --workspace=tops-templates
npm run package --workspace=tops-templates
```

Open this package's folder in VS Code and press **F5** to start an Extension Development Host with the examples.

Unit tests cover the formatter, semantic completions, includes and real TextMate tokenization through Oniguruma. Integration tests start a separate Extension Host with temporary workspaces, profile and extensions directory, and also check Format Document, format on save and indentation settings. On macOS the installed `/Applications/Visual Studio Code.app` is used; for another installation set `VSCODE_EXECUTABLE_PATH`. If no local executable is found, the official `@vscode/test-electron` downloads a stable VS Code. `TPL_EXTENSION_PATH` allows testing an extension extracted from a VSIX outside the monorepo.

`test:runtime` needs PHP with the DOM extension and the Composer dependencies installed at the repository root. It compiles templates before and after formatting with the real PHP parser and renderer and compares form, values, markup, CSS and the behaviour of the test JavaScript.

`@trafficops/template-language` contains the TPL analyzer without any VS Code API, `src/projects.js` resolves the include graph through `workspace.fs`, `@trafficops/template-language/formatter` formats TPL and the embedded languages, and `src/extension.js` wires up the editor providers. `npm run build` bundles them together with Prettier into `build/extension.js`; the VSIX ships that bundle and the Prettier licence without depending on the user's `node_modules`. Highlighting lives in `syntaxes/`, snippets in `snippets/`.

The extension follows language version 1. When the language grows, update the directive/type catalogue, the analyzer, the grammar and the corresponding tests together; the PHP reference implementation remains the final authority on template validity.
