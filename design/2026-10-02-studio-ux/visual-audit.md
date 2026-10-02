# Визуальный и UX аудит текущего редизайна

Дата: 2026-10-02. Только чтение source. Проверены свежие локальные docs и Studio в отдельных временных browser contexts; PWA имитирована `navigator.standalone=true`. Внешние запросы блокировались, API keys не вводились, генерация не запускалась. Созданные проекты и richtext fixture существуют только в изолированных IndexedDB profiles.

Снимки: `/Users/igorolshevsky/.codex/visualizations/2026/10/02/01a0fca6-8aa0-7d91-8d89-5d05275f13bb/templates-redesign-v2/audit/`.
Метрики: `/tmp/trafficops-redesign-v2/measurements.json`. Controls counts там включают DOM-hidden controls; они НЕ используются как подсчёт видимой сложности.
Dev servers: editor `http://127.0.0.1:5177/` (предыдущий PID 68801), docs `http://127.0.0.1:5178/tops-templates/` (поднят в этом аудите, PID 21131, exec session 64026). Их не останавливал.

## Что было просмотрено и сравнено

- Предыдущие before/final: docs home; web home; PWA home; workspace Content, Code, Conversations; mobile Content. Источник `templates-redesign/`: `docs-before-desktop`, `docs-final-desktop`, `before/after-studio-home`, `before/after-pwa-home`, `workspace-before-light`, `workspace-final-light`, `workspace-final-code`, `workspace-final-conversations`, `workspace-before-mobile`, `workspace-final-mobile-light`.
- Свежие: docs home desktop/mobile, article desktop, syntax mobile, sidebar mobile, initial search; web + installed PWA empty/populated libraries, new-project template/blank, Content Identity/Your message, Code, Conversations unconfigured, AI settings, selection empty, export menu/dialog, More menu, quick start, mobile Files/Edit/Preview, richtext WYSIWYG+Markdown desktop/mobile.
- Проверено, что starter previews действительно появляются при прокрутке. Пустые iframe на fullPage screenshot до прокрутки вызваны lazy IntersectionObserver и не являются доказанным runtime failure. Использовать `*-starters-scrolled.png` для оценки карточек, а не пустые fullPage thumbnails.
- Source-only rare states: AI run streaming/review/failed/conflict/recovery, richtext insert/link/crop details, ZIP continuation/folder transfer. Их функциональные invariants и дополнительные возможности описаны в `/tmp/trafficops-redesign-v2/feature-inventory.md`; новые live/provider runs аудит не делал.

## Что улучшил предыдущий проход и нужно сохранить

Palette, Onest, тема, точный бренд TrafficOps, крупная типографика и спокойные surfaces теперь последовательно согласованы. Убраны декоративные grid/glow фоны home, карточки быстрых действий заменены более лёгкими строками, preview стал спокойнее, сравнение source/output в docs понятнее условного pipeline diagram. У form fields читаемые подписи, у большинства icon actions есть accessible name/title, меню используют existing primitives, error/setup/recovery states в source присутствуют. На просмотренных 390px screens horizontal overflow отсутствует.

Проблема второго прохода прежде всего в приоритизации задач, количестве одновременно предъявленных выборов и доступе к скрытым функциям. Новая смена шрифта/палитры или добавление motion не решит эти причины.

## Подтверждённые проблемы по приоритету

### P1. Ручное создание в PWA приводит в неподходящий режим

Fresh PWA: `Use A fresh beginning` → dialog с выбранным template → `Create landing` → открыт **Conversations**, пустой разговор и `Connect OpenRouter`. Browser тот же сценарий открывает Content. Пользователь выбрал готовый starter, но должен сам догадаться переключить режим, чтобы редактировать его вручную. Особенно заметно без API key: основной экран предлагает внешний setup вместо только что выбранной задачи.

Evidence: `pwa-workspace-content.png` (несмотря на имя файла фактический initial tab Conversations), `web-workspace-content.png`; воспроизведено при fresh creation дважды. Source `packages/template-editor-shell/src/EditorShell.jsx:46` выбирает initial tab по наличию conversations port (`host.conversations || host.ai?.initialRequest`), а не по намерению создания. Возможность AI должна оставаться доступной; opening intent сейчас потерян.

### P1. Compact Conversations теряет функции управления

