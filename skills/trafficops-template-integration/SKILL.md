---
name: trafficops-template-integration
description: Integrate the TrafficOps template-dsl Composer package into PHP or Laravel, including parsing, typed validation, safe rendering and host-selected dialects. Use for TrafficOps PHP integration; use the authoring skill for writing templates alone.
---

# TrafficOps PHP template integration

Read [PHP integration](references/php-api.md) and [dialect contracts](references/dialects.md) as needed. The public package is `trafficops/template-dsl`, using the `TrafficOps\TemplateDsl` namespace. Require PHP 8.4+, Illuminate 12, DOM and Mbstring; Laravel package discovery registers its provider.

Resolve `TemplateSourceParser` and `TemplateEngine` from the host container. Parse source, validate the definition, validate submitted values, then render with an explicit context. Keep the parser and engine on the same host-selected dialect. Use `safe-html-v1` unless a trusted host deliberately implements a different profile. A template cannot choose its dialect.

An include resolver must read only from the authorized project collection, enforce safe relative paths and reject symlink escapes. Pass scalar `query`, `locale` and `actions` context explicitly; never expose request objects, headers, environment variables or service container lookups.

The DSL is not a complete document sanitizer. Apply the application's HTML/CSS/asset policy and isolated preview policy before publication. Do not weaken core bounds to accept a failing template. The supported dialect contract and threat model describe which guarantees belong to the library versus the host.

Test the integration with a minimal valid template, invalid parameter values, an include outside the project, and values containing template-looking text. Rendered data must not become new DSL source. Use the host project's existing test tools and preserve its authentication, storage and deployment conventions.
