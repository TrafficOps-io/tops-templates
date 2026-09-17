# Template DSL

`trafficops/template-dsl` is a bounded template language for Laravel applications. It parses a versioned authoring format into typed settings and page definitions, validates submitted values, and renders HTML. Applications may select a dialect, but template source can never select or elevate its own dialect.

The package ships with `safe-html-v1` as the default. It accepts HTML output only, rejects PHP, Blade and request-validation source, and exposes the explicit runtime tokens `{query.name}`, `{locale}` and `{actions.name}`. The package also exposes dialect contracts for trusted host integrations; no executable dialect ships in this package.

## Requirements

- PHP 8.4 or later
- Laravel/Illuminate 12
- DOM and Mbstring PHP extensions

Install it through Composer once this package is available to your project:

```sh
composer require trafficops/template-dsl
```

Laravel package discovery registers `TemplateDslServiceProvider` automatically.

## Quick start

```php
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateSourceParser;

$parser = app(TemplateSourceParser::class);
$engine = app(TemplateEngine::class);

$definition = $engine->validateDefinition(
    $parser->parse($source, filename: 'index.tpl.html'),
);
$values = $engine->validateValues($definition, $submitted);

// Apply the host application's document-level HTML/CSS and asset policy
// before publication. The DSL is not a complete HTML sanitizer.
$html = $engine->render($definition, $values, [
    'query' => ['campaign' => 'spring'],
    'locale' => 'en',
    'actions' => ['continue' => '/flow/continue'],
]);
```

Includes use an explicitly supplied callback. The package validates the include name before invoking it; the callback remains responsible for resolving only files from an application-authorized source collection, without unrestricted filesystem or network access.

## Public integration surface

- `TemplateSourceParser` parses one source, a page set, or discovers included paths.
- `TemplateEngine` parses JSON definitions, normalizes definitions and values, supplies defaults and field lookup, previews rich text, and renders one or all pages.
- `TemplateFieldTypes` registers application field aliases; `TemplateRichText` provides the package's bounded formatted-content behavior.
- `TemplateDialect`, `PreparedSource`, `DirectiveExtraction`, `SourcePhase` and `TemplateRuntimeStrategy` are the dialect extension surface.
- `SafeTemplateDialect` and `SafeRuntimeStrategy` implement the default; `LiteralRuntimeStrategy` is available to a trusted host that deliberately performs a later runtime phase.

Low-level compiler and safety helpers are exposed for package and dialect integration, but should not be used to bypass parser or engine validation. The first public releases are expected to use `0.x`; consult the changelog for compatibility notes, and treat named constructor arguments as API.

## Language and definition

The source language supports `@template`, `@previewData`, `@section`, `@param`, `@type`, typed `@block`/`@render`, `@layout`, `@each`, `@if` and `@include`. Built-in author types cover text, formatted text, numeric, boolean, image, URL, email, select, group and repeater settings.

The parser produces a version 1 definition containing normalized settings, HTML, optional pages and partials, block annotations, preview metadata and author-type annotations. The runtime validator is authoritative; the bundled [JSON Schema](resources/schema/template-definition-v1.schema.json) is a structural interoperability aid.

See [Language v1](docs/language-v1.md) for syntax and rendering semantics.

## Dialects

`TemplateDialect` controls path policy, source preparation, directive extraction, final page assembly and the runtime strategy. `PreparedSource` carries protected fragments and metadata across phases, while `DirectiveExtraction` carries filtered tokens and page metadata. `TemplateRuntimeStrategy` controls runtime-node compilation and rendering.

The service provider binds `TemplateDialect` to `SafeTemplateDialect`. A trusted application can replace the binding explicitly:

```php
use TrafficOps\TemplateDsl\TemplateDialect;
use App\Templates\ApplicationTemplateDialect;

$this->app->singleton(
    TemplateDialect::class,
    ApplicationTemplateDialect::class,
);
```

The parser and engine must use the same host-selected dialect. Selecting a more permissive dialect is a deployment privilege decision, never template metadata. The bundled [dialect profiles](resources/dialects) describe capabilities for tooling and compatibility tests; they are not executable configuration. `fast-landings-v1` documents an application-owned trusted dialect and is not implemented by this package.

See [Dialect integration](docs/dialects.md) and the [threat model](docs/threat-model.md) before implementing a dialect.

## Security boundary

Core path, size, nesting, token, expansion and rendered-output budgets apply to every dialect. The safe runtime accepts only explicit scalar maps, never a request object, headers, body, secrets, wildcard paths or container lookups. Settings and runtime values are single-pass data and are not rescanned as expressions.

The package escapes ordinary inserted values and sanitizes the supported Markdown/WYSIWYG fields. It does not make arbitrary author HTML, CSS, URLs or assets safe as a whole. The host must enforce its own document allowlist, asset ownership, CSP, action binding, archive limits and publication policy.

Read [SECURITY.md](SECURITY.md) before accepting untrusted templates.

## Development

```sh
composer install
composer check
```

`composer check` validates package metadata, checks formatting, runs the PHPUnit suite and audits installed dependencies. No database or application checkout is required.

Contributions are welcome under the [contribution guide](CONTRIBUTING.md). Releases follow [RELEASING.md](RELEASING.md), and user-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

Template DSL is released under the [MIT License](LICENSE).
