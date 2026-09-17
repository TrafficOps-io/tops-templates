<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateRichText;

class TemplateEngineTest extends TestCase
{
    public function test_preview_values_are_normalized_without_changing_editor_defaults(): void
    {
        $definition = $this->definition([
            $this->field('title', 'text', ['default' => 'Editor title', 'required' => true]),
            $this->field('article', 'group', ['fields' => [
                $this->field('body', 'textarea', ['default' => 'Editor body', 'required' => true]),
                $this->field('size', 'number', ['default' => 16]),
            ]]),
            $this->field('comments', 'repeater', ['fields' => [
                $this->field('author', 'text', ['default' => 'Guest', 'required' => true]),
                $this->field('body', 'textarea', ['required' => true]),
            ]]),
        ], '<h1>{{title}}</h1><p>{{article.body}}</p>{{#comments}}<div>{{author}}: {{body}}</div>{{/comments}}');
        $definition['previewData'] = ['article' => ['size' => '20'], 'comments' => [['body' => 'Preview comment']]];
        $normalized = $this->engine()->validateDefinition($definition);

        $this->assertSame([
            'title' => 'Editor title',
            'article' => ['body' => 'Editor body', 'size' => 20],
            'comments' => [['author' => 'Guest', 'body' => 'Preview comment']],
        ], $normalized['previewData']);
        $this->assertSame(16, $this->engine()->defaults($normalized)['article']['size']);
        $this->assertSame([], $this->engine()->defaults($normalized)['comments']);
        $this->assertSame($normalized, $this->engine()->validateDefinition($normalized));
        $this->assertSame($normalized, $this->engine()->parse(json_encode($normalized, JSON_THROW_ON_ERROR)));
        $this->assertSame('<h1>Editor title</h1><p>Editor body</p><div>Guest: Preview comment</div>', $this->engine()->render($normalized, $normalized['previewData']));
    }

    public function test_preview_data_can_enable_defaults_only_and_absence_remains_distinct(): void
    {
        $definition = $this->definition([$this->field('title', 'text', ['default' => 'Hello'])]);
        $this->assertArrayNotHasKey('previewData', $this->engine()->validateDefinition($definition));
        $this->assertArrayNotHasKey('previewUrl', $this->engine()->validateDefinition($definition));
        $this->assertSame(['title' => 'Hello'], $this->engine()->validateDefinition([...$definition, 'previewData' => []])['previewData']);
        $this->assertSame([], $this->engine()->validateDefinition([...$this->definition([]), 'previewData' => []])['previewData']);
    }

    public function test_preview_values_validate_required_fields_nested_settings_and_types_even_with_url(): void
    {
        $definition = $this->definition([
            $this->field('title', 'text', ['required' => true]),
            $this->field('items', 'repeater', ['max_items' => 1, 'fields' => [$this->field('size', 'number', ['min' => 1])]]),
        ]);
        foreach ([null, false, 'text', [1], [], ['title' => ''], ['title' => 'Demo', 'unknown' => true], ['title' => 'Demo', 'items' => [['size' => 'large']]], ['title' => 'Demo', 'items' => [['size' => 1], ['size' => 2]]]] as $values) {
            $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition([
                ...$definition, 'previewData' => $values, 'previewUrl' => 'https://preview.example.com',
            ]));
        }
        try {
            $this->engine()->validateDefinition([...$definition, 'previewData' => ['title' => 'Demo', 'items' => [['size' => 'large']]]]);
            $this->fail('Invalid preview values must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('previewData.items.0.size', $exception->errors()['template'][0]);
        }
    }

    public function test_public_preview_urls_are_preserved(): void
    {
        foreach (['https://preview.example.com/demo?a=b#intro', 'http://example.com:80/demo', 'https://example.com:443/demo', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/'] as $url) {
            $definition = $this->engine()->validateDefinition([...$this->definition([]), 'previewUrl' => $url]);
            $this->assertSame($url, $definition['previewUrl']);
            $this->assertSame($definition, $this->engine()->validateDefinition($definition));
        }
    }

    #[DataProvider('invalidPreviewUrlProvider')]
    public function test_preview_urls_must_be_public_http_urls(mixed $url): void
    {
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition([...$this->definition([]), 'previewUrl' => $url]));
    }

