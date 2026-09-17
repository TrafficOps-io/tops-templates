<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateRichText;
use TrafficOps\TemplateDsl\TemplateSourceParser;

class SafeRuntimeTest extends TestCase
{
    public function test_only_author_source_tokens_are_resolved_and_context_is_escaped_once(): void
    {
        $definition = $this->definition('<p>{query.name} / {locale} / {{title}}</p><a href="/next?name={query.name}&amp;lang={locale}" title="{query.name}">Go</a><form action="{actions.continue}"></form>');
        $definition['sections'][0]['fields'] = [['name' => 'title', 'type' => 'text', 'label' => 'Title']];
        $html = app(TemplateEngine::class)->render($definition, ['title' => '{query.secret} {{title}}'], [
            'query' => ['name' => '<&"{query.secret}{{title}}', 'secret' => 'private'],
            'locale' => 'en-US',
            'actions' => ['continue' => '/flow/next?x=1&y=2'],
        ]);
        $this->assertStringContainsString('&lt;&amp;&quot;{query.secret}{{title}} / en-US / {query.secret} {{title}}', $html);
        $this->assertStringContainsString('href="/next?name=%3C%26%22%7Bquery.secret%7D%7B%7Btitle%7D%7D&amp;lang=en-US"', $html);
        $this->assertStringContainsString('action="/flow/next?x=1&amp;y=2"', $html);
        $this->assertStringNotContainsString('private', $html);
    }

    public function test_runtime_macros_remain_scoped_to_rendered_branches_and_partials(): void
    {
        $definition = $this->definition('{{#show}}{{>greeting}}{{/show}}');
        $definition['sections'][0]['fields'] = [['name' => 'show', 'type' => 'checkbox', 'label' => 'Show']];
        $definition['partials'] = ['greeting' => '<p>{query.name}</p>'];
        $engine = app(TemplateEngine::class);
        $this->assertSame('', $engine->render($definition, [], ['query' => ['name' => 'A']]));
        $this->assertSame('<p>A</p>', $engine->render($definition, ['show' => true], ['query' => ['name' => 'A']]));
        $this->assertSame('<p></p>', $engine->render($definition, ['show' => true]));
    }

    public function test_html_pages_share_settings_and_explicit_runtime_data(): void
    {
        $definition = $this->definition('<h1>{locale}</h1>');
        $definition['pages'] = ['thanks.html' => '<p>{query.name}</p>'];
        $this->assertSame(['index.html' => '<h1>ro</h1>', 'thanks.html' => '<p>A</p>'], app(TemplateEngine::class)->renderPages($definition, [], ['locale' => 'ro', 'query' => ['name' => 'A']]));
        $this->expectException(ValidationException::class);
        (new TemplateEngine(app(TemplateRichText::class), 20))->renderPages($definition, [], ['locale' => 'ro', 'query' => ['name' => 'ABCD']]);
    }

    public function test_partial_composition_cannot_move_text_macros_into_executable_contexts(): void
    {
        $definition = $this->definition('<script>{{>dynamic}}</script>');
        $definition['partials'] = ['dynamic' => '{query.name}'];
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->render($definition, [], ['query' => ['name' => 'alert(1)']]);
    }

    public function test_partial_open_tags_cannot_change_a_later_macros_url_encoding_context(): void
    {
        $definition = $this->definition('{{>open}}{query.name}">Go</a>');
        $definition['partials'] = ['open' => '<a href="/path/'];
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->render($definition, [], ['query' => ['name' => 'next?x=1&y=2']]);
    }

    public function test_adjacent_values_and_empty_macros_do_not_create_new_runtime_tokens(): void
    {
        $definition = $this->definition('<p>{query.empty}{{left}}{{right}}</p>');
        $definition['sections'][0]['fields'] = [
            ['name' => 'left', 'type' => 'text', 'label' => 'Left'],
            ['name' => 'right', 'type' => 'text', 'label' => 'Right'],
        ];
        $this->assertSame('<p>{query.secret}</p>', app(TemplateEngine::class)->render($definition, ['left' => '{query.', 'right' => 'secret}'], ['query' => ['secret' => 'private']]));
    }

    #[DataProvider('unsafeSources')]
    public function test_executable_sources_are_rejected_before_normalization(string $source): void
    {
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->validateDefinition($this->definition($source));
    }

