# Dialect integration

A dialect is a host-selected policy layer around the common version 1 parser and renderer. It can preserve trusted source fragments, extract host directives and provide a runtime-token strategy. It cannot replace definition validation, field validation, core expression semantics or resource budgets.

Template source must never choose a dialect. The host selects one through dependency injection before it accepts a template, and the same instance or equivalent policy must be used by both `TemplateSourceParser` and `TemplateEngine`.

## Contracts

### `TemplateDialect`

The dialect contract has six responsibilities:

1. Return a stable, versioned `id()` used for policy and compatibility decisions.
2. Validate source, entrypoint and output page paths.
3. Prepare source independently for parser and renderer phases.
4. Extract dialect-owned directives before the common parser interprets tokens.
5. Validate and finish parsed pages and rendered output.
6. Supply a `TemplateRuntimeStrategy` and inert samples for validating values that contain deferred runtime text.

A dialect implementation should be deterministic and side-effect free. It should not read requests, storage or the network, execute protected fragments, mutate global state or decide authorization. The host performs those operations outside this package.

### `PreparedSource`

`prepareSource()` returns a `PreparedSource` with:

- `text`, which the common parser or renderer may inspect;
- `opaque`, a marker-to-fragment map restored only at a deliberate dialect boundary;
- `metadata`, phase-specific information needed by `finishRendered()`.

Marker keys must be non-empty strings, fragments must be strings, and markers must be collision-free with literal prepared text and unique across a multi-source parse. Core rejects malformed or conflicting maps, but choosing collision-safe marker text remains the dialect's responsibility. A dialect must not use protected fragments to hide common DSL expressions and later place them in a different trust context. Parser and renderer preparation are separate phases (`SourcePhase::Parser` and `SourcePhase::Renderer`) because directive parsing and final rendering have different composition boundaries.

Parser raw-source bytes and prepared-source bytes use independent aggregate counters shared by every root and include. `finishParsedPage()` is followed by UTF-8/NUL validation, a 2 MiB per-page ceiling and the configured aggregate parsed-page ceiling. Renderer preparation is similarly rechecked for UTF-8, NUL bytes, marker shape and 2 MiB per source.

### `DirectiveExtraction`

`extractDirectives()` receives tokenized page sources and returns:

- the tokens that the common parser should process;
- optional page metadata consumed by `finishParsedPage()`.

The returned token list may only be a stable subsequence of the original list: a dialect may remove its own declarations, but it cannot add, mutate or reorder tokens, and it cannot add, remove or reorder page boundaries. Removing a directive transfers responsibility for its complete syntax, validation, page association and lifecycle to the dialect. Unknown content must not be silently promoted to executable behavior.

### `TemplateRuntimeStrategy`

The runtime strategy validates explicit context, discovers its own runtime nodes in prepared source, renders those nodes, and verifies that common composition did not move them into a different output context. Core code owns expression, node, recursion, operation and byte accounting; every node returned by a strategy is charged to the shared parse budget, and a strategy cannot raise or replace those limits. `assertRenderedPositions()` runs before `finishRendered()`; a dialect that structurally changes runtime-bearing output in its final hook must perform its own final placement validation. Core always reapplies the final byte, UTF-8 and NUL checks.

`SafeRuntimeStrategy` implements context-sensitive `{query.name}`, `{locale}` and `{actions.name}` tokens. `LiteralRuntimeStrategy` declares no runtime nodes and requires an empty render context, preserving non-Mustache source literally for a trusted host that processes it later.

## Selecting a dialect

Laravel package discovery binds the safe default. An application may replace it explicitly:

```php
use TrafficOps\TemplateDsl\TemplateDialect;
use App\Templates\ApplicationTemplateDialect;

public function register(): void
{
    $this->app->singleton(ApplicationTemplateDialect::class);
    $this->app->singleton(
        TemplateDialect::class,
        fn ($app) => $app->make(ApplicationTemplateDialect::class),
    );
}
```

If the application constructs parser or engine objects manually, inject the same dialect into both. Do not read a dialect ID from an uploaded definition and resolve a class dynamically. Stored content may record which host policy accepted it for auditing, but it cannot grant itself that policy.

## Bundled and documented profiles

| Capability | `safe-html-v1` | `fast-landings-v1` |
| --- | --- | --- |
| Implementation location | This package | Host application |
| Intended authors | Untrusted | Trusted only |
| Entrypoint | `index.html` | `index.html` or `index.php` |
| Output pages | `.html` | `.html` or `.php` |
| PHP source/output | Rejected | Preserved for host deployment |
| Request validation directives | Rejected | `@validation … @endvalidation` |
| Runtime data | Explicit query, locale and action maps | Host request runtime (`query`, `headers`, `body`) |
| Runtime strategy during common render | `SafeRuntimeStrategy` | `LiteralRuntimeStrategy` |

`safe-html-v1` is implemented by `SafeTemplateDialect` and is the default. It rejects executable path extensions, PHP openings, Blade-like executable constructs and request-validation directives. It permits only HTML output paths.

`fast-landings-v1` documents the compatibility surface of an application-owned dialect. The package does not ship its implementation or its request-runtime compiler. That dialect protects PHP fragments from the common parser, associates request validation with pages, leaves request macros literal during common rendering, and returns trusted PHP-capable output for later host processing. Its later application phase also recognizes request tokens deliberately stored in string settings; inserted request values remain single pass. Selecting it means the host accepts responsibility for trusted authors, runtime compilation, code execution, isolation and deployment.

Machine-readable profiles live in [`resources/dialects`](../resources/dialects). They are descriptive fixtures for editors, importers and compatibility tests. Loading a JSON profile must not instantiate or authorize a dialect.

## Compatibility rules

- Dialect IDs are stable versioned identifiers. Change the identifier when source or runtime meaning becomes incompatible.
- A dialect may narrow common behavior but must not disable common resource or definition validation.
- Opaque fragments and metadata are implementation details unless explicitly standardized by a profile.
- A definition accepted under one dialect must be revalidated before use under another.
- Cache keys should include package version, language version and dialect ID.
- Tooling should require an explicit profile rather than infer one from PHP syntax or directives.
- The safe profile must remain the fallback when no trusted host policy is configured.

## Review checklist for a new dialect

Document and test:

1. author trust level and how the host enforces it;
2. accepted source, entrypoint and output paths;
3. every additional directive and its page/partial behavior;
4. protected syntax and exact restoration point;
5. accepted runtime context and escaping for every placement;
6. whether final output is executable and who executes it;
7. how validation samples avoid weakening URL/email validation;
8. interactions with partials, sections, user values and single-pass guarantees;
9. failure behavior at all core limits;
10. migration and compatibility fixtures for the dialect ID.

See [the threat model](threat-model.md) before accepting a more permissive profile.
