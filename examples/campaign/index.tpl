@template "TrafficOps campaign" version=1 description="A complete portable template with cards, rich text and relative assets."

@section identity "Identity"
@param brand String = "TrafficOps" label="Brand name" required
@param accent Color = "#7c3aed" label="Accent color"
@endsection

@section content "Content"
@param title String = "Your next campaign starts here" label="Headline" required
@param introduction Markdown = "A **simple template** you can make your own." label="Introduction"
@param image Image = "assets/cover.svg" label="Image path" help="A relative path in your project. Images are never uploaded."
@param destination Url = "https://trafficops.io" label="Button URL"
@param showCards Boolean = true label="Show feature cards"
@endsection

@type Card
@param title String = "A clear message" required
@param body Text = "Explain one useful thing about your offer."
@endtype

@param cards Card[] min_items=1 max_items=6 label="Feature cards"

@block card(item: Card)
<article><h2>{{item.title}}</h2><p>{{item.body}}</p></article>
@endblock

@layout
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{title}} · {{brand}}</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body style="--accent: {{accent}}">
  <header>{{brand}}</header>
  <main>
    <section class="hero">
      <div><p class="eyebrow">Built with TrafficOps</p><h1>{{title}}</h1><div>{{& introduction}}</div><a class="button" href="{{destination}}">Get started →</a></div>
      <img src="{{image}}" alt="Abstract purple landscape">
    </section>
    @if showCards
    <section class="cards">
      @each item in cards:
      @render card(item)
      @endeach
    </section>
    @endif
  </main>
  <footer>Made with {{brand}} · <a href="thanks.html">Next page</a></footer>
</body>
</html>
@endlayout
