import { starterProject } from './starter.js';

export const studioStarters = [
  { id: 'starter-launch', name: 'A fresh beginning', description: 'An editorial launch page with an image and a clear call to action.', files: starterProject(), folders: ['images'], settings: {}, kind: 'template', builtin: true },
  { id: 'starter-product', name: 'Product spotlight', description: 'A bold product introduction, benefits and a conversion section.', files: productProject(), folders: [], settings: {}, kind: 'template', builtin: true },
  { id: 'starter-service', name: 'Independent studio', description: 'A quiet portfolio for a service, studio or independent maker.', files: serviceProject(), folders: [], settings: {}, kind: 'template', builtin: true },
];

function page({ name, title, description, body, background, accent }) {
  return {
    'index.tpl': `@template "${name}" version=1

@section content "Content"
  @param brand String = "${name}" label="Brand name" required
  @param headline String = "${title}" label="Headline" required
  @param description Text = "${description}" label="Description"
  @param button String = "Let's get started" label="Button label"
  @param destination Url = "https://example.com" label="Button destination"
  @param accent Color = "${accent}" label="Accent color"
@endsection

@layout
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <title>{{ headline }}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body style="--accent: {{ accent }}">
    <header><strong>{{ brand }}</strong><a href="#contact">Get in touch ↗</a></header>
    <main><section class="hero"><p class="eyebrow">MADE FOR WHAT COMES NEXT</p><h1>{{ headline }}</h1><p class="intro">{{ description }}</p><a class="button" href="{{ destination }}">{{ button }} ↗</a></section>
    ${body}
    <section id="contact" class="contact"><h2>Good things start here.</h2><a class="button" href="{{ destination }}">{{ button }} ↗</a></section></main>
    <footer>{{ brand }} · Thoughtfully made.</footer>
  </body>
</html>
@endlayout
`,
    'styles.css': `:root { font-family: Arial, sans-serif; color: ${background === '#171d28' ? '#f7f5ef' : '#26302d'}; background: ${background}; }
* { box-sizing: border-box; } html { scroll-behavior: smooth; } body { margin: 0; } header, main, footer { width: min(1080px, 86%); margin: auto; } a { color: inherit; } header { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: 32px 0; border-bottom: 1px solid #8884; font-size: 14px; } header a { text-decoration: none; } .hero { padding: 90px 0 70px; max-width: 820px; } .eyebrow { font-size: 11px; letter-spacing: .18em; color: var(--accent); font-weight: 700; } h1 { font-size: clamp(42px, 7vw, 88px); letter-spacing: -.065em; line-height: 1.02; margin: 26px 0; } .intro { font-size: 18px; line-height: 1.7; max-width: 580px; opacity: .75; } .button { display: inline-block; background: var(--accent); color: #15211a; text-decoration: none; padding: 17px 23px; margin-top: 20px; font-weight: 700; border-radius: 7px; } .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; } article { border: 1px solid #8884; padding: 28px; border-radius: 14px; } article span { color: var(--accent); font-size: 13px; } article p { opacity: .7; line-height: 1.7; font-size: 14px; } h2 { font-size: clamp(28px, 4vw, 42px); letter-spacing: -.04em; } h3 { font-size: 22px; } .contact { padding: 70px 0; } footer { border-top: 1px solid #8884; padding: 26px 0; opacity: .6; font-size: 12px; } @media (max-width: 640px) { .hero { padding: 55px 0; } .grid { grid-template-columns: 1fr; } header { font-size: 12px; } }`,
  };
}
function productProject() {
  return page({ name: 'Orbit', title: 'Less busywork. More possibility.', description: 'Give your next big idea the space it deserves. One thoughtful product to bring your work together.', background: '#171d28', accent: '#bef264', body: '<section class="grid" aria-label="Benefits"><article><span>01 / FOCUS</span><h3>A clearer day</h3><p>Keep the important things in view and find your own rhythm.</p></article><article><span>02 / FLOW</span><h3>Made to connect</h3><p>Bring your work together in a space that feels natural.</p></article><article><span>03 / GROW</span><h3>Room to evolve</h3><p>Start small. Make it yours. Build something that lasts.</p></article></section>' });
}
function serviceProject() {
  return page({ name: 'Forma Studio', title: 'Thoughtful work. Lasting impressions.', description: 'An independent studio shaping identities and digital experiences for people with something to say.', background: '#f4f0e6', accent: '#b7caad', body: '<section class="grid" aria-label="Services"><article><span>01</span><h3>Strategy</h3><p>A shared direction, grounded in what makes your business different.</p></article><article><span>02</span><h3>Identity</h3><p>A considered visual language, from the first impression to the smallest detail.</p></article><article><span>03</span><h3>Digital</h3><p>Clear, useful experiences that turn attention into connection.</p></article></section>' });
}
