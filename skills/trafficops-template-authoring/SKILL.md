---
name: trafficops-template-authoring
description: Create or edit TrafficOps .tpl templates with typed parameters, reusable blocks, local assets and generated static pages for the TrafficOps CLI or browser editor. Use for TrafficOps template authoring, not arbitrary template engines.
---

# TrafficOps template authoring

Read [the language reference](references/language-v1.md) for syntax. Confirm the target runtime: PHP is authoritative; the portable JavaScript runtime has its own supported subset. Read the installed CLI's help and project runtime documentation before using advanced constructs. Never silently convert unsupported syntax into literal output.

For a new portable project, start with `index.tpl.html`, optional `assets/` and a separate JSON values file. Declare editable values using `@param`, group them with `@section`, and put page output in exactly one `@layout … @endlayout`. Use typed records/repeaters when multiple items share a shape. Keep includes within the template directory.

Use `{{name}}` for escaped scalar insertion. Use `{{& name}}` only for supported Markdown/Wysiwyg fields. Values are data: never evaluate JavaScript/PHP or run a second interpolation pass over user values. Keep image values as relative paths such as `assets/hero.webp`; do not upload images or invent public image URLs.

Prefer `safe-html-v1`. PHP and application-owned trusted dialects are outside the portable CLI/editor contract. Template metadata cannot select a more permissive dialect.

Validate the actual template through the target runtime, then generate into a new output directory:

```sh
npx @trafficops/cli --template ./template --data ./values.json --output ./generated
```

Inspect generated links, image paths and representative defaults/empty values. When the CLI is not published, use the local build command documented by the repository. Do not claim compilation or a visual check without running it. Preserve unrelated project files and generated output unless the user asks to replace them.
