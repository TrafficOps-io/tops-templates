<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateRichText;
use TrafficOps\TemplateDsl\TemplateSourceParser;

class TemplateRichTextTest extends TestCase
{
    public function test_editors_work_in_typed_blocks_and_nested_repeaters_with_explicit_formatted_output(): void
    {
        $definition = app(TemplateSourceParser::class)->parse(<<<'TPL'
@param title String = "<unsafe>"
@param body Markdown = "**Root**"
@param items Item[] min_items=1
@type Item
@param body Wysiwyg = "<p><strong>Nested</strong></p>"
@param note Markdown = "*Note*"
@endtype
@block item(value: Item, root: Markdown)
<article>{{& value.body}}{{& value.note}}{{& root}}</article>
@endblock
@layout
<h1>{{title}}</h1><pre>{{body}}</pre>
@each item in items
@render item(item, body)
@endeach
@endlayout
TPL);
        $engine = app(TemplateEngine::class);
        $html = $engine->render($definition, []);
        $this->assertStringContainsString('&lt;unsafe&gt;', $html);
        $this->assertStringContainsString('<pre>**Root**</pre>', $html);
        $this->assertStringContainsString('<p><strong>Nested</strong></p>', $html);
        $this->assertStringContainsString('<p><em>Note</em></p>', $html);
        $this->assertStringContainsString('<p><strong>Root</strong></p>', $html);
    }

    public function test_rich_html_is_sanitized_and_markdown_source_is_preserved(): void
    {
        $engine = app(TemplateEngine::class);
        $definition = $this->definition('Wysiwyg');
        $value = '<p onclick="alert(1)" style="position:fixed">Hello <strong>world</strong></p><script>alert(1)</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">Link</a><img src="data:image/svg+xml,bad" onerror="alert(1)">';
        $normalized = $engine->validateValues($definition, ['body' => $value]);
        $this->assertStringContainsString('<strong>world</strong>', $normalized['body']);
        foreach (['onclick', 'onerror', 'style=', '<script', '<iframe', 'javascript:', 'data:'] as $unsafe) {
            $this->assertStringNotContainsString($unsafe, $normalized['body']);
        }
        $markdown = "## Заголовок\n\n**Bold** and ![Alt](https://example.com/image.png)\n\n<script>alert(1)</script>";
        $this->assertSame($markdown, $engine->validateValues($this->definition('Markdown'), ['body' => $markdown])['body']);
        $html = $engine->render($this->definition('Markdown'), ['body' => $markdown]);
        $this->assertStringContainsString('<h2>Заголовок</h2>', $html);
        $this->assertStringContainsString('<img src="https://example.com/image.png" alt="Alt"', $html);
        $this->assertStringNotContainsString('<script', $html);
    }

    #[DataProvider('emptyEditorValues')]
    public function test_required_editors_reject_visually_empty_content(string $type, string $value): void
    {
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->validateValues($this->definition($type, true), ['body' => $value]);
    }

    public static function emptyEditorValues(): array
    {
        return [['Wysiwyg', '<p><br></p>'], ['Wysiwyg', '<p>&nbsp;</p>'], ['Wysiwyg', '<script>alert(1)</script>'], ['Markdown', '  '], ['Markdown', '<script>alert(1)</script>']];
    }

    public function test_images_are_valid_content_and_local_paths_are_checked(): void
    {
        $engine = app(TemplateEngine::class);
        foreach (['Wysiwyg' => '<img src="_media/ABC.png" alt="Example">', 'Markdown' => '![Example](_media/ABC.png)'] as $type => $value) {
            $html = $engine->render($this->definition($type, true), ['body' => $value]);
            $this->assertSame(['_media/ABC.png'], app(TemplateRichText::class)->imageSources($html));
        }
        $this->expectException(ValidationException::class);
        $engine->validateValues($this->definition('Markdown'), ['body' => '![](../private.png)']);
    }

    public function test_editor_length_and_rendered_output_limits_apply(): void
    {
        $engine = app(TemplateEngine::class);
        $definition = $this->definition('Markdown');
        $this->assertSame(str_repeat('a', 20000), $engine->validateValues($definition, ['body' => str_repeat('a', 20000)])['body']);
        try {
            $engine->validateValues($definition, ['body' => str_repeat('a', 100001)]);
            $this->fail('Oversized content must fail.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('values.body', $exception->errors());
        }
        $engine = new TemplateEngine(app(TemplateRichText::class), 20);
        $this->expectException(ValidationException::class);
        $engine->render($definition, ['body' => '**'.str_repeat('a', 20).'**']);
    }

    public function test_formatted_output_is_not_a_raw_html_escape_hatch_for_plain_fields(): void
    {
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->validateDefinition($this->definition('Text'));
    }

    private function definition(string $type, bool $required = false): array
    {
        return app(TemplateSourceParser::class)->parse('@param body '.$type.($required ? ' required' : '')."\n@layout\n<article>{{&body}}</article>\n@endlayout");
    }
}
