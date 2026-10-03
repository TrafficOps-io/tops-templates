@template "Common Ground" version=1 description="A bright, editorial landing page for a creative gathering."

@section content "Event & introduction"
  @param brand String = "Common Ground" label="Event name" required
  @param headline String = "Better ideas happen together." label="Headline" required
  @param description Text = "A day for curious people to share what they’re making, ask better questions, and find their next collaborator." label="Introduction"
  @param accent Color = "#efdd3d" label="Poster color"
  @param date String = "18 September 2027" label="Event date"
  @param time String = "10:00–18:00" label="Event hours"
  @param venue String = "The Assembly Hall" label="Venue"
  @param address String = "24 Foundry Lane, London" label="Venue address"
  @param button String = "Get your ticket" label="Ticket button"
  @param destination Url = "https://example.com" label="Ticket destination"
@endsection

@section program "Programme"
  @param program_title String = "Leave room for the unexpected." label="Programme heading"
  @param program_intro Text = "Short talks, open conversations, and time to make something with someone you’ve just met. Here’s the shape of our day." label="Programme introduction"
  @param first_time String = "10:00" label="First session time"
  @param first_title String = "Arrive, meet, get curious" label="First session title"
  @param first_description Text = "Coffee, introductions, and a few questions to get the room talking." label="First session description"
  @param second_time String = "11:00" label="Second session time"
  @param second_title String = "Ideas in the open" label="Second session title"
  @param second_description Text = "Three perspectives on making things that bring people together." label="Second session description"
  @param third_time String = "14:00" label="Third session time"
  @param third_title String = "Make a little noise" label="Third session title"
  @param third_description Text = "A hands-on workshop. Bring a question; leave with a first experiment." label="Third session description"
  @param fourth_time String = "16:30" label="Fourth session time"
  @param fourth_title String = "Keep the conversation going" label="Fourth session title"
  @param fourth_description Text = "Share what you made, swap notes, and stay for the closing gathering." label="Fourth session description"
@endsection

@section people "Speakers"
  @param speakers_title String = "Different minds. Shared ground." label="Speakers heading"
  @param speaker_one String = "Maya Chen" label="First speaker"
  @param speaker_one_role String = "Designer & community organiser" label="First speaker role"
  @param speaker_one_talk String = "Designing for the people in the room" label="First speaker topic"
  @param speaker_two String = "Alex Morgan" label="Second speaker"
  @param speaker_two_role String = "Independent creative technologist" label="Second speaker role"
  @param speaker_two_talk String = "A useful kind of unfinished" label="Second speaker topic"
  @param speaker_three String = "Sam Rivera" label="Third speaker"
  @param speaker_three_role String = "Artist & workshop facilitator" label="Third speaker role"
  @param speaker_three_talk String = "Making space to play" label="Third speaker topic"
@endsection

@section tickets "Tickets"
  @param ticket_title String = "There’s a place for you here." label="Ticket heading"
  @param ticket_price String = "£45" label="Ticket price"
  @param ticket_details Text = "One full day. All talks and workshops, coffee, and a shared lunch included." label="Ticket details"
  @param access_note Text = "The venue has step-free access. Contact the organiser through the ticket page with any access or dietary requirements." label="Accessibility information"
@endsection

@layout
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="A day of talks, workshops, and open conversations for creative minds." />
  <title>{{ brand }} — {{ date }}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body style="--accent: {{ accent }}">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header wrap">
    <a class="wordmark" href="#main">{{ brand }}<span class="brand-dot" aria-hidden="true"></span></a>
    <nav aria-label="Main navigation"><a href="#programme">Programme</a><a href="#speakers">Speakers</a><a class="nav-ticket" href="#tickets">Tickets</a></nav>
  </header>
  <main id="main">
    <section class="hero wrap" data-block="hero">
      <div class="hero-caption"><span>A gathering for creative minds</span><span>{{ date }}</span></div>
      <div class="poster">
        <div class="poster-copy"><h1>{{ headline }}</h1><p>{{ description }}</p><a class="button button-dark" href="{{ destination }}">{{ button }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg></a></div>
        <img class="poster-art" src="images/common-ground.svg" alt="Overlapping violet circles and an open yellow circle, a symbol of people coming together." width="620" height="720" />
      </div>
      <dl class="event-facts"><div><dt>When</dt><dd>{{ date }}<span>{{ time }}</span></dd></div><div><dt>Where</dt><dd>{{ venue }}<span>{{ address }}</span></dd></div><div><dt>What to bring</dt><dd>Your curiosity.<span>We’ll take care of the coffee.</span></dd></div></dl>
    </section>
    <section class="programme wrap section-space" id="programme" data-block="programme">
      <div class="section-intro"><p class="section-label">The programme</p><h2>{{ program_title }}</h2><p>{{ program_intro }}</p></div>
      <ol class="schedule">
        <li><span class="session-time">{{ first_time }}</span><div><h3>{{ first_title }}</h3><p>{{ first_description }}</p></div></li>
        <li><span class="session-time">{{ second_time }}</span><div><h3>{{ second_title }}</h3><p>{{ second_description }}</p></div></li>
        <li><span class="session-time">{{ third_time }}</span><div><h3>{{ third_title }}</h3><p>{{ third_description }}</p></div></li>
        <li><span class="session-time">{{ fourth_time }}</span><div><h3>{{ fourth_title }}</h3><p>{{ fourth_description }}</p></div></li>
      </ol>
    </section>
    <section class="speakers-section" id="speakers" data-block="speakers">
      <div class="wrap section-space"><div class="speaker-heading"><p class="section-label">Meet the speakers</p><h2>{{ speakers_title }}</h2></div>
        <div class="speaker-grid">
          <article class="speaker"><div class="speaker-art art-one" aria-hidden="true"><span></span><span></span><span></span></div><h3>{{ speaker_one }}</h3><p class="speaker-role">{{ speaker_one_role }}</p><p class="speaker-talk">{{ speaker_one_talk }}</p></article>
          <article class="speaker"><div class="speaker-art art-two" aria-hidden="true"><span></span><span></span><span></span></div><h3>{{ speaker_two }}</h3><p class="speaker-role">{{ speaker_two_role }}</p><p class="speaker-talk">{{ speaker_two_talk }}</p></article>
          <article class="speaker"><div class="speaker-art art-three" aria-hidden="true"><span></span><span></span><span></span></div><h3>{{ speaker_three }}</h3><p class="speaker-role">{{ speaker_three_role }}</p><p class="speaker-talk">{{ speaker_three_talk }}</p></article>
        </div>
      </div>
    </section>
    <section class="tickets wrap section-space" id="tickets" data-block="tickets">
      <div class="ticket-copy"><p class="section-label">Come along</p><h2>{{ ticket_title }}</h2><p>{{ access_note }}</p></div>
      <div class="ticket"><div class="ticket-top"><span>Day ticket</span><strong>{{ ticket_price }}</strong></div><p>{{ ticket_details }}</p><a class="button button-dark" href="{{ destination }}">{{ button }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg></a><div class="ticket-stub">{{ brand }}<span>{{ date }}</span></div></div>
    </section>
  </main>
  <footer class="wrap"><a class="wordmark" href="#main">{{ brand }}</a><p>Good company. New possibilities.</p><a href="#programme">Explore the day</a></footer>
</body>
</html>
@endlayout
