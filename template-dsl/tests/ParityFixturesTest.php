<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Throwable;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateSourceParser;

/**
 * Shared parity fixtures (fixtures/parity/*.json) are the contract between this reference
 * implementation and the portable JavaScript runtime (ADR-0001). The same cases run in
 * runtime/test/parity-fixtures.test.js.
 */
class ParityFixturesTest extends TestCase
{
    #[DataProvider('fixtureProvider')]
    public function test_fixture_case_matches_the_reference_behaviour(array $case): void
    {
        $expect = $case['expect'];
        try {
            $actual = $this->runCase($case);
        } catch (Throwable $exception) {
            if ($expect['ok'] ?? true) {
                $message = $exception instanceof ValidationException ? json_encode($exception->errors()) : $exception->getMessage();
                $this->fail("Expected the case to succeed, got: {$message}");
            }
            $this->assertTrue(true);

            return;
        }
        $this->assertTrue($expect['ok'], 'Expected the case to be rejected but it succeeded.');
        if (array_key_exists('defaults', $expect)) {
            $this->assertSame(self::canonical($expect['defaults']), self::canonical($actual['defaults']), 'defaults');
        }
        if (array_key_exists('values', $expect)) {
            $this->assertSame(self::canonical(self::expand($expect['values'])), self::canonical($actual['values']), 'values');
        }
        if (array_key_exists('warnings', $expect)) {
            $this->assertSame($expect['warnings'], $actual['warnings'], 'warnings');
        }
        if (array_key_exists('html', $expect)) {
            $this->assertSame(self::normalize(self::expand($expect['html'])), self::normalize($actual['html']), 'html');
        }
        foreach ($expect['pages'] ?? [] as $path => $html) {
            $this->assertSame(self::normalize(self::expand($html)), self::normalize($actual['pages'][$path] ?? ''), "pages.{$path}");
        }
    }

    public static function fixtureProvider(): iterable
    {
        foreach (glob(dirname(__DIR__, 2).'/fixtures/parity/*.json') as $file) {
            $suite = json_decode(file_get_contents($file), true, 64, JSON_THROW_ON_ERROR);
            foreach ($suite['cases'] as $case) {
                yield basename($file, '.json').': '.$case['name'] => [$case];
            }
        }
    }

    private function runCase(array $case): array
    {
        $includes = $case['includes'] ?? [];
        $include = static function (string $path) use ($includes): string {
            if (! array_key_exists($path, $includes)) {
                throw new \RuntimeException("Missing include: {$path}");
            }

            return $includes[$path];
        };
        $sources = ['index.html' => $case['source']];
        foreach ($case['pages'] ?? [] as $name => $source) {
            $sources[preg_replace('/\.tpl(?:\.html)?$/i', '.html', $name)] = $source;
        }
        $engine = app(TemplateEngine::class);
        $definition = $engine->validateDefinition(app(TemplateSourceParser::class)->parsePages($sources, 'index.html', $include));
        $values = self::expand($case['values'] ?? []);
        $normalized = $engine->validateValues($definition, $values, $warnings);
        $pages = $engine->renderPages($definition, $values, $case['context'] ?? []);

        return [
            'defaults' => $engine->defaults($definition),
            'values' => $normalized,
            'warnings' => array_keys($warnings),
            'html' => $pages['index.html'],
            'pages' => $pages,
        ];
    }

    /** {"$repeat": ["a", n]} and {"$concat": [...]} keep large fixture inputs readable. */
    private static function expand(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (array_keys($value) === ['$repeat']) {
            return str_repeat($value['$repeat'][0], $value['$repeat'][1]);
        }
        if (array_keys($value) === ['$concat']) {
            return implode('', array_map(self::expand(...), $value['$concat']));
        }

        return array_map(self::expand(...), $value);
    }

    /** JSON has no int/float distinction; PHP renders integral floats without a fraction. */
    private static function canonical(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_map(self::canonical(...), $value);
        }
        if (is_float($value) && is_finite($value) && $value === floor($value)) {
            return (int) $value;
        }

        return $value;
    }

    private static function normalize(string $html): string
    {
        return trim(preg_replace('/\s+/', ' ', preg_replace('/>\s+</', '><', str_replace(["\r\n", "\r"], "\n", $html))));
    }
}
