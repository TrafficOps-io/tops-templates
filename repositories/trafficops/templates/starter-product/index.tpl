@template "Orbit" version=1

@section content "Content"
  @param brand String = "Orbit" label="Brand name" required
  @param headline String = "Less busywork. More possibility." label="Headline" required
  @param description Text = "Give your next big idea the space it deserves. One thoughtful product to bring your work together." label="Description"
  @param button String = "Let's get started" label="Button label"
  @param destination Url = "https://example.com" label="Button destination"
  @param accent Color = "#bef264" label="Accent color"
@endsection

@layout
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Give your next big idea the space it deserves. One thoughtful product to bring your work together." />
    <title>{{ headline }}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body style="--accent: {{ accent }}">
    <header><strong>{{ brand }}</strong><a href="#contact">Get in touch ↗</a></header>
    <main><section class="hero"><p class="eyebrow">MADE FOR WHAT COMES NEXT</p><h1>{{ headline }}</h1><p class="intro">{{ description }}</p><a class="button" href="{{ destination }}">{{ button }} ↗</a></section>
    <section class="grid" aria-label="Benefits"><article><span>01 / FOCUS</span><h3>A clearer day</h3><p>Keep the important things in view and find your own rhythm.</p></article><article><span>02 / FLOW</span><h3>Made to connect</h3><p>Bring your work together in a space that feels natural.</p></article><article><span>03 / GROW</span><h3>Room to evolve</h3><p>Start small. Make it yours. Build something that lasts.</p></article></section>
    <section id="contact" class="contact"><h2>Good things start here.</h2><a class="button" href="{{ destination }}">{{ button }} ↗</a></section></main>
    <footer>{{ brand }} · Thoughtfully made.</footer>
  </body>
</html>
@endlayout
