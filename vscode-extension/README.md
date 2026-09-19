# TrafficOps Templates для VS Code

Подсветка синтаксиса, IntelliSense и formatter для DSL шаблонов Fast Landings v1. Типы вроде `Comment` объявляет автор шаблона через `@type`; расширение читает эти объявления и подключаемые через `@include` файлы.

## Возможности

- Подсветка директив, типов, параметров, блоков, значений и `{{ интерполяций }}` вместе с HTML, CSS и JavaScript.
- Дополнение директив и готовые snippets для шаблона, секций, типов, блоков, циклов и условий.
- Встроенные и пользовательские типы после `@param` и в аргументах `@block`.
- Редакторы `Wysiwyg` и `Markdown`, подсветка и дополнение `{{& path}}`, hover и F12 для форматированного содержимого.
- Поля объектов после точки: `{{ comment.author. }}` предлагает поля типа `Author`.
- Локальные аргументы блоков и переменные циклов с учётом вложенности и области видимости.
- Дополнение имён блоков и подходящих по типу аргументов в `@render`, подсказки сигнатур.
- Опции параметров: `label`, `help`, `aiInstructions`, `required`, числовые ограничения, варианты `Select`, границы списков, `aspect_ratio` и `sizes` для изображений.
- Аннотация `aiInstructions` для полей и блоков: подсветка, автодополнение и текст инструкций при наведении.
- Опциональные `previewData` и `previewUrl`: подсказки, проверка JSON, подсветка и форматирование блока данных для превью.
- Пути `@include`, переход к объявлениям через F12, сведения при наведении, Outline и сворачивание блоков.
- Изменения в открытых, ещё не сохранённых файлах сразу участвуют в подсказках.
- **Format Document** и форматирование при сохранении: отступы DSL, HTML, CSS и JavaScript со встроенным Prettier.
- Два выбираемых хостом профиля языка: безопасный общий `safe-html-v1` и совместимый с Fast Landings `fast-landings-v1`.

## Установка

Из корня монорепозитория:

```sh
npm install
npm run package --workspace=tpl-vscode-plugin
code --install-extension packages/tpl-vscode-plugin/dist/tpl-vscode-plugin-0.4.0.vsix
```

Либо в VS Code: **Extensions → … → Install from VSIX…**, затем выбрать полученный файл. Публикация в Marketplace и учётная запись издателя не требуются для установки VSIX.

Расширение поддерживает VS Code **1.85+**. Для разработки и упаковки нужен Node.js **22+**.

## Как начать

Файлы `.tpl`, `.tpl.html`, `.tpl.txt` и `.tpl.php` открываются в режиме **TrafficOps Templates**. Для `.html`, `.txt` и `.php` режим автоматически определяется по декларации `@template` в начале файла. Обычные HTML-файлы сохраняют свой режим. `.tpl.php` является возможностью только профиля `fast-landings-v1`; безопасный профиль покажет диагностическую ошибку.

Для файла с другим именем выберите **TrafficOps Templates** в переключателе языка или выполните команду **Fast Landings: Use TrafficOps Templates Language**. Явные ассоциации можно задать в настройках проекта:

```json
{
  "files.associations": {
    "templates/**/*.html": "fast-landings-tpl"
  }
}
```

Откройте `examples/template.tpl` вместе с `examples/blocks/comment.tpl`. После точки в `{{ comment.author. }}` вызовите **Ctrl+Space**, чтобы увидеть поля авторского типа.

```html
@template "Comments" version=1

@type Comment
  @param author String = "Guest" label="Author"
  @param body Text label="Comment"
@endtype

@param comments Comment[] min_items=1 max_items=20

@block commentItem(comment: Comment)
  <article>
    <h3>{{ comment.author }}</h3>
    <p>{{ comment.body }}</p>
  </article>
@endblock

@layout
  <section>
    @each comment in comments:
      @render commentItem(comment)
    @endeach
  </section>
@endlayout
```

Директивы располагаются на отдельных строках. Версия 1 использует `@if … @endif`, без `@else`. Полный контракт языка находится в [docs/language-v1.md](../docs/language-v1.md).

## Профили языка

Профиль выбирает приложение или workspace через `fastLandingsTemplates.dialect`. Сам текст шаблона не может повысить свои возможности или переключить профиль. Значение по умолчанию — `safe-html-v1`. Профиль `fast-landings-v1` предназначен только для внешнего приложения с доверенным исполняемым диалектом.

- `safe-html-v1` — неисполняемый общий профиль. Доступны только runtime-макросы `{query.name}`, `{locale}` и `{actions.name}`. `@validation`, `headers`, `body`, wildcard-макросы, PHP и источники `.tpl.php` диагностируются как недоступные.
- `fast-landings-v1` — текущий доверенный профиль Fast Landings: PHP-блоки, `@validation` и `{query…}`, `{headers…}`, `{body…}`, включая вложенные пути и `*`.

