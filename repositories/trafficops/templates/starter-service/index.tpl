@template "Forma Studio" version=1

@section content "Content"
  @param brand String = "Forma Studio" label="Brand name" required
  @param headline String = "Thoughtful work. Lasting impressions." label="Headline" required
  @param description Text = "An independent studio shaping identities and digital experiences for people with something to say." label="Description"
  @param button String = "Let's get started" label="Button label"
  @param destination Url = "https://example.com" label="Button destination"
  @param accent Color = "#b7caad" label="Accent color"
@endsection

@layout
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="An independent studio shaping identities and digital experiences for people with something to say." />
    <title>{{ headline }}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body style="--accent: {{ accent }}">
    <header><strong>{{ brand }}</strong><a href="#contact">Get in touch ↗</a></header>
    <main><section class="hero"><p class="eyebrow">MADE FOR WHAT COMES NEXT</p><h1>{{ headline }}</h1><p class="intro">{{ description }}</p><a class="button" href="{{ destination }}">{{ button }} ↗</a></section>
    <section class="grid" aria-label="Services"><article><span>01</span><h3>Strategy</h3><p>A shared direction, grounded in what makes your business different.</p></article><article><span>02</span><h3>Identity</h3><p>A considered visual language, from the first impression to the smallest detail.</p></article><article><span>03</span><h3>Digital</h3><p>Clear, useful experiences that turn attention into connection.</p></article></section>
    <section id="contact" class="contact"><h2>Good things start here.</h2><a class="button" href="{{ destination }}">{{ button }} ↗</a></section></main>
    <footer>{{ brand }} · Thoughtfully made.</footer>
  </body>
</html>
@endlayout
