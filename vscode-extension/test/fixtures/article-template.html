@template "Editorial article" description="An article with brand colors, configurable blocks and reader comments." version=1

@type Header
@param brand String = "Everyday Journal" label="Brand name" required=true
@param tagline String = "Ideas for everyday life" label="Header tagline"
@param logo Image label="Logo" help="Choose an image URL, a bundled asset, or upload a logo."
@endtype

@type Article
@param category Select = "Lifestyle" label="Category" options="Lifestyle:Lifestyle|Wellness:Wellness|Technology:Technology"
@param title String = "Small changes. A brighter everyday." label="Article title" required=true
@param intro Text = "A practical guide to making room for the things that matter." label="Introduction"
@param author String = "The editorial team" label="Author"
@param cover Image label="Cover image" aspect_ratio="16:9"
@param body Text = "Good habits start with a little space to think. Pick one small change that makes your day simpler, and give it time.\n\nA walk outside, a short conversation, or a few minutes away from a screen can help you find a fresh perspective.\n\nBuild a routine that works for you. Keep what helps, adjust what does not, and celebrate steady progress." label="Article text" required=true
@param ctaLabel String = "Explore the guide" label="Button label"
@param ctaUrl Url = "https://example.com" label="Button URL" required=true
@endtype

@type Comment
@param name String = "Alex" label="Reader name" required=true
@param body Text = "The suggestion to start small really resonated with me." label="Comment text" required=true
@param avatar Image label="Reader avatar" sizes="128x128|256x256"
@param date String = "Today" label="Date label"
@param verified Boolean = true label="Verified reader"
@endtype

@type Comments
@param enabled Boolean = true label="Show comments"
@param title String = "From our readers" label="Section heading"
@param items Comment[] label="Reader comments" min_items=1 max_items=20
@endtype

@section appearance "Appearance"
@param primary Color = "#0f766e" label="Primary color"
@param secondary Color = "#f0fdfa" label="Secondary color"
@param accent Color = "#115e59" label="Accent color"
@param text Color = "#172b2b" label="Text color"
@param fontSize Range = 18 label="Body font size" min=14 max=24 step=1 help="Size in pixels."
@endsection

@section header "Header"
@param header Header label="Header block"
@endsection

@section article "Article"
@param article Article label="Article block"
@endsection

@section discussion "Comments"
@param comments Comments label="Comments block"
@endsection

@section footer "Footer"
@param footerNote String = "Made for curious people." label="Footer note"
@endsection

@block commentItem(comment: Comment)
<article class="comment">
  @if comment.avatar
  <img class="avatar" src="{{comment.avatar}}" alt="{{comment.name}}" loading="lazy">
  @endif
  <div>
    <p class="comment-meta"><strong>{{comment.name}}</strong>
      @if comment.verified
      <span class="badge">Verified reader</span>
      @endif
      <span>{{comment.date}}</span>
    </p>
    <p class="comment-body">{{comment.body}}</p>
  </div>
</article>
@endblock

@block commentsList(comments: Comments)
@if comments.enabled
<section class="comments" aria-label="{{comments.title}}">
  <h2>{{comments.title}}</h2>
  <div class="comment-list">
    @each comment in comments.items:
    @render commentItem(comment)
    @endeach
  </div>
</section>
@endif
@endblock


@block siteHeader(header: Header)
<header class="site-header shell">
  <a class="brand" href="#article">
    @if header.logo
    <img class="logo" src="{{header.logo}}" alt="">
    @endif
    <span>{{header.brand}}</span>
  </a>
  <span class="eyebrow">{{header.tagline}}</span>
</header>
@endblock

@block articleBody(article: Article)
<article id="article" class="article">
  <p class="eyebrow">{{article.category}}</p>
  <h1>{{article.title}}</h1>
  <p class="lead">{{article.intro}}</p>
  <p class="byline">By {{article.author}}</p>
  @if article.cover
  <img class="cover" src="{{article.cover}}" alt="{{article.title}}">
  @endif
  <div class="article-body">{{article.body}}</div>
  <a class="button" href="{{article.ctaUrl}}">{{article.ctaLabel}} <span aria-hidden="true">↗</span></a>
</article>
@endblock

@layout
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{{article.title}} · {{header.brand}}</title>
  <style>
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: #fff; color: var(--text); font: var(--font-size)/1.7 system-ui, sans-serif; }
a { color: var(--primary); }
.shell { width: min(900px, calc(100% - 40px)); margin: auto; }
.site-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-block: 24px; border-bottom: 1px solid var(--secondary); }
.brand { display: flex; gap: 12px; align-items: center; text-decoration: none; font-size: 1.2rem; font-weight: 750; color: var(--text); }
.logo { width: 40px; height: 40px; object-fit: contain; }
.eyebrow { color: var(--primary); text-transform: uppercase; letter-spacing: .12em; font-size: .75rem; font-weight: 700; }
.article { padding-block: 52px 40px; }
h1 { font-size: clamp(2rem, 6vw, 3.6rem); line-height: 1.1; letter-spacing: -.04em; margin: 16px 0 24px; }
.lead { color: var(--primary); font-size: 1.3em; line-height: 1.5; }
.byline, .muted { color: #64748b; }
.cover { width: 100%; max-height: 440px; object-fit: cover; border-radius: 16px; margin: 20px 0; }
.article-body, .comment-body { white-space: pre-line; overflow-wrap: anywhere; }
.article-body { margin: 30px 0; }
.button { display: inline-flex; gap: 28px; align-items: center; background: var(--primary); color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: 650; }
.button:hover { background: var(--accent); }
.comments { background: var(--secondary); border-radius: 18px; padding: 28px; }
.comments h2 { margin: 0 0 20px; }
.comment { display: flex; gap: 16px; padding-block: 22px; border-top: 1px solid #0001; }
.avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.avatar-placeholder { display: grid; place-items: center; color: var(--primary); background: #fff; }
.comment-meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 0; font-size: .85em; }
.comment-meta > span:last-child { color: #64748b; }
.badge { color: var(--primary); background: #fff; padding: 2px 8px; border-radius: 12px; font-size: .75rem; }
.comment-body { margin: 6px 0 0; }
.footer { padding-block: 32px; color: #64748b; font-size: .8em; }
@media (max-width: 600px) { .site-header > .eyebrow { display: none; } .article { padding-top: 32px; } .comments { padding: 20px; } }
</style>
  <style>
    :root { --primary: {{primary}}; --secondary: {{secondary}}; --accent: {{accent}}; --text: {{text}}; --font-size: {{fontSize}}px; }
  </style>
</head>
<body>
  @render siteHeader(header)
  <main class="shell">
    @render articleBody(article)
    @render commentsList(comments)
  </main>
  <footer class="shell footer">{{header.brand}} <span data-year></span> · {{footerNote}}</footer>
  <script>
document.querySelectorAll('[data-year]').forEach((element) => {
  element.textContent = new Date().getFullYear();
});
</script>
</body>
</html>
@endlayout
