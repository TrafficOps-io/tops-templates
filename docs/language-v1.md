# Template language version 1

This document describes the version 1 authoring language and normalized definition consumed by `TemplateEngine`. The PHP implementation is authoritative for validation and byte limits. The keywords “must”, “must not” and “may” describe compatibility requirements for templates and hosts.

## Source model

Source is UTF-8 text. A directive begins with optional whitespace followed by `@` and an identifier on its own line. Prefix a directive-looking line with `@@` to emit a literal leading `@`. Quoted arguments may use single or double quotes and backslash escapes.

Every page source must contain exactly one `@layout` block. Settings, author-defined types and blocks are shared when `parsePages()` parses several sources. The entry source supplies `html`; the remaining sources become `pages`.

```tpl
@template "Campaign page" version=1 description="A small example"

@section content "Content"
  @param headline String required label="Headline"
  @param body Markdown label="Body"
  @param target Url label="Destination"
@endsection

@type Card
  @param title String required
  @param copy Text
@endtype

@param cards Card[] min_items=1 max_items=6

@block card(item: Card) aiInstructions="Render one card"
  <article>
    <h2>{{item.title}}</h2>
    <p>{{item.copy}}</p>
  </article>
@endblock

@layout
  <main>
    <h1>{{headline}}</h1>
    <div>{{& body}}</div>
    @each card in cards:
      @render card(card)
    @endeach
  </main>
@endlayout
```

## Top-level declarations

### `@template`

`@template "Name"` sets definition metadata. It may appear once and accepts:

- `version=1`;
- `description="..."`;
- `previewData="{...}"`, containing a JSON object;
- `previewUrl="https://..."`, containing a public absolute HTTP(S) URL without credentials and using port 80 or 443.

The declaration is optional; defaults are version 1 and the name `Imported template`. A block form of preview data is also available:

```tpl
@previewData
{ "headline": "Preview" }
@endpreviewData
```

Only one preview-data declaration is allowed. Preview data is validated against the normalized fields; the package does not fetch `previewUrl`.

### `@section` and `@param`

Sections group editor fields:

```tpl
@section identity "Identity"
  @param brand String label="Brand" required
@endsection
```

The section identifier starts with a letter and contains letters, digits or underscores. A parameter outside a section is placed in an implicit `general` section.

The parameter form is `@param name Type`, followed by zero or more options:

- `label`, `help` and `aiInstructions` provide authoring metadata;
- `required` or `required=true|false` controls value presence;
- `="value"` and `default="value"` are equivalent;
- `options="value:Label|other:Other"` defines `Select` choices;
- `min`, `max` and `step` constrain `Number` and `Range`;
- `min_items` and `max_items` constrain a custom `Type[]` repeater;
- `aspect_ratio="16:9"` or `sizes="1200x630|1080x1080"` constrains `Image`; the two forms are mutually exclusive.

Built-in author types are:

| Author type | Normalized type |
| --- | --- |
| `String` | `text` |
| `Text` | `textarea` |
| `Wysiwyg` | `wysiwyg` |
| `Markdown` | `markdown` |
| `Color` | `color` |
| `Number` | `number` |
| `Range` | `range` |
| `Boolean` | `checkbox` |
| `Image` | `image` |
| `Url` | `url` |
| `Email` | `email` |
| `Select` | `select` |

Applications may register additional author-type aliases with `TemplateFieldTypes`. Their normalized output must still satisfy the engine's supported field contract.

Reserved field options are type-specific: `options` belongs to `Select`, `min`/`max`/`step` to `Number` and `Range`, `min_items`/`max_items` to repeaters, `fields` to groups and repeaters, and image crop options to `Image`. Known options on other types are rejected rather than retained as inactive metadata. Application-specific metadata may use distinct keys and must remain JSON-serializable.

### `@type`

An author-defined type groups parameters. Appending `[]` at a use site creates a repeater:

```tpl
@type Link
  @param label String required
  @param url Url required
@endtype

@param footer Link
@param navigation Link[] min_items=1 max_items=10
```

Type names begin with a capital letter. Recursive types are rejected, nested fields are bounded, and only `@param` declarations are accepted inside a type.

### `@block` and `@render`

Blocks are typed authoring macros expanded while the source is parsed. They are not runtime code:

```tpl
@block link(item: Link)
  <a href="{{item.url}}">{{item.label}}</a>
@endblock

@layout
  @each item in navigation:
    @render link(item)
  @endeach
@endlayout
```

Block calls are type-checked. Unknown, recursive and excessively deep calls are rejected. `aiInstructions` is the only block option; it is retained as definition metadata when present.

### `@layout`, `@if` and `@each`