Подтверждено inventory/source: full thread sidebar содержит search/archive/restore/delete, но narrow chat header предлагает только открытые threads. При мобильной ширине скрывается sidebar, поэтому привычные функции становятся недостижимыми через видимую навигацию. Это functional accessibility gap, а не повод удалить возможности ради чистого вида. Состояние подтверждено source в feature inventory; отдельный screenshot populated archived thread не снимался.

### P1. Возврат к существующему проекту конкурирует с созданием нового

Web и PWA держат onboarding hero и starters постоянно, даже когда уже есть проекты. На desktop PWA saved library начинается только около y=725; на мобильном AIhero занимает почти весь первый экран. С одним проектом mobile document высотой 2696px в browser и 2855px в PWA. Первое действие возврата в редактор находится ниже hero, filters/search и import row; это ощутимое сканирование и прокрутка для повторной ежедневной задачи.

Evidence: `web-populated-library.png`, `pwa-populated-library.png`, `web-home-mobile.png`, `pwa-home-mobile.png`. Included starters и создание полезны, но текущий экран не различает first visit и return visit. Background AI activity должна оставаться заметной после любых будущих изменений.

### P2. Несколько путей создания повторяют одну и ту же развилку

Browser одновременно показывает `New project`, `From a template`, `Start from scratch`, three starter previews и three `Use template`; все пути вновь ведут в dialog с creation method + Project type. PWA добавляет отдельный большой AI composer, Landing/Reusable selector, sample ideas и аналогичный AI mode внутри New project dialog. Пользователь получает несколько входов с похожими словами, но разным default mode.

Evidence: `web-home-desktop.png`, `pwa-home-desktop.png`, `web-create-desktop.png`, `pwa-create-desktop.png`. При создании из выбранного starter снова показывается picker всех starters; контекст пользователя есть в state, но визуальная форма выглядит как новая развилка. Project type раскрыт даже для ручного workflow и занимает заметную часть mobile modal (`pwa-create-mobile.png`). Оба типа и direct starter/blank entry нужно сохранить, но число повторных решений следует считать, а не только размеры карточек.

### P2. Mobile editor имеет три уровня навигации одновременно

Верх: Content/Code/Conversations, второй ряд: parameter Sections (или файл/chat header), низ: Files/Edit/Preview. В Content пользователь видит две разные системы выбора режима и секцию. Files pane сохраняет mode row, хотя task сейчас управление файлами. Preview mode сохраняет modes и показывает отдельную toolbar устройств. Термины Files и Code близки по смыслу, но переключают разные оси. Нужен ясный порядок: какой выбор определяет задачу, какой panel, какой контекст.

Evidence: `pwa-workspace-mobile.png`, `pwa-files-mobile.png`, `pwa-preview-mobile.png`, `pwa-richtext-mobile.png`; та же topology видна в предыдущем `workspace-before-mobile.png` и `workspace-final-mobile-light.png`. Предыдущий проход улучшил spacing и selected state, но не уменьшил количество осей выбора. Current mobile navigation работает, её нельзя просто спрятать.

### P2. На mobile отсутствует видимый статус сохранения текущих изменений

Desktop toolbar показывает Saved/Saving/Unsaved; на mobile `.studio-toolbar-status` скрыт (shell.css:632). Остаётся нижняя строка `Interactive preview · JavaScript enabled`, то есть технический статус preview, а не сохранность работы. Пользователь видит потенциально важный footer, но по нему нельзя понять, ушла ли последняя правка в autosave. При ошибке не должно теряться recovery/export action.

Evidence: `web-workspace-mobile.png`, `pwa-workspace-mobile.png`, `pwa-richtext-mobile.png`; desktop `web-workspace-content.png`. Static preview notice полезен в контексте preview, но сейчас постоянно занимает высоту content/file panes. Требование для следующего прохода: normal save state и exceptional state должны быть различимы на touch screens без открытия техничного menu.

### P2. Secondary technical controls привлекают слишком много внимания

Reset defaults, Load JSON, Save JSON постоянно под form, даже когда в секции всего Brand name + Accent color. Image field одновременно предъявляет path textbox, image thumbnail, `Crop & resize`, drop zone с ещё одной подписью `Crop & resize before adding`, AI image generation, explanatory note. Richtext сразу показывает полную formatting toolbar на каждом поле, включая пустое/неактивное поле; два richtext fields удваивают toolbar, Markdown добавляет ещё Visual/source navigation. Эти функции нужны, но их общая поверхность равна или превышает главную задачу редактирования содержимого.

