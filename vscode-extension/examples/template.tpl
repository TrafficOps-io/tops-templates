@template "Article with comments" version=1 description="An example of author-defined types and reusable blocks."
@include "blocks/comment.tpl"

@section appearance "Appearance"
  @param primary Color = "#0f766e" label="Primary color"
  @param fontSize Range = 18 min=12 max=28 step=1 label="Font size"
@endsection

@section content "Content"
  @param title String = "Welcome" label="Article title" required=true
  @param comments Comment[] min_items=1 max_items=20 label="Reader comments"
@endsection

@layout
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>{{ title }}</title>
      <style>
        body {
          color: {{ primary }};
          font-size: {{ fontSize }}px;
        }
      </style>
    </head>
    <body>
      <h1>{{ title }}</h1>
      @each comment in comments:
        @render commentItem(comment)
      @endeach
    </body>
  </html>
@endlayout
