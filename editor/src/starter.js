export function starterProject(blank = false) {
  return {
    'index.tpl': blank ? `@template "Untitled project" version=1

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
` : `@template "A little more possibility" version=1 description="A clean, ready-to-customize launch page."

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
`,
    ...(!blank ? {
      'styles.css': `:root { color: #241f1d; background: #fbf7f2; font-family: Arial, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0 7%; }
nav, footer { display: flex; justify-content: space-between; align-items: center; padding: 32px 0; font-size: 12px; letter-spacing: .05em; }
nav { border-bottom: 1px solid #e7ddd6; } nav span, footer { color: #766e69; }
main { display: grid; grid-template-columns: 1.15fr 1fr; align-items: center; gap: 7%; padding: 68px 0; }
.eyebrow { font-size: 10px; letter-spacing: .16em; font-weight: 700; }
h1 { font-family: Georgia, serif; font-weight: 400; font-size: clamp(38px, 5vw, 70px); line-height: 1.04; letter-spacing: -.045em; margin: 24px 0; }
.description { max-width: 380px; font-size: 14px; line-height: 1.8; color: #766e69; }
.button { display: inline-flex; gap: 24px; padding: 16px 20px; background: var(--accent); color: #241f1d; border-radius: 5px; font-size: 12px; font-weight: 700; text-decoration: none; margin-top: 16px; }
.note { font-size: 10px; color: #766e69; margin-top: 20px; }
figure { margin: 0; } figure img { display: block; width: 100%; border-radius: 90px 90px 8px 8px; } figcaption { color: #766e69; font-size: 10px; padding-top: 15px; text-align: right; }
footer { border-top: 1px solid #e7ddd6; font-size: 10px; }
@media (max-width: 560px) { main { grid-template-columns: 1fr; padding: 40px 0; gap: 32px; } figure { max-width: 300px; } nav span { display: none; } }
`,
      'images/cover.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 610"><rect width="500" height="610" fill="#eadbd0"/><circle cx="250" cy="255" r="170" fill="#e75d45"/><path d="M80 520V320a170 170 0 0 1 340 0v200" fill="#f8efe5"/><path d="M155 520V340a95 95 0 0 1 190 0v180" fill="#2f2926"/><circle cx="250" cy="340" r="55" fill="#e75d45"/><path d="M0 520h500v90H0" fill="#d6c5b6"/></svg>`,
    } : {}),
  };
}