HTML belongs inside one `@layout … @endlayout` block per page. `@if path … @endif` emits a truthy section. `@each alias in path: … @endeach` iterates a repeater of an author-defined type. Paths use dot notation and are resolved lexically; block arguments cannot escape their scope.

CSS at-rules commonly found at the start of a line, including `@media`, `@supports`, `@font-face` and `@keyframes`, are treated as markup inside layout or block bodies.

### `@include`

`@include "fragment.tpl"` expands source through the callback passed by the host. Include paths must be bounded, safe relative paths and pass the selected dialect's source-path policy. Cycles and excessive depth are rejected.

The resolver must authorize the returned content. Passing the initial path check does not authorize a filesystem location, resolve symlinks, perform archive validation or permit network access.

## Render expressions

The compiled definition uses a deliberately small Mustache-like expression set:

- `{{name}}` inserts an HTML-escaped scalar setting;
- `{{& name}}` renders sanitized `Markdown` or `Wysiwyg` content;
- `{{#name}}...{{/name}}` renders truthy values, enters groups and iterates repeaters;
- `{{^name}}...{{/name}}` renders when the value is falsey;
- `{{>partialName}}` inserts a named definition partial;
- `../name` selects a parent scope and `@root.name` selects the root scope.

Expressions are data lookups, not general code. Object or list settings cannot be interpolated as scalars, and formatted output is restricted to rich-text field types. Partials exist in JSON definitions; source-level reuse normally uses typed blocks and includes.

The common engine never rescans settings for directives, Mustache expressions or safe-runtime tokens. An application-owned post-render runtime may deliberately define another phase; for example, the documented trusted `fast-landings-v1` profile permits request tokens in stored string settings. Such behavior belongs to that dialect's threat model, not language version 1 or the safe default.

## Default safe runtime

The `safe-html-v1` dialect recognizes these single-pass runtime tokens in author source:

- `{query.name}` from an explicit host-provided scalar map;
- `{locale}` from an explicit language tag;
- `{actions.name}` from an explicit host-provided action map.

Missing query or action names become empty text. Runtime context accepts only `query`, `locale` and `actions`; each map is bounded. It does not expose headers, request bodies, wildcard lookup, a request object, environment variables, secrets or the service container.

Tokens are HTML-escaped in text and supported quoted content attributes. Query and locale tokens in URL attributes are URL-encoded and require a fixed HTTP(S) host or safe path prefix before the token. An action token must be the whole quoted value of `href`, `action` or `formaction`, and its supplied value must be HTTPS or a safe absolute local path. Tokens cannot create tags, attribute names, unquoted attributes, scripts, styles, comments or declarations. Runtime-bearing templates also reject legacy HTML comment syntax inside script elements, whose browser tokenizer states are intentionally outside the supported markup profile.

## Normalized definition

A validated version 1 definition always contains:

- `version: 1`;
- non-empty `name` and possibly empty `description`;
- a list of normalized `sections` and fields;
- entry-page `html`;
- an object of named `partials`.

It may also contain `entrypoint`, `pages`, `source`, `blocks`, `previewUrl` and validated `previewData`. `entrypoint` defaults to `index.html`; it is materialized together with `pages` when either is needed. Root, section and block objects are normalized to documented properties. Field objects may retain metadata produced by an application-registered author-type alias, but only the documented properties are portable between hosts.

The [definition schema](../template-dsl/resources/schema/template-definition-v1.schema.json) describes the normalized structure. The engine remains authoritative because JSON Schema length is measured in characters while implementation limits are UTF-8 bytes, cross-field uniqueness and aggregate budgets require code, and dialect path/runtime rules are host-selected.

## Bounds

Hard bounds defend both import and rendering. Current version 1 limits include:

- source expansion up to 2 MiB and 20,000 lines, bounded include depth and at most 100 page sources;
- definition JSON up to 8 MiB, at most 50 sections and 200 fields nested at most six levels;
- at most 100 additional pages, 50 partials and 200 block annotations;
- 2 MiB per page or partial and 4 MiB combined page/partial source;
- at most 50 items per repeater and 10,000 normalized setting values;
- bounded source expressions, block expansion, partial chains, rendering operations and nesting;
- rendered output capped at 8 MiB, or a lower host-configured ceiling.

These are ceilings, not capacity promises. Hosts should apply tighter upload, archive and publication quotas appropriate to their service. Dialects cannot raise or bypass core budgets.

## Versioning

The integer `version` identifies the stored language/definition contract independently of the Composer package version. Readers must reject unsupported language versions. Backward-compatible clarifications may keep version 1; a change that makes a previously valid definition mean something different requires a deliberate migration and normally a new language version.
