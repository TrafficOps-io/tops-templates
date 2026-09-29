<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

/**
 * State of one value-normalization pass: the remaining value budget and the
 * warnings for dropped unknown keys (dotted path relative to the values root => message).
 *
 * @internal
 */
final class ValueValidation
{
    /** @var array<string, string> */
    public array $warnings = [];

    public function __construct(public int $budget) {}
}