Evidence: `web-workspace-content.png`, `pwa-content-message.png`, `pwa-richtext.png`, `pwa-richtext-mobile.png`. Размеры Content column ~460px desktop, rich toolbar wrap на 2 строки desktop и mobile. Любое disclosure должно сохранять keyboard focus/selection и не remount Tiptap на autosave.

### P2. Export предлагает выбрать одну вещь дважды и имеет слабую форму

Сначала primary Export открывает menu Landing for hosting / Editable project. Выбор затем открывает modal с тем же выбором в select `Export destination`. Это format/export purpose, а не физический destination. Include conversation history checkbox находится почти в центре, label ниже/слева отдельной строкой и выглядит несвязанным. Общая form height ~440px для двух вариантов и одного toggle; spacing выражает одинаковый вес всем элементам, а не связи.

Evidence: `pwa-export-menu.png`, `pwa-export-dialog.png`, `web-export-dialog.png`. Форматы и optional conversation-history semantics обязательны; объём download/data safety не меняются.

### P2. Docs home дольше объясняет систему, чем помогает выбрать путь

В hero крупный abstract `Templates that remain data`, длинное описание, вторичный `Explore the language`, disclaimer и real sample frame. Ниже идут три тезиса, затем workflow chooser (Studio/CLI/PHP), затем второй похожий code example. На 390px home высотой 3242px и путь `Open the editor` находится лишь после sample frame и feature strip. Page соответствует бренду, но смешивает intro marketing и documentation index. Первый fold не помогает человеку сразу выбрать «делаю страницу» / «ищу syntax» / «интегрирую PHP».

Evidence: `docs-home-desktop.png`, `docs-home-mobile.png`; compare `docs-before-desktop.png`/`docs-final-desktop.png`. Real examples важны, но повторение кода без new task progress увеличивает длину страницы. URL slugs, anchors и reference content сохраняются.

### P3. Docs navigation дублирует уровни и header конкурирует с чтением

Desktop: top nav Guide/Language/PHP/CLI & Editor/Agent skills и sidebar повторяют те же destinations, рядом Search/Theme/GitHub/Studio. Article содержит третью навигацию On this page. Эти три уровня выполняют разную работу, но одинаковые короткие label groups заставляют заново оценивать, где текущая секция. Mobile отдельно имеет global hamburger и section Menu; page title Overview сам по себе не сообщает принадлежность/последовательность tutorial.

Evidence: `docs-guide-desktop.png`, `docs-mobile-menu.png`, `docs-language-mobile.png`. Текущие reading widths, active nav, outline, code copy, local search, prev/next работают; это точки сохранения. Search initial screen — аккуратный штатный VitePress pattern, не требует декоративной замены (`docs-search.png`).

### P3. Много микротекста и декоративных повторов

Home `YOUR WORKSPACE`, `INCLUDED STARTERS`, handwritten-sounding “A starting point, made yours”, “Your source. Your workspace.” повторяют смысл заголовков. `Local by design` в header, saved-on-device subtitle, empty helper, storage note и footer повторяют locality, а пользователь всё ещё должен понимать device vs folder separately. Theme controls занимают три отдельные позиции в header (system/light/dark), хотя это occasional preference. Help modal повторяет workflow одновременно в diagram, numbered icon rows, text и tags.

Evidence: `web-home-desktop.png`, `pwa-home-desktop.png`, `pwa-more-menu.png`, `pwa-help.png`. В quick-start screenshot последняя строка ещё в transition; это не contrast bug, animation .45s + stagger. Декоративный шум обсуждать отдельно от полезного предупреждения об AI/folder capability boundary.

## Границы и критерии для последующего brainstorm

Это аудит, не окончательный дизайн или implementation plan. Сохраняем точную identity TrafficOps, Onest, light/dark/system tokens, Lucide как существующую dependency, все capabilities и data/recovery contracts из inventory. Не требуется новая библиотека, stock/generated изображение, motion или новый dashboard framework. Skill design-taste применяется к public docs/home contextual; code editor и multi-step product flows прямо вне его marketing scope.

Измеряем результат через задачи: ручное создание приводит к ручному редактированию; existing project достижим до длинного onboarding; все conversation functions доступны при narrow width; mobile сообщает сохранность; создание/export не повторяют уже принятые решения; редкие технические действия доступны без постоянного предъявления; docs landing помогает выбрать workflow и сохраняет чтение/search/reference navigation. Это должно направлять следующие этапы brainstorm и plan review.
