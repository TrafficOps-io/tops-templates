import { generateProject, getDefaults, parseProject } from '@trafficops/template-runtime';

// The real failed request, not a reduced heading-only smoke test.
export const OPTIHEART_BRIEF = `Сделай рекламный прелендинг для OptiHeart на польском языке. Аудитория — жители Польши старше 55 лет. Тема — здоровье сердца и артериальное давление.

Главный блок — видеоплейсхолдер: кардиохирург в белом халате, хирургической шапочке и медицинских перчатках стоит в операционной. На фоне видны операционный стол и лампа.

Подготовь короткий сценарий: врач рассказывает о рисках сердечно-сосудистых заболеваний у пожилых людей и призывает своевременно заботиться о здоровье. Предусмотри сравнение смертности от сердечно-сосудистых заболеваний и ДТП. Вместо неподтверждённых цифр оставь места для статистики и ссылки на источник.

Добавь два видеоплейсхолдера для вставок во время речи врача:
1. Анатомическое сравнение сосудов с холестериновыми бляшками и без них.
2. Схематичная анимация коронарного шунтирования без крови и натуралистичных деталей.

Ниже размести краткую презентацию OptiHeart и кнопку «Dowiedz się więcej». Используй только подтверждённые сведения о продукте, без обещаний очищения сосудов или лечения заболеваний. Врач — вымышленный персонаж демонстрационного материала.
Сделай страницу удобной на телефоне и проверь результат.`;

// Representative persisted Polish/Russian project. Use --fixture for an actual
// exported PWA project; the health/news template is not checked into this repo.
export function optiheartInitialProject() {
  const files = {
    'index.tpl': `@template "Вести здоровья" version=1
@section content "Материал"
  @param site_name String = "ВЕСТИ ЗДОРОВЬЯ" label="Название сайта"
  @param headline String = "Новости о здоровье сердца" label="Заголовок"
  @param intro Text = "Текст статьи на русском языке." label="Вступление"
  @param product_name String = "OptiHeart" label="Продукт"
  @param product_text Text = "Описание продукта требует проверки." label="Описание"
  @param button String = "Узнать больше" label="Кнопка"
@endsection
@layout
<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{headline}}</title><link rel="stylesheet" href="styles.css"></head><body><header>{{site_name}}</header><main><h1>{{headline}}</h1><p>{{intro}}</p><section id="story"><h2>Материал о здоровье</h2><div class="video-placeholder">Видео врача</div></section><section id="product"><h2>{{product_name}}</h2><p>{{product_text}}</p><a href="#product-details">{{button}}</a><div id="product-details">Информация о продукте</div></section><section id="comments"><h2>Комментарии</h2><p>Пример комментария 1</p><p>Пример комментария 2</p><p>Пример комментария 3</p></section></main><footer>Демонстрационный материал</footer><script src="script.js"></script></body></html>
@endlayout
`,
    'styles.css': `* { box-sizing: border-box; } body { margin: 0; font: 18px/1.6 Arial, sans-serif; color: #173132; } header, main, footer { max-width: 960px; margin: auto; padding: 24px; } .video-placeholder { aspect-ratio: 16/9; background: #e6f1ed; border: 2px dashed #688983; border-radius: 12px; display: grid; place-content: center; padding: 24px; } .video-placeholder p { margin: 4px 0; } .button { display: inline-flex; min-height: 48px; align-items: center; padding: 12px 24px; border-radius: 8px; background: #146953; color: white; } @media (max-width: 600px) { header, main, footer { padding: 16px; } h1 { font-size: 30px; } .video-placeholder { aspect-ratio: auto; margin-inline: 0; min-height: 180px; } }`,
    'script.js': `document.documentElement.dataset.studioDemo = 'ready';`,
  };
  const definition = parseProject(files).definition;
  return { files, values: getDefaults(definition), definition };
}

