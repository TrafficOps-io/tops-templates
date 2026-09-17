# PHP and Laravel

The PHP package is the authoritative language implementation. It provides source parsing, definition and value validation, the safe runtime, multi-page rendering, and extension points for dialects and field types.

## Installation

```sh
composer require trafficops/template-dsl
```

The package requires PHP 8.4+, Illuminate 12, DOM, and Mbstring. Laravel package discovery registers `TemplateDslServiceProvider` and the default `safe-html-v1` dialect automatically.

## Parse, validate, and render

```php
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateSourceParser;

$parser = app(TemplateSourceParser::class);
$engine = app(TemplateEngine::class);

$source = file_get_contents($authorizedTemplatePath);

$definition = $engine->validateDefinition(
    $parser->parse($source, filename: 'index.tpl'),
);

$values = $engine->validateValues($definition, [
    'title' => 'Autumn campaign',
]);

$html = $engine->render($definition, $values, [
    'query' => ['campaign' => 'autumn'],
    'locale' => 'en',
    'actions' => ['continue' => '/flow/continue'],
]);
```

`validateValues()` applies defaults, normalizes submitted data, and rejects unknown fields. `render()` validates the definition and values again, so stored or externally supplied structures do not bypass the contract.

## Multiple pages

In the PHP API, `parsePages()` keys are dialect-approved output paths:

```php
$sources = [
    'index.html' => $indexSource,
    'thanks.html' => $thanksSource,
];

$definition = $parser->parsePages($sources, filename: 'index.html');
$pages = $engine->renderPages($definition, $submittedValues, $context);

foreach ($pages as $relativePath => $contents) {
    // Write only below an application-authorized publication root.
}
```

All pages share one field schema and the same values and runtime context. The safe dialect permits only `index.html` as the entrypoint and `.html` output pages.

## Includes without arbitrary filesystem access

Resolve includes from an already authorized collection:

```php
$files = [
    'index.tpl' => $indexSource,
    'shared/fields.tpl' => $fieldsSource,
];

$resolve = static function (string $path) use ($files): string {
    if (! array_key_exists($path, $files)) {
        throw new RuntimeException("Unknown template include: {$path}");
    }

    return $files[$path];
};

$definition = $parser->parse(
    $files['index.tpl'],
    include: $resolve,
    filename: 'index.tpl',
);
```

The package validates the include name before calling the resolver. That check does not authorize a real filesystem path, symlink, archive entry, or URL; the resolver retains that responsibility.

## Defaults and forms

```php
$defaults = $engine->defaults($definition);
$field = $engine->fieldAtPath($definition, 'cards.0.title');
$validated = $engine->validateValues(
    $definition,
    $request->input('settings', []),
);
```

- `defaults()` builds initial values for all fields;
- `fieldAtPath()` returns the normalized field at a path;
- `previewRichText()` renders one `Markdown` or `Wysiwyg` value for preview;
- `validateValues()` returns a normalized tree ready for storage.

## Storing definitions

A definition is a JSON-compatible array. Store it alongside enough provenance to revalidate it safely:

- the language version from `definition.version`;
- the host-selected dialect ID;
- the Composer package or application version;
- a source hash;
- normalized values stored separately from the definition.

Call `validateDefinition()` when reading a stored definition, or use a public render method that performs the check internally. A definition accepted under one dialect must be revalidated before use under another.

## Custom dialects

Laravel binds `TemplateDialect` to `SafeTemplateDialect` by default. Replace that binding only for a deliberate host integration:

```php
use App\Templates\ApplicationTemplateDialect;
use TrafficOps\TemplateDsl\TemplateDialect;

$this->app->singleton(ApplicationTemplateDialect::class);
$this->app->singleton(
    TemplateDialect::class,
    fn ($app) => $app->make(ApplicationTemplateDialect::class),
);
```

If you construct `TemplateSourceParser` and `TemplateEngine` manually, inject the same dialect instance into both. Read the [dialect guide](./dialects.md) and [threat model](../threat-model.md) before implementing a permissive profile.

## Security boundary

The package escapes scalar values, sanitizes supported rich text, and bounds parser and renderer work. It is not a whole-document HTML or CSS sanitizer and does not own asset policy, CSP, publication authorization, or content ownership. Those checks remain application responsibilities.
