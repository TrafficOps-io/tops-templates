@template "Rich text article" description="WYSIWYG and Markdown editors with image uploads."
@section content "Article"
@param title String = "Your next story" label="Title" required
@param body Wysiwyg = "<h2>A visual editor</h2><p>Write an article with <strong>formatting</strong>, lists and images.</p>" label="Article" required
@param notes Markdown = "## Extra details\n\nEdit **Markdown** here and choose Preview to see the result." label="Details"
@endsection
@section discussion "Comments"
@param comments Comment[] label="Comments" min_items=1 max_items=10
@endsection
@type Comment
@param author String = "Reader" label="Name"
@param text Markdown = "A *useful* story." label="Comment"
@endtype
@layout
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
body { max-width: 760px; margin: 0 auto; padding: 48px 24px; font: 18px/1.7 system-ui, sans-serif; color: #172b3a; background: #f6f8fa; }
article, aside { background: white; border: 1px solid #dbe3e8; border-radius: 12px; padding: 24px; margin: 24px 0; }
h1, h2, h3 { line-height: 1.25; }
img { max-width: 100%; height: auto; border-radius: 8px; }
pre { padding: 16px; background: #eef2f5; overflow-x: auto; }
blockquote { border-left: 3px solid #527a8f; margin-left: 0; padding-left: 20px; }
a { color: #176b9b; }
</style>
</head>
<body>
<h1>{{title}}</h1>
<article>{{&body}}</article>
<aside>{{&notes}}</aside>
<h2>Reader comments</h2>
@each comment in comments
<article><h3>{{comment.author}}</h3>{{&comment.text}}</article>
@endeach
</body>
</html>
@endlayout
