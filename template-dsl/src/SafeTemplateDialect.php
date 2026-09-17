<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;

/** Default non-executable HTML dialect. */
final class SafeTemplateDialect implements TemplateDialect
{
    public function __construct(private ?TemplateRuntimeStrategy $runtimeStrategy = null) {}

    public function id(): string
    {
        return 'safe-html-v1';
    }

    public function assertSourcePath(string $path): void
    {
        TemplateSourceSafety::assertPath($path);
    }

    public function assertEntrypoint(string $path): void
    {
        if ($path !== 'index.html') {
            $this->invalid('The template entrypoint must be index.html.');
        }
    }

    public function assertPagePath(string $path): void
    {
        if (! preg_match('/\.html$/D', $path)) {
            $this->invalid('Template page paths must be safe HTML output paths.');
        }
        TemplateSourceSafety::assertPath($path);
    }

    public function prepareSource(string $source, string $file, SourcePhase $phase): PreparedSource
    {
        $this->validateSource($source, $file);

        return new PreparedSource($source);
    }

    public function extractDirectives(array $tokens, string $entrypoint): DirectiveExtraction
    {
        return new DirectiveExtraction($tokens);
    }

    public function finishParsedPage(string $page, string $html, DirectiveExtraction $extraction, array $opaque): string
    {
        return $opaque === [] ? $html : strtr($html, $opaque);
    }

    public function validateSource(string $source, string $file = 'template'): void
    {
        TemplateSourceSafety::assertSource($source, $file);
    }

    public function runtime(): TemplateRuntimeStrategy
    {
        return $this->runtimeStrategy ??= new SafeRuntimeStrategy;
    }

    public function validationSample(string $fieldType, string $value): string
    {
        return $value;
    }

    public function finishRendered(string $output, PreparedSource $main, array $partials, array $usedPartials): string
    {
        return $output;
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['template' => $message]);
    }
}
