<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Closure;
use Illuminate\Validation\ValidationException;
use TrafficOps\TemplateDsl\DirectiveExtraction;
use TrafficOps\TemplateDsl\LiteralRuntimeStrategy;
use TrafficOps\TemplateDsl\PreparedSource;
use TrafficOps\TemplateDsl\SafeTemplateDialect;
use TrafficOps\TemplateDsl\SourcePhase;
use TrafficOps\TemplateDsl\TemplateDialect;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateFieldTypes;
use TrafficOps\TemplateDsl\TemplateMarkupCompiler;
use TrafficOps\TemplateDsl\TemplateRichText;
use TrafficOps\TemplateDsl\TemplateRuntimeStrategy;
use TrafficOps\TemplateDsl\TemplateSourceParser;

class TemplateDialectTest extends TestCase
{
    public function test_safe_dialect_is_the_container_and_constructor_default(): void
    {
        $this->assertInstanceOf(SafeTemplateDialect::class, app(TemplateDialect::class));

        $definition = $this->definition('<?php echo "unsafe"; ?>');
        foreach ([app(TemplateEngine::class), new TemplateEngine(app(TemplateRichText::class))] as $engine) {
            try {
                $engine->validateDefinition($definition);
                $this->fail('The default dialect accepted executable source.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_a_host_can_select_a_literal_custom_dialect_without_forking_the_core(): void
    {
        $dialect = new PermissiveTestDialect;
        $engine = new TemplateEngine(app(TemplateRichText::class), 8388608, $dialect);
        $definition = $engine->validateDefinition([
            ...$this->definition('<?php echo "trusted"; ?><p>{{title}}</p>'),
            'entrypoint' => 'index.php',
            'sections' => [['id' => 'main', 'label' => 'Main', 'fields' => [
                ['name' => 'title', 'type' => 'text', 'label' => 'Title'],
            ]]],
        ]);

        $this->assertSame('<?php echo "trusted"; ?><p>Example</p>', $engine->render($definition, ['title' => 'Example']));

        $parser = new TemplateSourceParser(new TemplateFieldTypes, new TemplateMarkupCompiler, $dialect);
        $parsed = $parser->parse("@layout\n<?php echo 'trusted'; ?>\n@endlayout", filename: 'index.tpl.php');
        $this->assertStringContainsString("<?php echo 'trusted'; ?>", $parsed['html']);
    }

    public function test_custom_dialects_cannot_disable_core_path_invariants(): void
    {
        $dialect = new PermissiveTestDialect;
        $engine = new TemplateEngine(app(TemplateRichText::class), 8388608, $dialect);

        foreach ([
            [...$this->definition('Page'), 'entrypoint' => '../index.php'],
            [...$this->definition('Page'), 'entrypoint' => 'index.php', 'pages' => ['../secret.php' => 'Secret']],
            [...$this->definition('Page'), 'entrypoint' => 'index.php', 'pages' => ['_media/page.php' => 'Secret']],
        ] as $definition) {
            try {
                $engine->validateDefinition($definition);
                $this->fail('A custom dialect bypassed a core output-path invariant.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }

        $called = false;
        $parser = new TemplateSourceParser(new TemplateFieldTypes, new TemplateMarkupCompiler, $dialect);
        try {
            $parser->parse("@include \"../secret.tpl.php\"\n@layout\nPage\n@endlayout", function () use (&$called): string {
                $called = true;

                return '';
            }, 'index.tpl.php');
            $this->fail('A custom dialect bypassed include traversal protection.');
        } catch (ValidationException) {
            $this->assertFalse($called);
        }
    }

    public function test_included_path_discovery_validates_and_bounds_the_root_source_map(): void
    {
        $parser = $this->parser();
        $invalidSources = [
            [],
            array_fill(0, 101, ''),
            [0 => 'text'],
            ['index.tpl' => 123],
            ['../index.tpl' => 'text'],
        ];

        foreach ($invalidSources as $sources) {
            try {
                $parser->includedPaths($sources, fn (): string => '');
                $this->fail('Invalid root sources were accepted.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }

        $safeParser = new TemplateSourceParser(new TemplateFieldTypes, new TemplateMarkupCompiler);
        $this->expectException(ValidationException::class);
        $safeParser->includedPaths(['index.php' => 'text'], fn (): string => '');
    }

    public function test_included_path_discovery_shares_source_and_line_budgets_across_all_roots_and_includes(): void
    {
        $byteParser = $this->parser(maxDefinitionBytes: 100);
        try {
            $byteParser->includedPaths([
                'first.tpl' => "@include \"shared.tpl\"\n",
                'second.tpl' => "@include \"shared.tpl\"\n",
            ], fn (): string => str_repeat('x', 35));
            $this->fail('Separate roots reset the aggregate source byte budget.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('under 2 MB', $exception->errors()['template'][0]);
        }

        $lineParser = $this->parser();
        try {
            $lineParser->includedPaths([
                'first.tpl' => str_repeat("text\n", 10000),
                'second.tpl' => str_repeat("text\n", 10000),
            ], fn (): string => '');
            $this->fail('Separate roots reset the aggregate source line budget.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('20,000 line limit', $exception->errors()['template'][0]);
        }
    }

    public function test_prepared_source_expansion_uses_one_aggregate_budget(): void
    {
        $dialect = new HookedTestDialect(
            prepare: fn (string $source): PreparedSource => new PreparedSource($source.str_repeat(' ', 55)),
        );
        $parser = $this->parser($dialect, 140);

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('Prepared template text exceeds the aggregate source limit');
        $parser->parsePages([
            'index.tpl' => "@layout\nHome\n@endlayout",
            'about.tpl' => "@layout\nAbout\n@endlayout",
        ], 'index.tpl');
    }

    public function test_directive_extraction_rejects_malformed_and_over_budget_token_streams(): void
    {
        $dialects = [
            new HookedTestDialect(
                extract: fn (): DirectiveExtraction => new DirectiveExtraction([['kind' => 'text']]),
            ),
            new HookedTestDialect(
                extract: fn (array $tokens): DirectiveExtraction => new DirectiveExtraction(array_fill(0, 20001, $tokens[1])),
            ),
        ];

        foreach ($dialects as $dialect) {
            try {
                $this->parser($dialect)->parse("@layout\nPage\n@endlayout", filename: 'index.tpl');
                $this->fail('An invalid extracted token stream was accepted.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_directive_extraction_cannot_inject_or_reorder_page_boundaries(): void
    {
        $sources = [
            'index.tpl' => "@layout\nHome\n@endlayout",
            'about.tpl' => "@layout\nAbout\n@endlayout",
        ];
        $dialects = [
            new HookedTestDialect(
                extract: fn (array $tokens): DirectiveExtraction => new DirectiveExtraction(array_reverse($tokens)),
            ),
            new HookedTestDialect(
                extract: function (array $tokens): DirectiveExtraction {
                    array_splice($tokens, 1, 0, [[
                        'kind' => '_page',
                        'file' => 'injected.tpl',
                        'line' => 1,
                        'text' => '',
                        'args' => '',
                    ]]);

                    return new DirectiveExtraction($tokens);
                },
            ),
        ];

        foreach ($dialects as $dialect) {
            try {
                $this->parser($dialect)->parsePages($sources, 'index.tpl');
                $this->fail('A dialect changed the page topology.');
            } catch (ValidationException $exception) {
                $this->assertStringContainsString('page boundaries', $exception->errors()['template'][0]);
            }
        }
    }

    public function test_directive_extraction_can_only_stably_remove_existing_tokens(): void
    {
        $dialect = new HookedTestDialect(
            extract: function (array $tokens): DirectiveExtraction {
                $tokens[1]['kind'] = 'param';

                return new DirectiveExtraction($tokens);
            },
        );

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('may only remove tokens');
        $this->parser($dialect)->parse("@layout\nPage\n@endlayout", filename: 'index.tpl');
    }

    public function test_finished_pages_keep_per_page_and_aggregate_output_budgets(): void
    {
        $oversizedPage = new HookedTestDialect(
            finish: fn (): string => str_repeat('x', 2097153),
        );
        try {
            $this->parser($oversizedPage)->parse("@layout\nPage\n@endlayout", filename: 'index.tpl');
            $this->fail('A dialect inflated one parsed page beyond 2 MB.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('page may not exceed 2 MB', $exception->errors()['template'][0]);
        }

        $aggregatePages = new HookedTestDialect(
            finish: fn (): string => str_repeat('x', 100),
        );
        try {
            $this->parser($aggregatePages, 180)->parsePages([
                'index.tpl' => "@layout\nHome\n@endlayout",
                'about.tpl' => "@layout\nAbout\n@endlayout",
            ], 'index.tpl');
            $this->fail('A dialect inflated aggregate parsed pages beyond the configured limit.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('aggregate template definition limit', $exception->errors()['template'][0]);
        }
    }

    public function test_rendering_rechecks_prepared_and_finished_text_invariants(): void
    {
        $invalidPreparedSources = [
            new PreparedSource("Page\0"),
            new PreparedSource("Page\xFF"),
            new PreparedSource('Page', ['' => 'fragment']),
            new PreparedSource('Page', ['marker' => 123]),
        ];

        foreach ($invalidPreparedSources as $prepared) {
            $dialect = new HookedTestDialect(
                prepare: fn (string $source, string $file, SourcePhase $phase): PreparedSource => $phase === SourcePhase::Renderer ? $prepared : new PreparedSource($source),
            );
            try {
                $this->engine($dialect)->validateDefinition([
                    ...$this->definition('Page'),
                    'entrypoint' => 'index.php',
                ]);
                $this->fail('A dialect returned invalid prepared renderer source.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }

        foreach (["Page\0", "Page\xFF"] as $finished) {
            $dialect = new HookedTestDialect(renderFinish: fn (): string => $finished);
            $engine = $this->engine($dialect);
            $definition = $engine->validateDefinition([
                ...$this->definition('Page'),
                'entrypoint' => 'index.php',
            ]);

            try {
                $engine->render($definition, []);
                $this->fail('A dialect returned invalid final renderer output.');
            } catch (ValidationException $exception) {
                $this->assertStringContainsString('UTF-8 text without null bytes', $exception->errors()['template'][0]);
            }
        }
    }

    private function parser(?TemplateDialect $dialect = null, int $maxDefinitionBytes = 2097152): TemplateSourceParser
    {
        return new TemplateSourceParser(
            new TemplateFieldTypes,
            new TemplateMarkupCompiler,
            $dialect ?? new PermissiveTestDialect,
            $maxDefinitionBytes,
        );
    }

    private function engine(TemplateDialect $dialect): TemplateEngine
    {
        return new TemplateEngine(app(TemplateRichText::class), 8388608, $dialect);
    }

    private function definition(string $html): array
    {
        return [
            'version' => 1,
            'name' => 'Dialect test',
            'sections' => [['id' => 'main', 'label' => 'Main', 'fields' => []]],
            'html' => $html,
        ];
    }
}

class PermissiveTestDialect implements TemplateDialect
{
    private LiteralRuntimeStrategy $runtime;

    public function __construct()
    {
        $this->runtime = new LiteralRuntimeStrategy;
    }

    public function id(): string
    {
        return 'test-literal-v1';
    }

    public function assertSourcePath(string $path): void {}

    public function assertEntrypoint(string $path): void
    {
        if ($path !== 'index.php') {
            throw ValidationException::withMessages(['template' => 'Expected index.php.']);
        }
    }

    public function assertPagePath(string $path): void
    {
        if (! str_ends_with($path, '.php')) {
            throw ValidationException::withMessages(['template' => 'Expected a PHP output path.']);
        }
    }

    public function prepareSource(string $source, string $file, SourcePhase $phase): PreparedSource
    {
        return new PreparedSource($source);
    }

    public function extractDirectives(array $tokens, string $entrypoint): DirectiveExtraction
    {
        return new DirectiveExtraction($tokens);
    }

    public function finishParsedPage(string $page, string $html, DirectiveExtraction $extraction, array $opaque): string
    {
        return $html;
    }

    public function validateSource(string $source, string $file = 'template'): void {}

    public function runtime(): TemplateRuntimeStrategy
    {
        return $this->runtime;
    }

    public function validationSample(string $fieldType, string $value): string
    {
        return $value;
    }

    public function finishRendered(string $output, PreparedSource $main, array $partials, array $usedPartials): string
    {
        return $output;
    }
}

final class HookedTestDialect extends PermissiveTestDialect
{
    public function __construct(
        private ?Closure $prepare = null,
        private ?Closure $extract = null,
        private ?Closure $finish = null,
        private ?Closure $renderFinish = null,
    ) {
        parent::__construct();
    }

    public function prepareSource(string $source, string $file, SourcePhase $phase): PreparedSource
    {
        return $this->prepare === null ? parent::prepareSource($source, $file, $phase) : ($this->prepare)($source, $file, $phase);
    }

    public function extractDirectives(array $tokens, string $entrypoint): DirectiveExtraction
    {
        return $this->extract === null ? parent::extractDirectives($tokens, $entrypoint) : ($this->extract)($tokens, $entrypoint);
    }

    public function finishParsedPage(string $page, string $html, DirectiveExtraction $extraction, array $opaque): string
    {
        return $this->finish === null ? parent::finishParsedPage($page, $html, $extraction, $opaque) : ($this->finish)($page, $html, $extraction, $opaque);
    }

    public function finishRendered(string $output, PreparedSource $main, array $partials, array $usedPartials): string
    {
        return $this->renderFinish === null ? parent::finishRendered($output, $main, $partials, $usedPartials) : ($this->renderFinish)($output, $main, $partials, $usedPartials);
    }
}
