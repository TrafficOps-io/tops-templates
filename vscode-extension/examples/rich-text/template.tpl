@template "Rich text" description="Visual and Markdown content with images" version=1
@include "blocks/article.tpl"

@param title String = "Editor examples" label="Title"
@param article Article label="Article"
@param articles Article[] label="More articles" min_items=1 max_items=5

@layout
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>{{title}}</title>
      <style>
        body { max-width: 760px; margin: auto; padding: 24px; font: 18px/1.6 system-ui; }
        img { max-width: 100%; height: auto; }
      </style>
    </head>
    <body>
      <h1>{{title}}</h1>
      <article>{{& article.body}}</article>
      <aside>{{& article.notes}}</aside>
      @each row in articles:
        @render articleContent(row)
      @endeach
    </body>
  </html>
@endlayout
