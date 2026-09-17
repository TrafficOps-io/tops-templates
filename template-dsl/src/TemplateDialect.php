<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

/**
 * Host-selected language policy. Template source can never select its own dialect.
 *
 * Core path, size, nesting, token and rendering budgets remain enforced by the
 * engine and parser regardless of the selected dialect.
 */
interface TemplateDialect
{
    public function id(): string;

    public function assertSourcePath(string $path): void;

    public function assertEntrypoint(string $path): void;

    public function assertPagePath(string $path): void;

    public function prepareSource(string $source, string $file, SourcePhase $phase): PreparedSource;

    public function extractDirectives(array $tokens, string $entrypoint): DirectiveExtraction;

    public function finishParsedPage(string $page, string $html, DirectiveExtraction $extraction, array $opaque): string;

    public function validateSource(string $source, string $file = 'template'): void;

    public function runtime(): TemplateRuntimeStrategy;

    /** Return inert text used only while validating URL/email-shaped settings. */
    public function validationSample(string $fieldType, string $value): string;

    public function finishRendered(
        string $output,
        PreparedSource $main,
        array $partials,
        array $usedPartials,
    ): string;
}
