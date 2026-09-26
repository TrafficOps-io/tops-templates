# tops-templates

The TrafficOps Template Language (TPL) and its toolkit: the PHP reference
implementation, a portable JavaScript runtime, a CLI, Template Studio, a VS Code
extension and agent skills. Templates are data: typed fields plus a values
document render to static HTML.

## Language

### Naming

**TrafficOps Template Language**:
The language of `.tpl` files, abbreviated TPL. It is not specific to Fast
Landings.
_Avoid_: Fast Landings TPL, fast-landings-tpl

**Template Studio**:
The browser editor for template and landing projects.
_Avoid_: Landing Studio, the editor

**Language version**:
The number declared in `@template version=N`. Adding directives or field types
stays within a version; only an incompatible change raises it. Readers reject
versions they do not know.

### Templates and projects

**Template source**:
A `.tpl` file written by an author.
_Avoid_: template (unqualified)

**Definition**:
The normalized form of a template after parsing. It is the only form the engine
validates values against and renders.
_Avoid_: normalized JSON, schema, template

**Project**:
A set of template sources and assets treated as one unit. `index.tpl` is the
entry when present.
_Avoid_: package, bundle

**Template project / Landing project** (Studio):
The two kinds of Studio project. A landing project is an independent copy of a
template project with its own values; it never updates from the template it was
copied from.

**Page**:
A template source with a layout that becomes one output HTML file. All pages of
a project render with the same values.

**Include**:
A template source expanded into another at parse time. Included sources never
become pages.
_Avoid_: fragment, partial (which is the JSON-only mechanism)

**Asset**:
A non-template file of a project, copied to the output byte for byte.

**Dialect**:
The host's policy layer over the language: allowed paths, extra directives and
how runtime tokens are treated. When no dialect is named or the name is unknown,
the safe dialect applies.
_Avoid_: profile, mode

### Fields and values

**Field**:
A typed editable value declared with `@param`. The directive keyword stays
`@param`; the concept is a field.
_Avoid_: param, parameter, setting, content

**Values**:
The document of field values a project renders with. Unknown keys are dropped
with a warning; unset optional fields render empty rather than as a type
default.
_Avoid_: data, settings

**Section**:
A named grouping of fields in the editor form. Fields outside any section fall
into the general section.
_Avoid_: block, tab

**Group**:
A field whose type is a declared record (`@type Card`, used as `Card`).
_Avoid_: block, object field

**Repeater**:
A field holding a list of groups (`Card[]`), bounded by min and max items.
_Avoid_: list, array field

**Rich text**:
A Markdown or WYSIWYG field. Stored as the author entered it and sanitized at
render time.

### Rendering

**Expression**:
A `{{…}}` construct in a layout that inserts a value.

**Conditional / Iteration**:
The `{{#x}}…{{/x}}` and `{{^x}}…{{/x}}` constructs: a conditional when `x` is a
scalar or group, an iteration when `x` is a repeater.
_Avoid_: section (for these), mustache section

**Block**:
A parse-time macro declared with `@block` and expanded with `@render`.
_Avoid_: component, group

**Runtime token**:
A placeholder such as `{query.name}` resolved at HTTP request time by the host,
not at generation time.
_Avoid_: runtime variable, macro

**Portable runtime**:
The JavaScript implementation of parsing and rendering used by the CLI and
Template Studio. It must give the same result as the PHP reference or be
stricter.
_Avoid_: runtime (unqualified), JS engine

**Generate**:
Render every page of a project with one values document and copy its assets.
_Avoid_: build, compile, export
