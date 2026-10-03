@template "Still Portfolio" version=1 description="An editorial photography portfolio with a spacious, asymmetrical image gallery."

@section identity "Identity"
  @param brand String = "Still Studio" label="Studio or photographer name" required
  @param headline String = "Look closer." label="Main headline" required
  @param description Text = "Places, objects, and the space in between. A collection of small observations." label="Introduction"
  @param accent Color = "#496158" label="Accent color"
@endsection

@section work "Selected work"
  @param workHeading String = "Selected work" label="Gallery heading"
  @param landscape Image = "images/landscape.svg" label="First project image" help="Original demo illustration. Replace with your own landscape photograph."
  @param landscapeAlt String = "Illustrated pale coastal cliffs beside a muted green sea" label="First image alternative text"
  @param landscapeTitle String = "Where the land ends" label="First project title"
  @param landscapeCaption String = "Coast, horizon, and a little room to breathe." label="First project caption"
  @param city Image = "images/city.svg" label="Second project image" help="Original demo illustration. Replace with your own architecture photograph."
  @param cityAlt String = "Illustrated stone facade with a tall arched opening and afternoon shadows" label="Second image alternative text"
  @param cityTitle String = "An ordinary afternoon" label="Second project title"
  @param cityCaption String = "Finding stillness in the shapes of a city." label="Second project caption"
  @param stillLife Image = "images/still-life.svg" label="Third project image" help="Original demo illustration. Replace with your own still-life photograph."
  @param stillLifeAlt String = "Illustrated sculptural ceramic vase and a single branch on a stone plinth" label="Third image alternative text"
  @param stillLifeTitle String = "Things left in the light" label="Third project title"
  @param stillLifeCaption String = "Simple objects. Changing light. Another way of looking." label="Third project caption"
  @param imageNote String = "Demo collection: original illustrations shown as sample images. Replace them with your own photography." label="Sample image note"
@endsection

@section about "About the photographer"
  @param aboutHeading String = "A slower way of seeing." label="About heading"
  @param aboutText Text = "This is a space for your perspective. Introduce yourself, the subjects you return to, and what you hope people notice in your work." label="About paragraph"
  @param practice String = "Portraits, places & still life" label="Practice or specialty"
@endsection

@section contact "Contact"
  @param contactHeading String = "Have something in mind?" label="Contact heading"
  @param contactText Text = "Tell me about the place, the people, or the idea you would like to photograph." label="Contact description"
  @param button String = "Start a conversation" label="Contact button label"
  @param destination Url = "https://example.com/contact" label="Contact destination"
@endsection

@layout
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="A photography portfolio of places, objects, and small observations." />
    <title>{{ brand }} — {{ headline }}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body style="--accent: {{ accent }}">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header" data-block="header">
      <a class="wordmark" href="#main">{{ brand }}</a>
      <nav aria-label="Main navigation">
        <a href="#work">Work</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>
    <main id="main">
      <section class="introduction" aria-labelledby="headline" data-block="hero">
        <h1 id="headline">{{ headline }}</h1>
        <div class="intro-bottom">
          <p class="practice"><span class="practice-dot" aria-hidden="true"></span>{{ practice }}</p>
          <p class="intro-copy">{{ description }}</p>
        </div>
      </section>

      <section id="work" class="work" aria-labelledby="work-heading" data-block="work">
        <h2 id="work-heading" class="section-label">{{ workHeading }}</h2>
        <div class="gallery">
          <figure class="project project-landscape">
            <img src="{{ landscape }}" alt="{{ landscapeAlt }}" width="1200" height="1080" fetchpriority="high" />
            <figcaption><h3>{{ landscapeTitle }}</h3><p>{{ landscapeCaption }}</p></figcaption>
          </figure>
          <figure class="project project-city">
            <img src="{{ city }}" alt="{{ cityAlt }}" width="760" height="980" loading="lazy" />
            <figcaption><h3>{{ cityTitle }}</h3><p>{{ cityCaption }}</p></figcaption>
          </figure>
          <figure class="project project-still-life">
            <img src="{{ stillLife }}" alt="{{ stillLifeAlt }}" width="1080" height="900" loading="lazy" />
            <figcaption><h3>{{ stillLifeTitle }}</h3><p>{{ stillLifeCaption }}</p></figcaption>
          </figure>
          <div id="about" class="about" data-block="about">
            <p class="section-label">About {{ brand }}</p>
            <h2>{{ aboutHeading }}</h2>
            <p class="about-copy">{{ aboutText }}</p>
            <a class="text-link" href="#contact">Let's make something together</a>
          </div>
        </div>
        <p class="image-note">{{ imageNote }}</p>
      </section>

      <section id="contact" class="contact" aria-labelledby="contact-heading" data-block="contact">
        <div><h2 id="contact-heading">{{ contactHeading }}</h2><p>{{ contactText }}</p></div>
        <a class="contact-link" href="{{ destination }}">{{ button }}<span class="contact-symbol" aria-hidden="true">↗</span></a>
      </section>
    </main>
    <footer class="site-footer" data-block="footer"><span>{{ brand }}</span><a href="#main">Back to top</a></footer>
  </body>
</html>
@endlayout
