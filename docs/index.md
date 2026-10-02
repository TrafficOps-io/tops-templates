---
layout: home
---

<DocsHome>

```tpl
@template "Campaign" version=1

@section content "Content"
  @param title String = "New campaign" required
@endsection

@layout
  <h1>{{title}}</h1>
@endlayout
```

Save as `index.tpl`. The default value renders `<h1>New campaign</h1>`. Open it in Landing Studio or generate HTML with the [CLI](./guide/tooling.md).

</DocsHome>
