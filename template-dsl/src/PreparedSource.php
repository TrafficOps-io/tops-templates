<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

/** Immutable source prepared by a host-selected dialect. */
final readonly class PreparedSource
{
    public function __construct(
        public string $text,
        public array $opaque = [],
        public array $metadata = [],
    ) {}

    public function restore(string $text): string
    {
        return $this->opaque === [] ? $text : strtr($text, $this->opaque);
    }
}
