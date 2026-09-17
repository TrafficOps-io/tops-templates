<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

final class SafeRuntimeStrategy implements TemplateRuntimeStrategy
{
    public function validateContext(array $context): array
    {
        return TemplateRuntimeMacros::validateContext($context);
    }

    public function compile(PreparedSource $source): array
    {
        return TemplateRuntimeMacros::compile($source->text);
    }

    public function nodes(PreparedSource $source, int $offset, int $length, mixed $compiled): array
    {
        $budget = PHP_INT_MAX;

        return TemplateRuntimeMacros::nodes($source->text, $offset, $length, $budget, $compiled);
    }

    public function isRuntimeNode(array $node): bool
    {
        return ($node['type'] ?? null) === 'runtime';
    }

    public function render(array $node, array $context): string
    {
        return TemplateRuntimeMacros::render($node, $context);
    }

    public function assertRenderedPositions(string $output, array $placements): void
    {
        TemplateRuntimeMacros::assertRenderedPositions($output, $placements);
    }
}
