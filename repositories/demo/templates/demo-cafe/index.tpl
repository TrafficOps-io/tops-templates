@template "Juniper Cafe" version=1 description="A welcoming neighbourhood cafe, with an editable seasonal menu and visiting details."

@section content "Cafe & introduction"
  @param brand String = "Juniper Cafe" label="Cafe name" required
  @param headline String = "Take a moment. Make it a good one." label="Headline" required
  @param description Text = "Coffee made with care, something warm from the oven, and a little room in your day. Come as you are. Stay a while." label="Introduction"
  @param accent Color = "#dce4d1" label="Feature background"
  @param button String = "Plan your visit" label="Visit button"
  @param destination Url = "https://example.com" label="Visit destination"
  @param opening_note String = "Your neighbourhood coffee spot" label="Welcome line"
@endsection

@section story "Our place"
  @param story_title String = "The lovely art of slowing down." label="Story heading"
  @param story Text = "We built Juniper around a simple idea: the everyday deserves a little attention. A carefully pulled espresso. A table by the window. A familiar hello. Nothing complicated, just the good things, done well." label="Cafe story"
  @param coffee_note Text = "Espresso, filter, or something with a little milk. Ask us what’s on the grinder today." label="Coffee description"
  @param food_note Text = "A small, seasonal menu of baked things, good bread, and lunches worth pausing for." label="Food description"
  @param space_note Text = "Bring a book, bring a friend, or just bring yourself. There’s a seat for every kind of morning." label="Space description"
@endsection

@section menu "Menu"
  @param menu_title String = "A few of our favourites." label="Menu heading"
  @param menu_note Text = "Made fresh, served simply. Our counter changes with the seasons; here’s a little taste." label="Menu introduction"
  @param menu_one String = "Flat white" label="First item"
  @param menu_one_description String = "Double espresso, silky steamed milk" label="First item description"
  @param menu_one_price String = "£3.80" label="First item price"
  @param menu_two String = "Batch brew" label="Second item"
  @param menu_two_description String = "Our rotating single-origin filter coffee" label="Second item description"
  @param menu_two_price String = "£3.20" label="Second item price"
  @param menu_three String = "Cardamom bun" label="Third item"
  @param menu_three_description String = "Soft, golden, with a little fragrant spice" label="Third item description"
  @param menu_three_price String = "£3.90" label="Third item price"
  @param menu_four String = "Toast of the season" label="Fourth item"
  @param menu_four_description String = "Sourdough, whipped ricotta, seasonal greens" label="Fourth item description"
  @param menu_four_price String = "£7.50" label="Fourth item price"
  @param dietary_note Text = "Oat milk is always available. Please speak to our team about ingredients and allergens before ordering." label="Dietary information"
@endsection

@section visit "Visit us"
  @param visit_title String = "We’ll put the kettle on." label="Visit heading"
  @param address String = "18 Willow Lane" label="Street address"
  @param city String = "Bristol, BS1 4AA" label="City and postcode"
  @param weekday_hours String = "Monday–Friday · 7:30–17:00" label="Weekday hours"
  @param weekend_hours String = "Saturday–Sunday · 8:30–16:00" label="Weekend hours"
  @param visit_note Text = "Find us on the corner, just by the little green. Walk-ins welcome; no reservation needed." label="Visiting note"
@endsection