Например, для проекта на общем пакете `template-dsl`:

```json
{
  "fastLandingsTemplates.dialect": "safe-html-v1"
}
```

## Превью шаблона

Для генерации изображения превью задайте опциональный JSON-объект с демонстрационными значениями полей. Объявите блок на верхнем уровне, вне `@type`, `@section`, `@block` и `@layout`:

```html
@template "Comments" version=1
@previewData
{
  "title": "Истории наших читателей",
  "comments": [{ "author": "Анна", "body": "Спасибо за подробный обзор!" }]
}
@endpreviewData

@param title String = "Новый заголовок"
```

`previewData` используется только для превью и не меняет значения полей по умолчанию у создаваемого лендинга. Значения должны соответствовать полям шаблона, включая вложенные объекты и списки. Допускается один блок или короткая запись в заголовке: `@template "Comments" version=1 previewData='{"title":"Демо"}'`. В записи в заголовке обратные слеши JSON нужно дополнительно экранировать по правилам строк DSL; многострочный блок содержит обычный JSON.

Если доступно публичное превью, укажите `previewUrl="https://example.com/demo"` в строке `@template`. URL публичной HTTP(S)-страницы или изображения имеет приоритет перед `previewData` при генерации превью. Сервер проверяет доступность и допустимость адреса.

Сниппеты `tpl-preview-data` и `tpl-preview-url` вставляют готовые объявления. Formatter отдельно форматирует JSON, сохраняет его значения и не интерпретирует HTML или `{{…}}` внутри строк. Некорректный или незакрытый блок сохраняется без изменений. Расширение отмечает ошибки JSON, повторный `previewData`, пропущенную закрывающую директиву и некорректный формат URL. Соответствие данных полям и безопасность URL окончательно проверяет сервер Fast Landings.

## Изображения: пропорции и размеры

Для `Image` расширение предлагает два взаимоисключающих параметра:

```html
@param cover Image label="Cover" aspect_ratio="16:9"
@param avatar Image label="Avatar" sizes="128x128|256x256"
```

`aspect_ratio` задаёт пропорции кропа; допускается также число, например `1.5`. `sizes` задаёт варианты точных размеров в пикселях. После указания одного параметра второй больше не предлагается. Подсказки работают и внутри `@type`, в том числе для полей повторяемых блоков.

Сниппеты `tpl-image-ratio` и `tpl-image-sizes` вставляют готовые объявления. Подсветка распознаёт имена опций и значения, а formatter сохраняет декларации на одной строке и не меняет их значения. Окончательную проверку диапазонов и корректности размеров выполняет сервер Fast Landings при импорте шаблона; расширение не заменяет эту валидацию.

## Инструкции для AI

Добавьте `aiInstructions="…"` в объявление поля или после аргументов блока:

```html
@type Article
  @param title String aiInstructions="Напиши короткий заголовок."
  @param body Text aiInstructions="Используй простой язык.\nРазделяй текст на абзацы."
@endtype
@param article Article aiInstructions="Согласуй заголовок и основной текст."
@param related Article[] aiInstructions="Каждая запись раскрывает отдельную тему."

@block articleBody(value: Article) aiInstructions="Начни с введения (кратко)."
  <h1>{{value.title}}</h1>
  <p>{{value.body}}</p>
@endblock
```

Автодополнение предлагает опцию у всех `@param`, в том числе внутри `@type`, и после закрывающей скобки `@block`. Уже указанная опция повторно не предлагается. Сниппет `tpl-ai-instructions` вставляет аннотацию, а наведение на поле или блок показывает её текст. Formatter сохраняет кавычки, пробелы и escape-последовательности в инструкции.

Fast Landings сохраняет инструкции как метаданные шаблона: у полей — в `aiInstructions`, у именованных блоков — в `blocks.<имя>.aiInstructions`. Допускается UTF-8 строка до 10 000 байт, включая пустую. Декларация остаётся на одной строке; для переноса внутри инструкции используйте `\n`. Аннотация сама по себе не запускает AI-генерацию и не меняет HTML или значения полей.

## WYSIWYG и Markdown

```html
@param body Wysiwyg = "<p>Текст с <strong>форматированием</strong>.</p>" label="Статья"
@param details Markdown = "## Подробности\n\n![Фото](assets/photo.jpg)" label="Подробности"

@layout
  <article>{{& body}}</article>
  <aside>{{& details}}</aside>
@endlayout
```

