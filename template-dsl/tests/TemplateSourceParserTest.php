<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateFieldTypes;
use TrafficOps\TemplateDsl\TemplateMarkupCompiler;
use TrafficOps\TemplateDsl\TemplateSourceParser;

class TemplateSourceParserTest extends TestCase
{
    public function test_preview_metadata_supports_multiline_nested_data_and_public_urls(): void
    {
        $definition = $this->parse(<<<'TPL'
@template "Preview example" previewUrl="https://preview.example.com/article"
@previewData
{
  "title": "Preview title",
  "article": {"body": "Line one\nLine two"},
  "comments": [{"body": "A \"quoted\" comment"}]
}
@endpreviewData
@param title String = "Editor title" required
@param article Article
@param comments Article[]
@type Article
@param body Text
@endtype
@layout
<h1>{{title}}</h1><p>{{article.body}}</p>
@endlayout
TPL);

        $engine = app(TemplateEngine::class);
        $definition = $engine->validateDefinition($definition);
        $this->assertSame('https://preview.example.com/article', $definition['previewUrl']);
        $this->assertSame([
            'title' => 'Preview title',
            'article' => ['body' => "Line one\nLine two"],
            'comments' => [['body' => 'A "quoted" comment']],
        ], $definition['previewData']);
        $this->assertSame('Editor title', $engine->defaults($definition)['title']);
        $this->assertSame($definition, $engine->parse(json_encode($definition, JSON_THROW_ON_ERROR)));
    }

    public function test_inline_preview_data_and_empty_object_are_optional(): void
    {
        $definition = $this->parse(<<<'TPL'
@template "Preview example" previewData='{"title":"Demo"}'
@param title String = "Editor title"
@layout
<h1>{{title}}</h1>
@endlayout
TPL);
        $this->assertSame(['title' => 'Demo'], $definition['previewData']);
        $empty = $this->parse("@previewData\n{}\n@endpreviewData\n@layout\n<p>Preview</p>\n@endlayout");
        $this->assertSame([], $empty['previewData']);
        $withoutPreview = $this->parse("@layout\n<p>Preview</p>\n@endlayout");
        $this->assertArrayNotHasKey('previewData', $withoutPreview);
        $this->assertArrayNotHasKey('previewUrl', $withoutPreview);
    }

