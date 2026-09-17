# Template language

A source file is UTF-8 text. Directives begin with `@` on their own line, page markup belongs inside `@layout`, and values are inserted with Mustache-like expressions. The language deliberately has no arbitrary functions or code execution.

## File structure

```tpl
@template "Product page" version=1 description="A product card"

@section main "Main"
@param title String label="Name" required
@param description Markdown label="Description"
@param price Number min=0 step=0.01
@param available Boolean = true
@endsection

@layout
<article>
  <h1>{{title}}</h1>
  <div>{{& description}}</div>
  @if available
    <p>{{price}}</p>
  @endif
</article>
@endlayout
```

Each page contains exactly one `@layout … @endlayout` block. A project may contain several pages; their fields, author-defined types, and reusable blocks form one shared schema.

## Parameters and built-in types

The declaration form is:

```tpl
@param name Type option="value" required
```

| Author type | Value | Common options |
| --- | --- | --- |
| `String` | short text | `label`, `help`, `required`, `default` |
| `Text` | multiline text | `label`, `help`, `required` |
| `Markdown`, `Wysiwyg` | formatted text | `label`, `help`, `required` |
| `Color` | CSS color | `default` |
| `Number`, `Range` | number | `min`, `max`, `step` |
| `Boolean` | flag | `default=true` or `default=false` |
| `Image` | relative project path | `aspect_ratio` or `sizes` |
| `Url`, `Email` | URL or email address | `required` |
| `Select` | one declared value | `options` value/label pairs |

`="value"` is shorthand for `default="value"`. Known options are type-specific: `min` on a `String`, for example, is an error rather than ignored metadata.

## Author-defined types and repeaters

```tpl
@type Card
@param title String required
@param body Text
@param link Url
@endtype

@param featured Card
@param cards Card[] min_items=1 max_items=6
```

`Card` creates a group and `Card[]` creates a list of groups. Recursive types are rejected, and both nesting depth and item count are bounded.

## Reusable blocks

A block is a typed authoring macro expanded while the source is parsed:

```tpl
@block card(item: Card)
<article>
  <h2>{{item.title}}</h2>
  <p>{{item.body}}</p>
  <a href="{{item.link}}">Learn more</a>
</article>
@endblock

@layout
<section class="cards">
  @each item in cards:
    @render card(item)
  @endeach
</section>
@endlayout
```

`@render` arguments are type-checked. Recursive and excessively deep calls are rejected.

## Conditions and loops

```tpl
@if showHero
  <section>{{title}}</section>
@endif

@each item in cards:
  <p>{{item.title}}</p>
@endeach
```

Paths resolve from the current lexical scope. `../name` selects a parent scope and `@root.name` selects the root.

## Output expressions

| Expression | Behavior |
| --- | --- |
| `{{name}}` | Insert an HTML-escaped scalar. |
| `{{& name}}` | Render sanitized `Markdown` or `Wysiwyg`. |
| `{{#name}}…{{/name}}` | Render a truthy section, group, or repeater. |
| `{{^name}}…{{/name}}` | Render an inverse section. |
| `{{>partial}}` | Insert a named partial from a JSON definition. |

Values are never scanned a second time. A value containing `{{other}}` remains text and cannot become another expression.

## Includes and multiple pages

```tpl
@include "shared/fields.tpl"
```

The host supplies a callback that resolves includes from an authorized source collection. A safe relative name does not by itself authorize a filesystem path, symlink, archive entry, or network location.

In directory mode the CLI discovers `.tpl` and `.tpl.html` pages after include expansion. Included fragments do not become standalone pages. `index.tpl` becomes `index.html`, while `thanks.tpl.html` becomes `thanks.html`.

## Runtime tokens

The `safe-html-v1` dialect supports:

```tpl
<p lang="{locale}">Campaign: {query.campaign}</p>
<a href="{actions.continue}">Continue</a>
```

The host supplies explicit context:

```json
{
  "locale": "en",
  "query": {"campaign": "autumn"},
  "actions": {"continue": "/flow/continue"}
}
```

Query and locale values are escaped for their HTML placement. An action must occupy the whole quoted `href`, `action`, or `formaction` value and must be HTTPS or a safe absolute local path.

## Limits and compatibility

The parser bounds source size, include and block depth, page and field counts, render operations, and output size. A dialect may narrow these limits but cannot bypass them.

See [Language v1](../language-v1.md) for the normative contract. The browser and CLI implement a [portable subset](https://github.com/TrafficOps-io/tops-templates/tree/main/runtime); PHP field aliases and application-owned dialects require the PHP engine.
