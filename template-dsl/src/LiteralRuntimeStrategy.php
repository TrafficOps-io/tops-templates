<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;
use LogicException;

/** Preserve non-Mustache runtime syntax for a host that processes it later. */
final class LiteralRuntimeStrategy implements TemplateRuntimeStrategy
{
    public function validateContext(array $context): array
    {
        if ($context !== []) {
            throw ValidationException::withMessages(['template' => 'This template dialect does not accept render context.']);
        }

        return [];
    }

    public function compile(PreparedSource $source): null
    {
        return null;
    }

    public function nodes(PreparedSource $source, int $offset, int $length, mixed $compiled): array
    {
        if ($length === 0) {
            return [];
        }

        return [['type' => 'text', 'text' => $source->restore(substr($source->text, $offset, $length))]];
    }

    public function isRuntimeNode(array $node): bool
    {
        return false;
    }

    public function render(array $node, array $context): string
    {
        throw new LogicException('The literal runtime strategy has no runtime nodes.');
    }

    public function assertRenderedPositions(string $output, array $placements): void {}
}