    public static function unsafeSources(): array
    {
        return array_map(fn ($source) => [$source], [
            '<?php echo "x";', '<?= "x" ?>', '<?xml version="1.0"?>', '<% code %>',
            '{!! $raw !!}', '@php echo "x"; @endphp', '@include("secret")', '{{ $secret }}',
            '<script language="php">echo "x";</script>', '@csrf', "@validation query\n@param token String\n@endvalidation",
        ]);
    }

    #[DataProvider('unsafeMacroPositions')]
    public function test_runtime_tokens_cannot_change_markup_or_executable_contexts(string $html): void
    {
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->validateDefinition($this->definition($html));
    }

    public static function unsafeMacroPositions(): array
    {
        return array_map(fn ($html) => [$html], [
            '<script>{query.name}</script>', '<style>{query.name}</style>', '<!-- {query.name} -->',
            '<script><!-- nested script comment --></script><p>{query.name}</p>',
            '<script>/* </scripture> */ {query.name}</script>',
            '<style>/* </stylesheet> */ {query.name}</style>',
            '<plaintext>text</plaintext>{query.name}',
            '<div {query.name}="yes"></div>', '<{query.name}>Hi</{query.name}>', '<p title={query.name}>Hi</p>',
            '<div onclick="{query.name}"></div>', '<div style="{query.name}"></div>', '<iframe srcdoc="{query.name}"></iframe>',
            '<a href="{query.name}">Go</a>', '<a href="https://{query.name}/">Go</a>', '<a href="javascript:{query.name}">Go</a>',
            '<a href="/{actions.continue}">Go</a>', '<img src="{actions.continue}">', '<p>{actions.continue}</p>',
            '<p>{headers.authorization}</p>', '<p>{body.password}</p>', '<p>{query.*}</p>', '<p>{query.a.b}</p>',
        ]);
    }

    #[DataProvider('unsafeContexts')]
    public function test_runtime_context_rejects_objects_nested_request_data_and_unsafe_actions(array $context): void
    {
        $this->expectException(ValidationException::class);
        app(TemplateEngine::class)->render($this->definition('<p>{query.name}</p>'), [], $context);
    }

    public static function unsafeContexts(): array
    {
        return [
            [['headers' => ['authorization' => 'secret']]], [['body' => ['password' => 'secret']]],
            [['query' => ['name' => ['nested' => 'data']]]], [['query' => ['name' => new \stdClass]]],
            [['query' => ['name' => str_repeat('a', 2049)]]], [['query' => ['name' => "new\nline"]]],
            [['locale' => '<script>']], [['actions' => ['continue' => 'javascript:alert(1)']]],
            [['actions' => ['continue' => '//evil.example']]], [['actions' => ['continue' => 'https://user:pass@example.com']]],
        ];
    }

    #[DataProvider('unsafePaths')]
    public function test_include_paths_are_rejected_before_calling_the_resolver(string $path): void
    {
        $called = false;
        try {
            app(TemplateSourceParser::class)->parse('@include "'.$path."\"\n@layout\n<p>Page</p>\n@endlayout", function () use (&$called): string {
                $called = true;

                return '';
            });
            $this->fail('Unsafe include path was accepted.');
        } catch (ValidationException) {
            $this->assertFalse($called);
        }
    }

    public static function unsafePaths(): array
    {
        return array_map(fn ($path) => [$path], ['../secret.tpl', '/secret.tpl', 'https://example.com/a.tpl', 'a.php', 'a.blade.php', 'a.tpl.php', 'a.phar', 'a.phtml', 'a//b.tpl', '.env']);
    }

    public function test_php_output_pages_and_entrypoint_are_rejected(): void
    {
        foreach ([['entrypoint' => 'index.php'], ['pages' => ['thanks.php' => 'No']]] as $extra) {
            try {
                app(TemplateEngine::class)->validateDefinition([...$this->definition('<p>Page</p>'), ...$extra]);
                $this->fail('Executable page output was accepted.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_include_sources_share_the_byte_limit(): void
    {
        $this->expectException(ValidationException::class);
        app(TemplateSourceParser::class)->parse("@include \"one.tpl\"\n@include \"two.tpl\"\n@layout\n<p>Page</p>\n@endlayout", fn () => str_repeat(' ', 1100000));
    }

    private function definition(string $html): array
    {
        return ['version' => 1, 'name' => 'Safe template', 'sections' => [['id' => 'main', 'label' => 'Main', 'fields' => []]], 'html' => $html];
    }
}
