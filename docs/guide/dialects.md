# Dialects

A dialect is a host-selected policy layer around the common language. It defines allowed paths, protected syntax, additional directives, and runtime behavior. Template source cannot select a dialect or grant itself additional privileges.

## Profile comparison

| Capability | `safe-html-v1` | `fast-landings-v1` |
| --- | --- | --- |
| Shipped by this package | yes | no; the implementation belongs to the host application |
| Intended authors | may be untrusted | trusted only |
| Output | `.html` | `.html` or `.php` |
| PHP source | rejected | preserved for later host execution |
| Runtime data | `query`, `locale`, `actions` | `query`, `headers`, `body` |
| Request validation | none | `@validation` |

## Safe HTML

`safe-html-v1` is the default. It accepts HTML pages and a small explicit runtime context:

```tpl
@template "Safe campaign" version=1
@param title String = "Campaign"

@layout
  <main>
    <h1>{{title}}</h1>
    <p>Source: {query.source}</p>
    <a href="{actions.continue}">Continue</a>
  </main>
@endlayout
```

```php
$html = $engine->render($definition, $values, [
    'query' => ['source' => 'newsletter'],
    'locale' => 'en',
    'actions' => ['continue' => '/flow/continue'],
]);
```

The profile exposes no request object, headers, body, wildcard lookups, environment variables, secrets, or service container.

## Fast Landings

`fast-landings-v1` is a trusted application-owned dialect. This package publishes its machine-readable compatibility profile, but does not ship the implementation or request-runtime compiler.

An entry page can validate query parameters:

```tpl
@template "Runtime request form" version=1

@section main "Main page"
  @param title String = "Request a call"
@endsection

@validation query fallback="/error.html"
  @param subid String required
  @param pixel String length=10 required
@endvalidation

@layout
  <h1>{{title}}</h1>
  <form method="post" action="/success.php" data-pixel="{query.pixel}">
    <input type="hidden" name="subid" value="{query.subid}" />
    <input name="name" required minlength="4" />
    <button type="submit">Send</button>
  </form>
@endlayout
```

A `success.tpl.php` page can validate the body and preserve trusted PHP:

```tpl
@section success "Success page"
  @param message Text = "Thank you, {body.name}!"
@endsection

@validation body fallback="/submit-error.html"
  @param name String required min=4
  @param phone String required mask="+1 (...) ...-...."
@endvalidation

@layout
  <?php http_response_code(201); ?>
  <h1>Request received</h1>
  <p>{{message}}</p>
@endlayout
```

The common renderer substitutes template settings while leaving request tokens literal. Fast Landings then compiles `@validation` and `{query…}`, `{headers…}`, and `{body…}` in its isolated request runtime. Inserted request values remain single-pass data.

::: danger Trust boundary
`LiteralRuntimeStrategy` preserves syntax; it does not make that syntax safe. PHP support means executing author code. Enable such a dialect only for explicitly trusted authors and with application-owned isolation, publication, and audit controls.
:::

## Registering a dialect in Laravel

Bind the interface to the same concrete singleton used by the application:

```php
use App\Templates\ApplicationTemplateDialect;
use TrafficOps\TemplateDsl\TemplateDialect;

public function register(): void
{
    $this->app->singleton(ApplicationTemplateDialect::class);
    $this->app->singleton(
        TemplateDialect::class,
        fn ($app) => $app->make(ApplicationTemplateDialect::class),
    );
}
```

`TemplateSourceParser` and `TemplateEngine` must use the same dialect. Never resolve a PHP class dynamically from a dialect ID stored in uploaded content.

## Implementation contract

`TemplateDialect` is responsible for:

1. a stable, versioned `id()`;
2. source, entrypoint, and output path validation;
3. separate parser and renderer source preparation;
4. extraction of dialect-owned directives;
5. final parsed-page and rendered-output validation;
6. a runtime strategy and inert validation samples.

Before adding a dialect, document its trust model, every syntax extension, restoration boundary, escaping behavior, limits, and ID migration policy. See the full [Dialect API reference](../dialects.md) and [threat model](../threat-model.md).
