@template "Clay School" version=1 description="An inviting pottery course page with a sculptural illustration, a four-week curriculum, tutor introduction and enrolment details."

@section identity "Studio and action"
  @param brand String = "Clay School" label="Studio name" required
  @param headline String = "A little clay. A whole new rhythm." label="Headline" required
  @param description Text = "Put the screens away. Get your hands into something real. A four-week introduction to hand-building, made for the beautifully curious." label="Introduction"
  @param accent Color = "#8e482d" label="Accent color"
  @param destination Url = "https://example.com" label="Booking URL"
  @param button String = "Find your place at the table" label="Button label"
@endsection

@section course "Course details"
  @param potteryImage Image = "assets/pottery.svg" label="Pottery illustration"
  @param potteryImageAlt String = "A sculptural clay vase, a handmade bowl and a small cup on a plum-colored studio shelf" label="Image description"
  @param courseName String = "The hand-building course" label="Course name"
  @param courseLength String = "4 weeks" label="Course duration"
  @param schedule String = "Saturday mornings, 10:00–12:30" label="Class schedule"
  @param location String = "The garden studio" label="Studio location"
  @param price String = "€180" label="Course price"
  @param materials Text = "Clay, tools, glazes and two firings are included. Just bring clothes you do not mind getting a little dusty." label="What's included"
  @param instructor String = "Mara Ellis" label="Instructor name"
  @param instructorBio Text = "Mara is the example tutor for this demo course. Replace this introduction with your teacher's story, approach and relevant experience before sharing your page." label="Instructor introduction"
  @param bookingNote Text = "This is a demo course. Set your upcoming dates, studio address and booking link before opening enrolment." label="Booking details"
@endsection

