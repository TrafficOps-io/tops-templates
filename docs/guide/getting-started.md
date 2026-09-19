# Overview

TrafficOps Templates is a language and toolkit for static page templates. Authors describe editable data with `@param`, place page markup inside `@layout`, and let a host turn the source into a validated definition before rendering it with concrete values.

## What is in the monorepo

| Component | Purpose |
| --- | --- |
| `template-dsl/` | Authoritative PHP parser, value validation, and renderer. |
| `runtime/` | Portable language subset for browsers and Node.js. |
| `tops-cli/` | Interactive and non-interactive page generation. |
| `editor/` | The Template Studio browser editor. |
| `vscode-extension/` | Syntax highlighting, diagnostics, completion, and formatting. |
| `skills/` | Installable agent instructions for authoring templates and integrating the PHP package. |
| `docs/` | This site and the detailed language reference. |

## Data flow

```text
*.tpl + assets
      │
      ▼
  parser + host-selected dialect
      │
      ├──► definition v1 ──► parameter form
      │
      ▼
 validateValues(values)
      │
      ▼
 render / generateProject
      │
      ▼
 HTML pages + unchanged assets
```

The default profile never executes arbitrary template code. Expressions are bounded data lookups, not PHP or JavaScript. An application can install its own dialect, but dialect selection remains a host privilege and is never read from uploaded template source.

## Two ways to use it

### Without a server integration

Use [Template Studio](https://studio.trafficops.io) for visual authoring or the CLI for local and CI builds. Both use the JavaScript runtime and support the portable `safe-html-v1` profile.

### Inside a PHP application

Install `trafficops/template-dsl`, resolve `TemplateSourceParser` and `TemplateEngine` through the Laravel container, and store the normalized definition alongside your application data. The PHP implementation is authoritative for validation, resource limits, and custom dialects.

## Requirements

- Node.js 22+ for the CLI, editor, and documentation site;
- PHP 8.4+ and Laravel/Illuminate 12 for the PHP package;
- Composer 2 for PHP dependency management.

Next, [build your first template](./first-template.md). If you work with a coding agent, install the [TrafficOps agent skills](./skills.md) so it can follow the same language, runtime, and security rules.

The JavaScript analyzer and formatter are distributed as `@trafficops/template-language` (`packages/template-language`). Both the editor and the VS Code extension consume that package.
