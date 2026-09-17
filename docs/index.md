---
layout: home

hero:
  name: TrafficOps Templates
  text: Templates that remain data
  tagline: A typed DSL, safe HTML rendering, PHP API, CLI, and local-first browser editor in one monorepo.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Open Template Studio
      link: https://trafficops-templates.netlify.app

features:
  - title: One language
    details: Parameters, types, blocks, conditions, and repeaters live beside HTML and behave consistently in PHP, the CLI, and the editor.
  - title: Explicit policy
    details: The host application selects the dialect. A safe profile ships by default; executable extensions require a deliberate integration.
  - title: Local-first tools
    details: Generate in a terminal or edit and export a ZIP in the browser without uploading template sources to an API.
  - title: Ordinary output
    details: The result is static HTML and unchanged assets that can be deployed to any suitable host.
---

## Minimal example

```tpl
@template "Campaign" version=1

@section content "Content"
  @param title String = "New campaign" required
  @param body Markdown = "Start with an **idea**."
  @param destination Url = "https://trafficops.io"
@endsection

@layout
  <main>
    <h1>{{title}}</h1>
    <div>{{& body}}</div>
    <a href="{{destination}}">Continue</a>
  </main>
@endlayout
```

Save it as `index.tpl`, then open it in [Template Studio](https://trafficops-templates.netlify.app) or generate the page with the CLI:

```sh
npx @trafficops/cli --template ./index.tpl --output ./generated
```

::: tip Where to go next
Build your [first template](./guide/first-template.md), then choose your integration path: [PHP and Laravel](./guide/php.md) or [CLI and Template Studio](./guide/tooling.md).
:::