@layout
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A four-week introduction to hand-building pottery, made for the beautifully curious.">
  <title>{{ brand }} — {{ courseName }}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body style="--accent: {{ accent }}">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" data-block="Navigation"><a class="wordmark" href="#home"><span class="pot-mark" aria-hidden="true"></span>{{ brand }}</a><nav aria-label="Main navigation"><a href="#course">The course</a><a href="#teacher">Your teacher</a><a class="nav-book" href="#enrol">Come make something <span aria-hidden="true">↗</span></a></nav></header>
  <main id="main">
    <section class="hero" id="home" data-block="Hero"><div class="hero-copy"><p class="course-label">Good company. Muddy hands.</p><h1>{{ headline }}</h1><p class="intro">{{ description }}</p><a class="button" href="{{ destination }}">{{ button }} <span aria-hidden="true">↗</span></a><p class="beginner-note">No experience needed. Your hands are enough.</p></div><figure class="hero-art"><img src="{{ potteryImage }}" alt="{{ potteryImageAlt }}" width="700" height="840"><figcaption><span>Made slowly.</span><span>Made by you.</span></figcaption></figure></section>
    <section class="course-facts" aria-label="Course at a glance" data-block="Course overview"><div><span>A little time for yourself</span><strong>{{ courseLength }}</strong></div><div><span>Our weekly gathering</span><strong>{{ schedule }}</strong></div><div><span>A place to make</span><strong>{{ location }}</strong></div><div><span>A fresh beginning</span><strong>Everyone welcome</strong></div></section>
    <section class="curriculum page-width" id="course" data-block="Curriculum"><div class="section-intro"><p class="section-label">{{ courseName }}</p><h2>From a lump of clay<br>to something you love.</h2><p>Learn the fundamentals one small discovery at a time. Come for the making; stay for the feeling of finding your own way.</p><a class="quiet-link" href="#enrol">See the practical details <span aria-hidden="true">↗</span></a></div><ol class="week-list"><li><span class="week-number">1</span><div><span class="week-label">First, get a feel for it</span><h3>Meet your material</h3><p>Explore the clay, learn to prepare it and pinch your first small bowl. There is no perfect shape to chase.</p></div><span class="week-shape pinch" aria-hidden="true"></span></li><li><span class="week-number">2</span><div><span class="week-label">Build a little confidence</span><h3>One coil at a time</h3><p>Stack, smooth and join. Use simple coils to build a vessel with its own character.</p></div><span class="week-shape coil" aria-hidden="true"></span></li><li><span class="week-number">3</span><div><span class="week-label">Find your own form</span><h3>Make it yours</h3><p>Roll a slab, cut a shape and bring a personal project to life with texture and thoughtful details.</p></div><span class="week-shape slab" aria-hidden="true"></span></li><li><span class="week-number">4</span><div><span class="week-label">The finishing touch</span><h3>A play with glaze</h3><p>Explore color and surface, finish your pieces and learn what happens inside the kiln.</p></div><span class="week-shape glaze" aria-hidden="true"></span></li></ol></section>
    <section class="making" data-block="Studio approach"><div class="making-inner page-width"><div class="making-title"><span class="loop-drawing" aria-hidden="true"></span><h2>Not quite round.<br>Entirely your own.</h2></div><div class="making-copy"><p>We like thumbprints, wonky rims and the unexpected thing that happens when you try. This is a space to learn through making, with time to ask questions and start again.</p><div class="studio-values"><p><strong>Slow is a good speed.</strong> Enough time to settle in and enjoy the process.</p><p><strong>You have what you need.</strong> {{ materials }}</p></div></div></div></section>
    <section class="teacher page-width" id="teacher" data-block="Instructor"><div class="teacher-art" aria-hidden="true"><span class="teacher-art-note">A seat for you.</span><div class="studio-still-life"><span class="studio-table"></span><span class="clay-cup"></span><span class="wooden-tool"></span><span class="clay-ring"></span><span class="clay-ball"></span></div><span class="teacher-art-caption">A practice in paying attention</span></div><div class="teacher-copy"><p class="section-label">Meet your teacher</p><h2>Hello, I'm {{ instructor }}.</h2><p>{{ instructorBio }}</p><p>Our starting point is simple: try it, feel it, see where it takes you. We'll build the basics together, and leave room for your ideas.</p><a class="quiet-link" href="#course">Explore what we'll make <span aria-hidden="true">↗</span></a></div></section>
    <section class="enrol-section" id="enrol" data-block="Enrolment"><div class="enrol page-width"><div class="enrol-copy"><p class="section-label">Your next small adventure</p><h2>There is a place<br>for you here.</h2><p>{{ bookingNote }}</p></div><article class="enrol-card"><div class="enrol-card-heading"><h3>{{ courseName }}</h3><p class="price">{{ price }}<span>for the full course</span></p></div><dl><div><dt>Duration</dt><dd>{{ courseLength }}</dd></div><div><dt>When</dt><dd>{{ schedule }}</dd></div><div><dt>Where</dt><dd>{{ location }}</dd></div></dl><p class="materials">{{ materials }}</p><a class="button" href="{{ destination }}">{{ button }} <span aria-hidden="true">↗</span></a></article></div></section>
    <section class="faq page-width" data-block="Frequently asked questions"><h2>A few things you might be wondering.</h2><div><details><summary>Do I need to have done this before?</summary><p>No. We start with the basics, from preparing the clay to making your first pinch pot. Bring your curiosity; we will take it from there.</p></details><details><summary>What should I bring?</summary><p>{{ materials }} Short nails can make hand-building easier, and an apron is always useful.</p></details><details><summary>When can I take my pieces home?</summary><p>Your work needs to dry and go through the kiln. Your teacher will explain the firing and collection schedule during the course.</p></details></div></section>
  </main>
  <footer class="site-footer page-width" data-block="Footer"><a class="wordmark" href="#home"><span class="pot-mark" aria-hidden="true"></span>{{ brand }}</a><p>A good thing to do with your hands.</p><a href="#enrol">Course details</a></footer>
</body>
</html>
@endlayout