`{{& path}}` выводит очищенный HTML из `Wysiwyg` или `Markdown`; обычный `{{path}}` экранирует сохранённую строку. Используйте форматированный вывод внутри `article`, `div`, `section` и подобных контейнеров тела страницы. Атрибуты, `script`, `style` и оборачивающий `p` для него не подходят; тройные фигурные скобки не поддерживаются сервером.

Подсказки работают после `&` и точки, в том числе для полей `@type`, аргументов блоков, переменных циклов и объявлений из `@include`. В форматированных выражениях предлагаются поля редакторов и объекты с такими полями. Примитивные алиасы из `customTypes` также доступны: соответствие алиаса редактору проверяет Laravel, поскольку плагин не исполняет PHP-регистрацию типов.

Сниппеты: `tpl-wysiwyg`, `tpl-markdown`, `tpl-rich-value`. Пример с подключаемым типом, блоком и повторяемыми статьями: `examples/rich-text/template.tpl`. Formatter сохраняет значения HTML/Markdown, ссылки на изображения и выражения `{{& …}}`.

Вставка и загрузка изображений выполняются в редакторах Fast Landings. Хранилище задаётся нативным Laravel Filesystem disk — локальным или S3 — через `FAST_LANDINGS_MEDIA_DISK`; при публикации изображения переносятся в статический выпуск. Эти настройки не являются DSL-опциями и не требуют настройки в VS Code. В CLI и браузерном редакторе TrafficOps изображения указываются относительными путями; загрузка на сервер не выполняется.

## Макросы запроса и валидация Fast Landings

Значения текущего HTTP-запроса доступны через одинарные фигурные скобки: `{query.subid}`, `{headers.user-agent}`, `{body.name}`. Вложенные пути поддерживаются, например `{body.customer.name}`; `{query.*}`, `{headers.*}` и `{body.*}` выводят весь источник как JSON. `{{title}}` по-прежнему читает сохранённый параметр шаблона.

Объявите правила на верхнем уровне нужной страницы, например в `index.tpl.php`:

```html
@validation query fallback="/error"
  @param subid String required
  @param pixel String length=10 required
@endvalidation
```

В `success.tpl.php` можно проверить отправленную форму:

```html
@validation body fallback="submit-error"
  @param phone String required mask="+380 ... ... ..."
  @param name String required min=4
@endvalidation

@layout
  <p>Спасибо за заказ, {body.name}! Мы перезвоним на {body.phone}.</p>
@endlayout
```

Типы запроса: `String`, `Number`, `Integer`, `Boolean`. `required` требует значение; `min` и `max` ограничивают длину строки в Unicode-символах или числовое значение. `length` задаёт точную длину строки; прежнее написание `lenght` принимается как алиас. В строковой `mask` каждая точка обозначает одну цифру, остальные символы должны совпасть буквально. Имена заголовков нечувствительны к регистру. Опциональный локальный `fallback` перенаправляет невалидный запрос до вывода страницы; без него сервер отвечает `422 Invalid request.`.

Параметры внутри `@validation` принадлежат HTTP-запросу: они не создают поля настроек лендинга. Правила и подсказки относятся к своей странице и явно подключённым файлам, соседние страницы их не наследуют. Макросы разрешены также внутри значений настроек лендинга, например `Спасибо, {body.name}!`; такая строка подставляется при запросе посетителя.

Автодополнение после `{` предлагает источники, после точки — объявленные поля, вложенные пути, распространённые заголовки и `*`. Поддерживаются переход к объявлению, сведения о типе и правилах при наведении, Outline и сворачивание `@validation`. Сниппеты: `tpl-validation` и `tpl-macro`. Примеры — `examples/runtime/`.

Литерал макроса экранируется обратным слешем: `\{body.name}`. Вывод значений запроса допускается в тексте и безопасных HTML-атрибутах; `script`, `style` и обработчики событий для него не подходят. Для JavaScript передайте значение через `data-*` и прочитайте его из DOM.

PHP-блоки `<?php … ?>` и `<?= … ?>` непрозрачны для DSL: их содержимое не создаёт параметры и подсказки макросов, formatter сохраняет код без изменения. Макросы пишутся в шаблонной разметке вне PHP. PHP-строки, комментарии и heredoc также сохраняются.

## Форматирование

Выполните **Format Document** (macOS: **Shift+Option+F**, Windows/Linux: **Shift+Alt+F**). Весь файл форматируется с учётом вложенности `@type`, `@section`, `@block`, `@layout`, `@if`, `@each` и `@validation`. Внутри разметки форматируются HTML, `<style>` и `<script>`. Размер отступа и tabs/spaces берутся из настроек текущего редактора.

Для форматирования при сохранении добавьте в настройки VS Code:

