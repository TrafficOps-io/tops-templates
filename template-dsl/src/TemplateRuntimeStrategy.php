<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

/** Runtime expressions supported by a host-selected template dialect. */
interface TemplateRuntimeStrategy
{
    public function validateContext(array $context): array;

    public function compile(PreparedSource $source): mixed;

    public function nodes(PreparedSource $source, int $offset, int $length, mixed $compiled): array;

    public function isRuntimeNode(array $node): bool;

    public function render(array $node, array $context): string;

    public function assertRenderedPositions(string $output, array $placements): void;
}