export const optiheartCompletedLayout = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{headline}}</title><link rel="stylesheet" href="styles.css"></head><body><header>{{site_name}}</header><main><h1>{{headline}}</h1><p>{{intro}}</p>
<section id="story"><h2>Rozmowa o zdrowiu serca po 55. roku życia</h2>
<figure class="video-placeholder" data-video-placeholder="doctor"><figcaption>Wideo główne — fikcyjny kardiochirurg</figcaption><p>Kardiochirurg w białym fartuchu, czepku chirurgicznym i rękawiczkach medycznych stoi na sali operacyjnej. W tle: stół operacyjny i lampa.</p></figure>
<h3>Scenariusz wypowiedzi</h3><p>Wraz z wiekiem warto uważniej dbać o zdrowie serca i regularnie kontrolować ciśnienie tętnicze. Porozmawiaj ze swoim lekarzem o indywidualnym ryzyku chorób sercowo-naczyniowych i badaniach, które będą dla Ciebie odpowiednie. Zacznij dbać o zdrowie już dziś.</p>
<p data-statistic="cardiovascular">Zgony z powodu chorób sercowo-naczyniowych w Polsce: [UZUPEŁNIJ POTWIERDZONĄ LICZBĘ I ROK].</p><p data-statistic="traffic">Zgony w wypadkach drogowych w tym samym roku: [UZUPEŁNIJ POTWIERDZONĄ LICZBĘ].</p><p data-source-placeholder>Źródło i rok danych: [WSTAW LINK DO ŹRÓDŁA].</p>
<figure class="video-placeholder" data-video-placeholder="vessels"><figcaption>Wstawka 1 — porównanie naczyń</figcaption><p>Animacja anatomiczna pokazuje naczynia z blaszkami cholesterolowymi i bez nich. Głos lekarza trwa dalej podczas wstawki.</p></figure>
<figure class="video-placeholder" data-video-placeholder="bypass"><figcaption>Wstawka 2 — pomostowanie wieńcowe</figcaption><p>Schematyczna animacja pomostowania wieńcowego, bez krwi i drastycznych szczegółów. Głos lekarza trwa dalej podczas wstawki.</p></figure>
<p>To materiał demonstracyjny. Lekarz jest fikcyjną postacią.</p></section>
<section id="product"><h2>{{product_name}}</h2><p>{{product_text}}</p><a class="button" href="#product-details">{{button}}</a><div id="product-details">Potwierdzone informacje o produkcie: [UZUPEŁNIJ NA PODSTAWIE DOKUMENTACJI].</div></section></main><footer>Materiał demonstracyjny dla mieszkańców Polski w wieku 55+.</footer><script src="script.js"></script></body></html>`;

export const optiheartCompletedValues = {
  site_name: 'ZDROWIE SERCA', headline: 'Zadbaj o serce po 55. roku życia',
  intro: 'Rozmowa o zdrowiu serca i ciśnieniu tętniczym dla mieszkańców Polski po 55. roku życia.',
  product_name: 'OptiHeart', product_text: 'OptiHeart — prezentacja demonstracyjna. Szczegółowy opis i skład należy uzupełnić na podstawie potwierdzonej dokumentacji produktu.',
  button: 'Dowiedz się więcej',
};

function stripTags(html) { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '); }

// These checks cover concrete structural omissions. Visual quality and medical
// factual accuracy still require inspecting the rendered output and its sources.
export function inspectOptiheartDraft({ files, values }) {
  const rendered = generateProject(files, values, { locale: 'pl' });
  const entry = Object.keys(rendered).find(path => /^index\.html$/i.test(path)) || Object.keys(rendered).find(path => path.endsWith('.html'));
  if (!entry) throw new Error('The final project has no rendered HTML page.');
  const html = String(rendered[entry]), text = stripTags(html);
  const placeholders = [...html.matchAll(/<(?:figure|div|section|article)\b[^>]*(?:data-video-placeholder|(?:class|id)=["'][^"']*(?:video|wideo)[^"']*)[^>]*>/gi)].map(match => match[0]);
  const localReferences = [];
  for (const [path, content] of Object.entries(rendered)) {
    if (typeof content !== 'string' || !/\.(?:html|css)$/i.test(path)) continue;
    const pattern = path.endsWith('.css') ? /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi : /(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) continue;
      const asset = new URL(value.split(/[?#]/)[0], `https://studio-test.invalid/${path}`).pathname.replace(/^\//, '');
      if (asset && !Object.hasOwn(rendered, asset)) localReferences.push({ page: path, asset });
    }
  }
  const checks = {
    independentReviewApproved: null,
    polishLanguage: /<html\b[^>]*\blang=["']pl(?:-PL)?["']/i.test(html) && !/[А-Яа-яЁё]/.test(text),
    mobileViewport: /<meta\b(?=[^>]*\bname=["']viewport["'])(?=[^>]*\bcontent=["'][^"']*width=device-width)[^>]*>/i.test(html),
    audienceAndPressure: /55/.test(text) && /ciśnieni/i.test(text) && /serc/i.test(text),
    threeVideoPlaceholders: placeholders.length >= 3,
    doctorAndOperatingRoom: /kardiochirurg/i.test(text) && /fartuch/i.test(text) && /czep(?:ek|ku)/i.test(text) && /rękawiczk/i.test(text) && /(?:sal[aię] operacyjn|operacyjnej)/i.test(text) && /stół|stołu/i.test(text) && /lamp/i.test(text),
    vesselsComparison: /naczy[nń]|naczyni/i.test(text) && /blaszk/i.test(text) && /cholesterol/i.test(text),
    bypassAnimation: /pomostowani|bypass|szuntowani/i.test(text) && /animacj/i.test(text) && /bez krwi/i.test(text),
    statisticsPlaceholdersAndSource: /chor[oó]b sercowo-naczyniowych/i.test(text) && /wypadk(?:ach|ów|i)? drogow/i.test(text) && /\[[^\]]*(?:LICZB|DAN|UZUPEŁNIJ)[^\]]*\]/i.test(text) && /źr[oó]dł/i.test(text),
    fictionalDoctorLabel: /fikcyjn[a-ząćęłńóśźż]* (?:postaci|kardiochirurg|lekarz)|lekarz jest fikcyjn/i.test(text),
    productAndCta: /OptiHeart/i.test(text) && /Dowiedz się więcej/i.test(text),
    noMissingLocalAssets: localReferences.length === 0,
  };
  return { entry, rendered, checks, missingLocalAssets: localReferences, videoPlaceholderCount: placeholders.length,
    manualChecks: ['Check the page at mobile and desktop widths.', 'Verify statistics and product claims against the supplied primary sources before replacing placeholders.', 'Review visible Polish copy and the doctor/vessel/bypass scene descriptions.'] };
}
