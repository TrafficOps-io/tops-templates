// The minimal document for “From scratch”. Catalog templates are loaded from repository ZIPs.
export function starterProject() {
  return { 'index.tpl': `@template "Untitled project" version=1

@section content "Content"
  @param title String = "Your next idea" label="Page title" required
@endsection

@layout
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{{ title }}</title>
    </head>
    <body>
      <h1>{{ title }}</h1>
    </body>
  </html>
@endlayout
` };
}
