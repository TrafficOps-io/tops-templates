@template "A little more possibility" version=1 description="A clean, ready-to-customize launch page."

@section identity "Identity"
  @param brand String = "STUDIO / 01" label="Brand name" required
  @param accent Color = "#e75d45" label="Accent color"
@endsection

@section content "Your message"
  @param eyebrow String = "A PLACE FOR YOUR NEXT IDEA" label="Eyebrow"
  @param headline String = "Make room for something great." label="Headline" required
  @param description Text = "Good things start with a little space. Build a page that feels like you, then send it out into the world." label="Description"
  @param button String = "Explore the possibilities" label="Button label"
  @param destination Url = "https://trafficops.io" label="Button destination"
  @param showNote Boolean = true label="Show the small print"
  @param image Image = "images/cover.svg" label="Image path" help="Relative to this page. Images remain in your project."
@endsection

@layout
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{{ headline }}</title>
      <link rel="stylesheet" href="styles.css" />
    </head>
    <body style="--accent: {{ accent }}">
      <nav><strong>{{ brand }}</strong><span>Made to be yours ↗</span></nav>
      <main>
        <div class="copy">
          <p class="eyebrow">{{ eyebrow }}</p>
          <h1>{{ headline }}</h1>
          <p class="description">{{ description }}</p>
          <a class="button" href="{{ destination }}">{{ button }} <span>↗</span></a>
          @if showNote
            <p class="note">A fresh beginning. An open invitation.</p>
          @endif
        </div>
        <figure>
          <img src="{{ image }}" alt="Abstract coral shapes" />
          <figcaption>01 — A new perspective</figcaption>
        </figure>
      </main>
      <footer><span>{{ brand }}</span><span>Thoughtfully put together.</span></footer>
    </body>
  </html>
@endlayout