    public static function invalidPreviewUrlProvider(): array
    {
        return array_map(fn ($value) => [$value], [
            null, false, [], '', 'demo.html', '//example.com/demo', 'javascript:alert(1)', 'ftp://example.com/demo',
            'https://user:pass@example.com/', 'https://user@example.com/', 'https://example.com:8090/',
            'https://localhost/', 'https://landings.localhost./', 'https://preview.local/', 'https://preview.internal/',
            'https://preview.test/', 'https://preview.invalid/', 'https://intranet/', 'https://127.0.0.1/',
            'https://10.0.0.1/', 'https://172.16.0.1/', 'https://192.168.1.1/', 'https://169.254.169.254/',
            'https://100.64.0.1/', 'https://0.0.0.0/', 'https://[::1]/', 'https://[fc00::1]/', 'https://[fe80::1]/',
            'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://127.1/', 'https://0177.0.0.1/',
            'https://0x7f000001/', 'https://0x7f.0x0.0x0.0x1/', "https://example.com/\npage", 'https://example.com\\@localhost/',
        ]);
    }

    #[DataProvider('invalidAiInstructionsProvider')]
    public function test_ai_instructions_require_bounded_utf8_strings(mixed $instructions): void
    {
        $field = $this->field('title', 'text', ['aiInstructions' => $instructions]);
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition([$field])));
        $group = $this->field('article', 'group', ['fields' => [$field]]);
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition([$group])));
        $definition = [...$this->definition([]), 'blocks' => ['article' => ['aiInstructions' => $instructions]]];
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($definition));
    }

    public static function invalidAiInstructionsProvider(): array
    {
        return [[null], [true], [123], [[]], [str_repeat('a', 10001)], ["Invalid\xFF"], ["Invalid\0text"]];
    }

    public function test_ai_instructions_allow_empty_and_maximum_length_strings_and_validate_block_metadata(): void
    {
        foreach (['', str_repeat('a', 10000)] as $instructions) {
            $definition = $this->engine()->validateDefinition([
                ...$this->definition([$this->field('title', 'text', ['aiInstructions' => $instructions])]),
                'blocks' => ['article' => ['aiInstructions' => $instructions]],
            ]);
            $this->assertSame($instructions, $definition['sections'][0]['fields'][0]['aiInstructions']);
            $this->assertSame($instructions, $definition['blocks']['article']['aiInstructions']);
        }
        foreach ([null, 'invalid', [['aiInstructions' => 'Text']], ['bad-name' => ['aiInstructions' => 'Text']], ['article' => 'Text'], ['article' => []]] as $blocks) {
            $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition([...$this->definition([]), 'blocks' => $blocks]));
        }
        $definition = $this->engine()->validateDefinition($this->definition([$this->field('title', 'text')]));
        $this->assertArrayNotHasKey('aiInstructions', $definition['sections'][0]['fields'][0]);
        $this->assertArrayNotHasKey('blocks', $definition);
    }

    public function test_nested_blocks_repeated_items_and_partials_keep_their_context_and_escape_settings(): void
    {
        $definition = $this->definition([
            $this->field('brand', 'text', ['default' => 'Site & Co']),
            $this->field('header', 'group', ['fields' => [$this->field('title', 'text')]]),
            $this->field('comments', 'repeater', ['fields' => [
                $this->field('author', 'text'),
                $this->field('body', 'textarea'),
                $this->field('approved', 'checkbox'),
                $this->field('avatar', 'image'),
            ]]),
        ], '<header>{{#header}}{{title}} / {{brand}}{{/header}}</header>{{#comments}}{{>comment}}{{/comments}}{{^comments}}No comments{{/comments}}');
        $definition['partials'] = ['comment' => '<article>{{#approved}}<b>{{author}}</b><img src="{{avatar}}"><p>{{body}}</p><small>{{brand}}</small>{{/approved}}</article>'];

        $html = $this->engine()->render($definition, [
            'header' => ['title' => 'Our <story>'],
            'comments' => [
                ['author' => 'A "reader"', 'body' => '<script>alert(1)</script>', 'approved' => true, 'avatar' => 'assets/avatar.png'],
                ['author' => 'Hidden', 'approved' => false],
            ],
        ]);

        $this->assertSame('<header>Our &lt;story&gt; / Site &amp; Co</header><article><b>A &quot;reader&quot;</b><img src="assets/avatar.png"><p>&lt;script&gt;alert(1)&lt;/script&gt;</p><small>Site &amp; Co</small></article><article></article>', $html);
        $this->assertStringContainsString('No comments', $this->engine()->render($definition, []));
    }

    public function test_parent_and_root_bindings_resolve_shadowed_settings(): void
    {
        $definition = $this->definition([
            $this->field('name', 'text', ['default' => 'root']),
            $this->field('blocks', 'repeater', ['fields' => [
                $this->field('name', 'text'),
                $this->field('child', 'group', ['fields' => [$this->field('name', 'text')]]),
            ]]),
        ], '{{#blocks}}{{#child}}{{name}} / {{../name}} / {{../../name}} / {{@root.name}}{{/child}}{{/blocks}}');

        $this->assertSame('child / parent / root / root', $this->engine()->render($definition, [
            'blocks' => [['name' => 'parent', 'child' => ['name' => 'child']]],
        ]));
    }

    public function test_defaults_and_submitted_values_are_normalized_for_form_controls(): void
    {
        $definition = $this->engine()->validateDefinition($this->definition([
            $this->field('color', 'color', ['default' => '#aabbcc']),
            $this->field('size', 'range', ['min' => 10, 'max' => 30, 'step' => 0.5, 'default' => 14]),
            $this->field('layout', 'select', ['options' => ['wide' => 'Wide', 'narrow' => 'Narrow']]),
            $this->field('enabled', 'checkbox'),
            $this->field('comments', 'repeater', [
                'min_items' => 1,
                'max_items' => 3,
                'fields' => [$this->field('body', 'textarea', ['default' => 'Comment'])],
            ]),
        ]));

        $this->assertSame([
            'color' => '#aabbcc', 'size' => 14, 'layout' => 'wide', 'enabled' => false,
            'comments' => [['body' => 'Comment']],
        ], $this->engine()->defaults($definition));
        $values = $this->engine()->validateValues($definition, ['size' => '20.5', 'enabled' => '1']);
        $this->assertSame(20.5, $values['size']);
        $this->assertTrue($values['enabled']);
        $this->assertSame('textarea', $this->engine()->fieldAtPath($definition, 'comments.0.body')['type']);
        $this->assertNull($this->engine()->fieldAtPath($definition, 'comments.0.missing'));
        $this->assertNull($this->engine()->fieldAtPath($definition, '../../body'));
    }

    #[DataProvider('invalidValueProvider')]
    public function test_invalid_settings_fail_with_the_field_binding_path(array $field, mixed $value): void
    {
        $definition = $this->definition([$field]);
        $this->assertValidationKey('values.'.$field['name'], fn () => $this->engine()->validateValues($definition, [$field['name'] => $value]));
    }

    public static function invalidValueProvider(): array
    {
        return [
            'required' => [['name' => 'title', 'label' => 'Title', 'type' => 'text', 'required' => true], ' '],
            'out of range' => [['name' => 'size', 'label' => 'Size', 'type' => 'range', 'min' => 10, 'max' => 20], 21],
            'wrong step' => [['name' => 'size', 'label' => 'Size', 'type' => 'range', 'min' => 10, 'step' => 2], 11],
            'not numeric' => [['name' => 'size', 'label' => 'Size', 'type' => 'number'], 'ten'],
            'infinite' => [['name' => 'size', 'label' => 'Size', 'type' => 'number'], INF],
            'unknown option' => [['name' => 'layout', 'label' => 'Layout', 'type' => 'select', 'options' => ['a' => 'A']], 'b'],
            'css injection' => [['name' => 'color', 'label' => 'Color', 'type' => 'color'], 'red;background:url(https://x.test)'],
            'not boolean' => [['name' => 'enabled', 'label' => 'Enabled', 'type' => 'checkbox'], 'true'],
            'not email' => [['name' => 'email', 'label' => 'Email', 'type' => 'email'], 'broken'],
            'control character' => [['name' => 'title', 'label' => 'Title', 'type' => 'text'], "A\0B"],
            'too long' => [['name' => 'title', 'label' => 'Title', 'type' => 'text'], str_repeat('a', 10001)],
            'URL scheme' => [['name' => 'link', 'label' => 'Link', 'type' => 'url'], 'javascript:alert(1)'],
        ];
    }

    #[DataProvider('unsafeImageProvider')]
    public function test_unsafe_image_references_are_rejected(string $image): void
    {
        $definition = $this->definition([$this->field('logo', 'image')]);
        $this->assertValidationKey('values.logo', fn () => $this->engine()->validateValues($definition, ['logo' => $image]));
    }

    public static function unsafeImageProvider(): array
    {
        return array_map(fn ($value) => [$value], [
            'javascript:alert(1)', '//other.test/logo.png', '/absolute.png', '../escape.png',
            'assets/../escape.png', 'assets\\escape.png', 'assets/%2e%2e/escape.png',
            'assets/%252e%252e/escape.png', 'data:image/svg+xml,<svg/>', "https://site.test/\nimage.png",
            'https://site.test/%0d%0aimage.png', 'https://user:pass@site.test/logo.png', 'file:///private/logo.png',
        ]);
    }

    public function test_relative_assets_and_https_images_are_valid(): void
    {
        $definition = $this->definition([$this->field('logo', 'image'), $this->field('link', 'url')]);
        foreach (['assets/images/logo.png', 'uploads/abc-image.webp', 'https://images.example.com/logo.png?v=2'] as $image) {
            $values = $this->engine()->validateValues($definition, ['logo' => $image, 'link' => 'https://example.com/page?a=b&c=d']);
            $this->assertSame($image, $values['logo']);
        }
    }

    #[DataProvider('invalidSyntaxProvider')]
    public function test_invalid_or_unknown_template_expressions_are_rejected(string $html, array $partials = []): void
    {
        $definition = $this->definition([$this->field('title', 'text')], $html);
        $definition['partials'] = $partials;
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($definition));
    }

    public static function invalidSyntaxProvider(): array
    {
        return [
            'unterminated' => ['{{title'],
            'unclosed block' => ['{{#title}}content'],
            'mismatched block' => ['{{#title}}{{/wrong}}'],
            'unknown binding' => ['{{missing}}'],
            'outside parent' => ['{{../title}}'],
            'raw value' => ['{{{title}}}'],
            'unescaped value' => ['{{&title}}'],
            'function call' => ['{{system("whoami")}}'],
            'missing partial' => ['{{>missing}}'],
            'direct recursion' => ['{{>a}}', ['a' => '{{>a}}']],
            'indirect recursion' => ['{{>a}}', ['a' => '{{>b}}', 'b' => '{{>a}}']],
            'unused broken partial' => ['{{title}}', ['unused' => '{{>missing}}']],
            'partial unknown field' => ['{{>a}}', ['a' => '{{missing}}']],
        ];
    }

    public function test_duplicate_fields_across_sections_and_invalid_defaults_are_rejected(): void
    {
        $definition = $this->definition([$this->field('title', 'text')]);
        $definition['sections'][] = ['id' => 'another', 'label' => 'Another', 'fields' => [$this->field('title', 'text')]];
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($definition));

        $definition = $this->definition([$this->field('color', 'color', ['default' => 'red'])]);
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($definition));
    }

    public function test_schema_depth_field_count_and_repeater_limits_are_bounded(): void
    {
        $field = $this->field('child', 'text');
        for ($index = 0; $index < 6; $index++) {
            $field = $this->field('block', 'group', ['fields' => [$field]]);
        }
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition([$field])));
        $fields = array_map(fn ($index) => $this->field('field'.$index, 'text'), range(1, 201));
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition($fields)));
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition([
            $this->field('items', 'repeater', ['fields' => [], 'max_items' => 51]),
        ])));
    }

    public function test_reserved_field_metadata_is_valid_and_type_specific(): void
    {
        foreach ([
            $this->field('title', 'text', ['author_type' => 'invalid']),
            $this->field('title', 'text', ['author_type' => 123]),
            $this->field('title', 'text', ['fields' => []]),
            $this->field('title', 'text', ['options' => ['a' => 'A']]),
            $this->field('title', 'text', ['min' => 1]),
            $this->field('title', 'text', ['max' => 2]),
            $this->field('title', 'text', ['step' => 1]),
            $this->field('title', 'text', ['min_items' => 0]),
            $this->field('title', 'text', ['max_items' => 1]),
            $this->field('title', 'text', ['aspect_ratio' => 1]),
            $this->field('title', 'text', ['sizes' => [['width' => 10, 'height' => 10]]]),
        ] as $field) {
            $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition([$field])));
        }

        $definition = $this->engine()->validateDefinition($this->definition([
            $this->field('title', 'text', ['author_type' => 'Headline', 'applicationMetadata' => ['variant' => 'hero']]),
        ]));
        $this->assertSame('Headline', $definition['sections'][0]['fields'][0]['author_type']);
        $this->assertSame(['variant' => 'hero'], $definition['sections'][0]['fields'][0]['applicationMetadata']);
    }

    public function test_unknown_settings_and_nested_invalid_values_have_precise_errors(): void
    {
        $definition = $this->definition([
            $this->field('comments', 'repeater', ['fields' => [$this->field('email', 'email')], 'max_items' => 1]),
        ]);
        $this->assertValidationKey('values.unknown', fn () => $this->engine()->validateValues($definition, ['unknown' => 'data']));
        $this->assertValidationKey('values.comments.0.email', fn () => $this->engine()->validateValues($definition, ['comments' => [['email' => 'bad']]]));
        $this->assertValidationKey('values.comments', fn () => $this->engine()->validateValues($definition, ['comments' => [[], []]]));
    }

    public function test_generated_output_and_default_expansion_are_bounded(): void
    {
        app()->instance(TemplateEngine::class, new TemplateEngine(app(TemplateRichText::class), 40));
        $definition = $this->definition([
            $this->field('items', 'repeater', ['fields' => [$this->field('title', 'text')]]),
        ], '{{#items}}<p>{{title}}</p>{{/items}}');
        $this->assertValidationKey('template', fn () => $this->engine()->render($definition, [
            'items' => array_fill(0, 10, ['title' => 'Item']),
        ]));

        $nested = $this->field('value', 'text');
        for ($index = 0; $index < 3; $index++) {
            $nested = $this->field('items', 'repeater', ['min_items' => 50, 'fields' => [$nested]]);
        }
        $this->assertValidationKey('template', fn () => $this->engine()->validateDefinition($this->definition([$nested])));
    }

    public function test_json_parsing_reports_invalid_payloads_and_does_not_execute_server_code(): void
    {
        $this->assertValidationKey('template', fn () => $this->engine()->parse('{broken'));
        $this->assertValidationKey('template', fn () => $this->engine()->parse('[]'));
        $this->assertValidationKey('template', fn () => $this->engine()->parse(json_encode($this->definition([], '<?php echo "never execute"; ?> @php(system("whoami"))'), JSON_THROW_ON_ERROR)));
    }

    private function engine(): TemplateEngine
    {
        return app(TemplateEngine::class);
    }

    private function definition(array $fields, string $html = '<main>Landing</main>'): array
    {
        return ['version' => 1, 'name' => 'Test template', 'sections' => [
            ['id' => 'main', 'label' => 'Main', 'fields' => $fields],
        ], 'html' => $html];
    }

    private function field(string $name, string $type, array $extra = []): array
    {
        return ['name' => $name, 'label' => ucfirst($name), 'type' => $type, ...$extra];
    }

    private function assertValidationKey(string $key, callable $callback): void
    {
        try {
            $callback();
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey($key, $exception->errors());

            return;
        }

        $this->fail("Expected a validation error for {$key}.");
    }
}
