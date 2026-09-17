<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

/** Result of removing dialect-owned declarations from the core token stream. */
final readonly class DirectiveExtraction
{
    public function __construct(
        public array $tokens,
        public array $pageMetadata = [],
    ) {}
}