    #[DataProvider('invalidPreviewDataProvider')]
    public function test_invalid_preview_data_reports_the_source_location(string $declaration, int $line): void
    {
        try {
            $this->parse($declaration."\n@layout\n<p>Page</p>\n@endlayout");
            $this->fail('Invalid preview metadata must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString("template.html:{$line}:", $exception->errors()['template'][0]);
        }
    }

    public static function invalidPreviewDataProvider(): array
    {
        return [
            'invalid JSON' => ["@previewData\n{broken}\n@endpreviewData", 1],
            'array root' => ["@previewData\n[]\n@endpreviewData", 1],
            'scalar root' => ['@template "Demo" previewData="null"', 1],
            'missing terminator' => ["@previewData\n{}", 1],
            'block arguments' => ["@previewData {}\n@endpreviewData", 1],
            'inside section' => ["@section content\n@previewData\n{}\n@endpreviewData\n@endsection", 2],
            'duplicate blocks' => ["@previewData\n{}\n@endpreviewData\n@previewData\n{}\n@endpreviewData", 4],
            'inline then block' => ["@template \"Demo\" previewData='{}'\n@previewData\n{}\n@endpreviewData", 2],
            'block then inline' => ["@previewData\n{}\n@endpreviewData\n@template \"Demo\" previewData='{}'", 4],
        ];
    }

    public function test_ai_instructions_survive_normalization_for_fields_groups_lists_and_included_blocks(): void
    {
        $definition = app(TemplateSourceParser::class)->parse(<<<'TPL'
@param title String = "Hello" aiInstructions="Use a short \"heading\".\nKeep {{title}} literal."
@param article Article aiInstructions='Write a coherent article.'
@param comments Article[] min_items=1 aiInstructions="Vary the comments."
@type Article
@param body Text = "Body" aiInstructions="Keep  two spaces and \\ paths."
@endtype
@include "blocks/article.tpl"
@layout
<h1>{{title}}</h1>
@render articleBody(article)
@endlayout
TPL, fn (): string => <<<'TPL'
@block articleBody(article: Article) aiInstructions="Explain (briefly), ignore fake: Type, and \"quotes\".\n{{article.body}}"
<p>{{article.body}}</p>
@endblock
@block unused() aiInstructions=""
@endblock
TPL);

        $engine = app(TemplateEngine::class);
        $definition = $engine->validateDefinition($definition);
        $this->assertSame("Use a short \"heading\".\nKeep {{title}} literal.", $definition['sections'][0]['fields'][0]['aiInstructions']);
        $this->assertSame('Write a coherent article.', $definition['sections'][0]['fields'][1]['aiInstructions']);
        $this->assertSame('Vary the comments.', $definition['sections'][0]['fields'][2]['aiInstructions']);
        foreach ([1, 2] as $index) {
            $this->assertSame('Keep  two spaces and \\ paths.', $definition['sections'][0]['fields'][$index]['fields'][0]['aiInstructions']);
        }
        $this->assertSame("Explain (briefly), ignore fake: Type, and \"quotes\".\n{{article.body}}", $definition['blocks']['articleBody']['aiInstructions']);
        $this->assertSame('', $definition['blocks']['unused']['aiInstructions']);
        $this->assertSame($definition, $engine->parse(json_encode($definition, JSON_THROW_ON_ERROR)));
        $this->assertSame("<h1>Hello</h1>\n<p>Body</p>\n", $engine->render($definition, $engine->defaults($definition)));
    }

    public function test_forward_declared_types_build_nested_groups_and_repeaters(): void
    {
        $definition = $this->parse(<<<'TPL'
@template "Article discussion" version=1 description="Reusable article and comments"
@section content "Discussion"
@param comments Comments label="Comments"
@endsection
@type Comments
@param enabled Boolean = true
@param heading String = "Reader comments"
@param items Comment[] min_items=1 max_items=3 label="Comments"
@endtype
@type Comment
@param name String = "Ada" required
@param body Text = "A useful article."
@param reply Reply
@endtype
@type Reply
@param enabled Boolean = false
@param body Text = "Thanks!"
@endtype
@layout
<!doctype html><html><body><h1>{{ comments.heading }}</h1></body></html>
@endlayout
TPL);

        $this->assertSame('Article discussion', $definition['name']);
        $this->assertSame('Discussion', $definition['sections'][0]['label']);
        $comments = $definition['sections'][0]['fields'][0];
        $this->assertSame('group', $comments['type']);
        $this->assertSame('checkbox', $comments['fields'][0]['type']);
        $this->assertTrue($comments['fields'][0]['default']);
        $items = $comments['fields'][2];
        $this->assertSame('repeater', $items['type']);
        $this->assertSame(1, $items['min_items']);
        $this->assertSame(3, $items['max_items']);
        $this->assertSame('text', $items['fields'][0]['type']);
        $this->assertTrue($items['fields'][0]['required']);
        $this->assertSame('group', $items['fields'][2]['type']);
        $this->assertFalse($items['fields'][2]['fields'][0]['default']);
    }

    public function test_typed_blocks_nested_loops_and_conditions_render_in_the_correct_context(): void
    {
        $definition = $this->parse(<<<'TPL'
@template "Discussion"
@param heading String = "Discussion heading"
@param comments Comment[]
@type Comment
@param name String
@param enabled Boolean = true
@param replies Reply[]
@endtype
@type Reply
@param name String
@param body Text
@endtype
@block replyItem(reply: Reply, owner: String)
<li data-owner="{{ owner }}">{{ reply.name }}: {{ reply.body }}</li>
@endblock
@block commentItem(comment: Comment)
@if comment.enabled
<article><h2>{{ comment.name }}</h2><ul>
@each reply in comment.replies:
@render replyItem(reply, comment.name)
@endeach
</ul></article>
@endif
@endblock
@layout
<!doctype html><html><body><h1>{{ heading }}</h1>
@each comment in comments
@render commentItem(comment)
@endeach
</body></html>
@endlayout
TPL);

        $engine = app(TemplateEngine::class);
        $definition = $engine->validateDefinition($definition);
        $html = $engine->render($definition, [
            'heading' => 'Team & updates',
            'comments' => [
                ['name' => 'Ada', 'enabled' => true, 'replies' => [
                    ['name' => 'Grace', 'body' => '<script>alert(1)</script>'],
                    ['name' => 'Linus', 'body' => 'Second reply'],
                ]],
                ['name' => 'Hidden', 'enabled' => false, 'replies' => []],
                ['name' => 'Margaret', 'enabled' => true, 'replies' => [
                    ['name' => 'Katherine', 'body' => 'Another comment'],
                ]],
            ],
        ]);

        $this->assertStringContainsString('<h1>Team &amp; updates</h1>', $html);
        $this->assertStringContainsString('<li data-owner="Ada">Grace: &lt;script&gt;alert(1)&lt;/script&gt;</li>', $html);
        $this->assertStringContainsString('<li data-owner="Ada">Linus: Second reply</li>', $html);
        $this->assertStringContainsString('<li data-owner="Margaret">Katherine: Another comment</li>', $html);
        $this->assertStringNotContainsString('Hidden', $html);
        $this->assertStringNotContainsString('@render', $html);
        $this->assertStringNotContainsString('{{', $html);
    }

    public function test_builtin_defaults_and_select_options_have_form_compatible_types(): void
    {
        $definition = $this->parse(<<<'TPL'
@template "Controls"
@param enabled Boolean = false
@param size Number = 16 min=8 max=48
@param opacity Range = 0.5 min=0 max=1 step=0.1
@param caption String = "false"
@param alignment Select = "center" options="left:Left aligned|center:Centered|right:Right aligned"
@layout
<!doctype html><html><body>{{ caption }}</body></html>
@endlayout
TPL);

        $fields = array_column($definition['sections'][0]['fields'], null, 'name');
        $this->assertFalse($fields['enabled']['default']);
        $this->assertSame(16, $fields['size']['default']);
        $this->assertSame(0.5, $fields['opacity']['default']);
        $this->assertSame('false', $fields['caption']['default']);
        $this->assertSame(['left' => 'Left aligned', 'center' => 'Centered', 'right' => 'Right aligned'], $fields['alignment']['options']);
    }

    public function test_nested_loops_over_the_same_collection_preserve_each_alias_scope(): void
    {
        $definition = $this->parse(<<<'TPL'
@type Item
@param name String
@endtype
@param items Item[]
@layout
@each outer in items:
@each inner in items:
<p>{{ outer.name }} / {{ inner.name }}</p>
@endeach
@endeach
@endlayout
TPL);

        $html = app(TemplateEngine::class)->render($definition, ['items' => [
            ['name' => 'Ada'], ['name' => 'Grace'],
        ]]);

        $this->assertSame("<p>Ada / Ada</p>\n<p>Ada / Grace</p>\n<p>Grace / Ada</p>\n<p>Grace / Grace</p>\n", $html);
    }

    public function test_empty_block_expansion_has_an_operation_limit_even_when_output_is_small(): void
    {
        $source = "@template \"Many empty blocks\"\n";
        for ($level = 0; $level < 9; $level++) {
            $source .= "@block block{$level}()\n";
            if ($level < 8) {
                $source .= str_repeat('@render block'.($level + 1)."()\n", 4);
            }
            $source .= "@endblock\n";
        }
        $source .= "@layout\n<p>Small output</p>\n@render block0()\n@endlayout";

        try {
            $this->parse($source);
            $this->fail('An acyclic block graph must still respect the compilation operation budget.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('template', $exception->errors());
        }
    }

    public function test_small_sources_cannot_expand_into_unbounded_line_token_arrays(): void
    {
        $source = "@layout\n<p>Page</p>\n".str_repeat("\n", 20001).'@endlayout';

        try {
            $this->parse($source);
            $this->fail('A source below the byte limit must still respect the line token budget.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('template', $exception->errors());
            $this->assertStringContainsString('template.html:', $exception->errors()['template'][0]);
        }

        $included = str_repeat("\n", 11000);
        $source = "@include \"first.tpl\"\n@include \"second.tpl\"\n@layout\n<p>Page</p>\n@endlayout";
        try {
            app(TemplateSourceParser::class)->parse($source, fn (): string => $included, 'template.html');
            $this->fail('Included source files must share the same line token budget.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('template', $exception->errors());
            $this->assertStringContainsString('second.tpl:', $exception->errors()['template'][0]);
        }
    }

    public function test_registered_application_types_can_supply_form_defaults(): void
    {
        $registry = app(TemplateFieldTypes::class);
        $registry->register('Headline', fn (array $options): array => ['type' => 'text', 'required' => true, 'default' => 'Custom heading', ...$options]);
        $parser = new TemplateSourceParser($registry, app(TemplateMarkupCompiler::class));
        $definition = $parser->parse(<<<'TPL'
@param title Headline
@layout
<!doctype html><html><body><h1>{{ title }}</h1></body></html>
@endlayout
TPL);

        $field = $definition['sections'][0]['fields'][0];
        $this->assertSame('text', $field['type']);
        $this->assertTrue($field['required']);
        $this->assertSame('Custom heading', $field['default']);
    }

    public function test_includes_support_forward_references_and_preserve_the_source_filename(): void
    {
        $files = [
            'types/comment.tpl' => "@type Comment\n@param name String = \"Ada\"\n@endtype",
            'blocks/comment.tpl' => "@block commentItem(comment: Comment)\n<p>{{ comment.name }}</p>\n@endblock",
        ];
        $definition = app(TemplateSourceParser::class)->parse(<<<'TPL'
@template "Included discussion"
@include "blocks/comment.tpl"
@include "types/comment.tpl"
@param comments Comment[]
@layout
<!doctype html><html><body>
@each comment in comments:
@render commentItem(comment)
@endeach
</body></html>
@endlayout
TPL, fn (string $file): string => $files[$file], 'template.html');

        $this->assertSame('repeater', $definition['sections'][0]['fields'][0]['type']);
        $this->assertStringContainsString('<p>', $definition['html']);

        $files['blocks/comment.tpl'] = "@block commentItem(comment: Comment)\n<p>{{ comment.missing }}</p>\n@endblock";
        try {
            app(TemplateSourceParser::class)->parse("@include \"blocks/comment.tpl\"\n@include \"types/comment.tpl\"\n@param item Comment\n@layout\n@render commentItem(item)\n@endlayout", fn (string $file): string => $files[$file], 'template.html');
            $this->fail('An unknown included field must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('blocks/comment.tpl:2:', $exception->errors()['template'][0]);
        }
    }

    #[DataProvider('invalidSourceProvider')]
    public function test_invalid_source_reports_the_exact_file_and_line(string $source, int $line): void
    {
        try {
            app(TemplateSourceParser::class)->parse($source, filename: 'invalid.tpl');
            $this->fail('Invalid template source must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('template', $exception->errors());
            $this->assertStringContainsString('invalid.tpl:'.$line.':', $exception->errors()['template'][0]);
        }
    }

    public static function invalidSourceProvider(): array
    {
        return [
            'duplicate field AI instructions' => ["@param title String aiInstructions=one aiInstructions=two\n@layout\n<p>Page</p>\n@endlayout", 1],
            'missing field AI instructions' => ["@param title String aiInstructions=\n@layout\n<p>Page</p>\n@endlayout", 1],
            'unclosed field AI instructions' => ["@param title String aiInstructions=\"broken\n@layout\n<p>Page</p>\n@endlayout", 1],
            'duplicate block AI instructions' => ["@block item() aiInstructions=one aiInstructions=two\n@endblock\n@layout\n<p>Page</p>\n@endlayout", 1],
            'missing block AI instructions' => ["@block item() aiInstructions=\n@endblock\n@layout\n<p>Page</p>\n@endlayout", 1],
            'unclosed block AI instructions' => ["@block item() aiInstructions=\"broken\n@endblock\n@layout\n<p>Page</p>\n@endlayout", 1],
            'unknown block option' => ["@block item() help=unsupported\n@endblock\n@layout\n<p>Page</p>\n@endlayout", 1],
            'AI instructions on template' => ["@template Name aiInstructions=unsupported\n@layout\n<p>Page</p>\n@endlayout", 1],
            'unknown top-level directive' => ["@template \"Bad\"\n@unknown nope\n@layout\n<p>Page</p>\n@endlayout", 2],
            'unknown layout directive' => ["@layout\n@execute anything\n@endlayout", 2],
            'unsupported version' => ["@template \"Bad\" version=2\n@layout\n<p>Page</p>\n@endlayout", 1],
            'unknown interpolation' => ["@layout\n<p>{{ missing }}</p>\n@endlayout", 2],
            'unknown object field' => ["@type Author\n@param name String\n@endtype\n@param author Author\n@layout\n<p>{{ author.missing }}</p>\n@endlayout", 6],
            'unknown parameter type' => ["@param title Unknown\n@layout\n<p>Page</p>\n@endlayout", 1],
            'wrong block argument type' => ["@param title String\n@type Comment\n@param name String\n@endtype\n@block commentItem(comment: Comment)\n<p>{{ comment.name }}</p>\n@endblock\n@layout\n@render commentItem(title)\n@endlayout", 9],
            'wrong block argument count' => ["@block titleItem(title: String)\n<p>{{ title }}</p>\n@endblock\n@layout\n@render titleItem()\n@endlayout", 5],
            'unknown block argument' => ["@block titleItem(title: String)\n<p>{{ title }}</p>\n@endblock\n@layout\n@render titleItem(missing)\n@endlayout", 5],
            'unknown rendered block' => ["@layout\n@render missing()\n@endlayout", 2],
            'scalar used as a collection' => ["@param title String\n@layout\n@each item in title:\n<p>{{ item }}</p>\n@endeach\n@endlayout", 3],
            'unknown loop collection' => ["@layout\n@each item in missing:\n<p>Item</p>\n@endeach\n@endlayout", 2],
            'unknown conditional parameter' => ["@layout\n@if missing\n<p>Visible</p>\n@endif\n@endlayout", 2],
            'include outside a package' => ["@include \"types.tpl\"\n@layout\n<p>Page</p>\n@endlayout", 1],
            'unclosed type' => ["@type Comment\n@param name String", 1],
            'unclosed block' => ["@block titleItem(title: String)\n<p>{{ title }}</p>", 1],
            'unclosed layout' => ["@layout\n<p>Page</p>", 1],
            'raw html outside a layout' => ["<p>Page</p>\n@layout\n<p>Other</p>\n@endlayout", 1],
            'recursive object type' => ["@type Comment\n@param replies Comment[]\n@endtype\n@layout\n<p>Page</p>\n@endlayout", 2],
        ];
    }

    public function test_mutually_recursive_object_types_are_rejected(): void
    {
        $this->assertSourceInvalid(<<<'TPL'
@type First
@param next Second
@endtype
@type Second
@param previous First
@endtype
@layout
<p>Page</p>
@endlayout
TPL, 'recursive');
    }

    public function test_recursive_block_rendering_is_rejected(): void
    {
        $this->assertSourceInvalid(<<<'TPL'
@block first()
@render second()
@endblock
@block second()
@render first()
@endblock
@layout
@render first()
@endlayout
TPL, 'recursive');
    }

    public function test_recursive_package_includes_are_rejected(): void
    {
        $files = ['first.tpl' => '@include "second.tpl"', 'second.tpl' => '@include "first.tpl"'];

        try {
            app(TemplateSourceParser::class)->parse('@include "first.tpl"', fn (string $file): string => $files[$file], 'template.html');
            $this->fail('Recursive includes must be rejected.');
        } catch (ValidationException $exception) {
            $message = $exception->errors()['template'][0];
            $this->assertStringContainsString('first.tpl:1:', $message);
            $this->assertStringContainsString('recursive', strtolower($message));
        }
    }

    private function parse(string $source): array
    {
        return app(TemplateSourceParser::class)->parse($source, filename: 'template.html');
    }

    private function assertSourceInvalid(string $source, string $message): void
    {
        try {
            $this->parse($source);
            $this->fail('Invalid source must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString($message, strtolower($exception->errors()['template'][0]));
        }
    }
}
