<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

enum SourcePhase: string
{
    case Parser = 'parser';
    case Renderer = 'renderer';
}