```json
{
  "[fast-landings-tpl]": {
    "editor.defaultFormatter": "trafficops-io.tops-templates",
    "editor.formatOnSave": true,
    "editor.insertSpaces": true,
    "editor.tabSize": 2
  },
  "fastLandingsTemplates.format.enable": true,
  "fastLandingsTemplates.format.printWidth": 100
}
```

`@param` и остальные DSL-декларации остаются на одной строке: перенос строки изменил бы их смысл для компилятора. Значения в кавычках, интерполяции и содержимое `pre`/`textarea` сохраняются. Если фрагмент ещё не дописан и не разбирается, formatter сохраняет его исходный текст.

Для элемента с особым форматированием текста, например `white-space`, заданным через внешний CSS-класс, можно поставить `<!-- prettier-ignore -->` перед открывающим тегом. Его содержимое останется как есть. `pre`, `textarea` и элементы с явным inline `white-space: pre`, `pre-wrap`, `pre-line` или `break-spaces` защищены автоматически.

Prettier и необходимые HTML/CSS/JavaScript parsers входят в VSIX. Установка отдельного расширения Prettier или npm-зависимостей в проект шаблона не нужна. Formatter не загружает и не исполняет конфигурационные файлы и плагины из workspace. `.prettierrc` не используется; параметры задаются через настройки VS Code выше.

## Подключаемые файлы

`@include "blocks/comment.tpl"` всегда разрешается относительно корня пакета шаблона, в том числе внутри вложенных фрагментов. Корень определяется по ближайшему `template.html`, `template.txt` или `template.tpl`, который подключает текущий файл. Поиск ограничен открытым workspace; для файла вне workspace используется его собственная папка.

Объявления соседнего, не связанного через `@include` шаблона не попадают в подсказки. Отсутствующий или ещё не дописанный include не блокирует редактирование остальных файлов. Источники читаются как текст и никогда не исполняются.

## Настройки

```json
{
  "fastLandingsTemplates.dialect": "fast-landings-v1",
  "fastLandingsTemplates.autoDetect": true,
  "fastLandingsTemplates.customTypes": ["Headline", "Spacing"],
  "emmet.includeLanguages": {
    "fast-landings-tpl": "html"
  }
}
```

`customTypes` нужен только для примитивных алиасов, зарегистрированных разработчиком приложения в `TemplateFieldTypes`. Типы объектов из `@type` обнаруживаются автоматически; перечислять их в настройках не нужно. Emmet подключается по желанию. Полноценные языковые сервисы HTML/CSS/JavaScript расширение не подменяет: IntelliSense предоставляется для DSL, а встроенные TextMate-грамматики отвечают за подсветку разметки, стилей и скриптов.

## Разработка и проверки

```sh
npm run check --workspace=tpl-vscode-plugin
npm test --workspace=tpl-vscode-plugin
npm run test:integration --workspace=tpl-vscode-plugin
npm run test:runtime --workspace=tpl-vscode-plugin
npm run package --workspace=tpl-vscode-plugin
```

Откройте папку этого пакета в VS Code и нажмите **F5**, чтобы запустить Extension Development Host с примерами.

Unit-тесты проверяют formatter, семантические подсказки, включения и реальную токенизацию TextMate через Oniguruma. Интеграционные тесты запускают отдельный Extension Host с временными workspace, профилем и каталогом расширений; проверяют также Format Document, Format on Save и настройки отступов. На macOS используется установленный `/Applications/Visual Studio Code.app`; для другой установки задайте `VSCODE_EXECUTABLE_PATH`. Если локальный исполняемый файл не найден, официальный `@vscode/test-electron` скачает стабильную версию VS Code. `TPL_EXTENSION_PATH` позволяет проверить расширение, извлечённое из VSIX, вне монорепозитория.

Отдельная проверка `test:runtime` требует PHP с DOM и установленных Composer-зависимостей в корне репозитория. Она компилирует шаблоны до и после форматирования настоящим серверным parser/renderer и сравнивает форму, значения, разметку, CSS и поведение тестового JavaScript.

`@trafficops/template-language` содержит анализатор DSL без VS Code API, `src/projects.js` разрешает include-граф через `workspace.fs`, `@trafficops/template-language/formatter` форматирует DSL и встроенные языки, а `src/extension.js` подключает редакторские providers. `npm run build` собирает их вместе с Prettier в `build/extension.js`; VSIX включает этот bundle и лицензию Prettier, без зависимости от `node_modules` пользователя. Подсветка хранится отдельно в `syntaxes/`, snippets — в `snippets/`.

Расширение следует DSL v1. При расширении серверного языка обновляйте его каталог директив/типов, анализатор, грамматику и соответствующие тесты; сервер Fast Landings остаётся источником окончательной проверки шаблона.

The extension bundles `@trafficops/template-language` and its formatter. Its Marketplace identity remains `trafficops-io.tops-templates`.