@layout
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Coffee made with care, seasonal food, and a welcoming place to pause." />
  <title>{{ brand }} — Coffee & good company</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body style="--accent: {{ accent }}">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header wrap"><a class="wordmark" href="#main"><svg viewBox="0 0 28 38" aria-hidden="true"><path d="M14 35V8M14 25C3 25 3 13 3 13s11 0 11 12Zm0-9C25 16 25 4 25 4S14 4 14 16Zm0 19C25 35 25 23 25 23s-11 0-11 12Z" /></svg><span>{{ brand }}</span></a><nav aria-label="Main navigation"><a href="#our-place">Our place</a><a href="#menu">The menu</a><a href="#visit">Find us</a></nav></header>
  <main id="main">
    <section class="hero wrap" data-block="hero">
      <div class="hero-copy"><p class="welcome">{{ opening_note }}</p><h1>{{ headline }}</h1><p class="introduction">{{ description }}</p><a class="button" href="{{ destination }}">{{ button }}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></a><p class="hero-address">{{ address }}<span>{{ city }}</span></p></div>
      <div class="hero-art"><img src="images/coffee-moment.svg" width="680" height="790" alt="Illustration of a creamy latte in a green ceramic cup, a fresh pastry, and a sprig of juniper on a cafe table." /><div class="art-caption"><span>A cup of something good.</span><span>A moment that’s yours.</span></div></div>
    </section>
    <section class="our-place wrap section-space" id="our-place" data-block="our-place"><div class="story-heading"><p class="section-label">Hello, neighbour.</p><h2>{{ story_title }}</h2></div><div class="story-copy"><p>{{ story }}</p><div class="small-sprig" aria-hidden="true"><svg viewBox="0 0 110 32"><path d="M4 29Q49 4 106 10M24 19 19 5M44 13 41 0M66 9 65 0M85 9 90 24M60 10 58 26M36 15 32 29" /></svg></div></div></section>
    <section class="details-band" data-block="cafe-details"><div class="wrap details-grid"><article><svg class="detail-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 17h26v14a10 10 0 0 1-10 10h-6A10 10 0 0 1 8 31V17Zm26 3h3a6 6 0 0 1 0 12h-3M7 45h30M16 4v6m10-6v6" /></svg><h3>A proper cup</h3><p>{{ coffee_note }}</p></article><article><svg class="detail-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 35c-6-7 0-19 7-19 2-10 16-10 19 0 8 0 13 11 7 18L30 28l-13 1-9 6ZM17 29l-2-13m15 12 4-12M8 35l-3 7 12-13m13-1 14 13-3-7" /></svg><h3>A little something</h3><p>{{ food_note }}</p></article><article><svg class="detail-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M7 6h34v36H7V6Zm17 0v36M7 25h34M10 45h28M13 19c1-6 5-8 5-8" /></svg><h3>A place to pause</h3><p>{{ space_note }}</p></article></div></section>
    <section class="menu wrap section-space" id="menu" data-block="menu"><div class="menu-intro"><p class="section-label">From our counter</p><h2>{{ menu_title }}</h2><p>{{ menu_note }}</p><div class="menu-doodle" aria-hidden="true"><svg viewBox="0 0 170 140"><ellipse cx="87" cy="103" rx="65" ry="18" /><path d="M45 56h68v29a27 27 0 0 1-27 27H72a27 27 0 0 1-27-27V56Zm68 6h9a15 15 0 0 1 0 30h-11M60 12c-16 17 16 17 0 34m24-35c-16 17 16 17 0 34" /></svg></div></div><div class="menu-list"><article><div><h3>{{ menu_one }}</h3><p>{{ menu_one_description }}</p></div><span>{{ menu_one_price }}</span></article><article><div><h3>{{ menu_two }}</h3><p>{{ menu_two_description }}</p></div><span>{{ menu_two_price }}</span></article><article><div><h3>{{ menu_three }}</h3><p>{{ menu_three_description }}</p></div><span>{{ menu_three_price }}</span></article><article><div><h3>{{ menu_four }}</h3><p>{{ menu_four_description }}</p></div><span>{{ menu_four_price }}</span></article><p class="dietary-note">{{ dietary_note }}</p></div></section>
    <section class="visit-section" id="visit" data-block="visit"><div class="wrap visit"><div class="visit-copy"><p class="section-label">Around the corner</p><h2>{{ visit_title }}</h2><p>{{ visit_note }}</p><a class="button button-light" href="{{ destination }}">{{ button }}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></a></div><div class="visit-details"><div><h3>Come find us</h3><address>{{ brand }}<br />{{ address }}<br />{{ city }}</address></div><div><h3>The door is open</h3><p>{{ weekday_hours }}<br />{{ weekend_hours }}</p></div></div></div></section>
  </main>
  <footer class="wrap"><a class="wordmark" href="#main">{{ brand }}</a><p>Coffee, good company, and a little everyday joy.</p><a href="#menu">Have a look at the menu</a></footer>
</body>
</html>
@endlayout
