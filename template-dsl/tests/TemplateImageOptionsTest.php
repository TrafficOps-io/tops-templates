<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateImageOptions;
use TrafficOps\TemplateDsl\TemplateSourceParser;

class TemplateImageOptionsTest extends TestCase
{
    public function test_dsl_image_options_survive_nested_types_and_definition_validation(): void
    {
        $source = <<<'TPL'
@template "Images"
@type Card
@param cover Image aspect_ratio="16:9"
@param avatar Image sizes="128x128|256x256"
@endtype
@param cards Card[] min_items=1
@layout
@each card in cards:
<img src="{{card.cover}}"><img src="{{card.avatar}}">
@endeach
@endlayout
TPL;
        $engine = app(TemplateEngine::class);
        $definition = $engine->validateDefinition(app(TemplateSourceParser::class)->parse($source));
        $this->assertEqualsWithDelta(16 / 9, $engine->fieldAtPath($definition, 'cards.0.cover')['aspect_ratio'], 0.0001);
        $this->assertSame(['width' => 256, 'height' => 256, 'label' => ''], $engine->fieldAtPath($definition, 'cards.0.avatar')['sizes'][1]);
        $this->assertSame($definition, $engine->validateDefinition($definition));
        $this->assertSame('16:9', TemplateImageOptions::ratioLabel(16 / 9));
    }

    #[DataProvider('invalidOptions')]
    public function test_invalid_image_metadata_is_rejected(array $options): void
    {
        $this->expectException(ValidationException::class);
        TemplateImageOptions::normalize([...['type' => 'image'], ...$options], 'image');
    }

    public static function invalidOptions(): array
    {
        return array_map(fn ($options) => [$options], [
            ['aspect_ratio' => 0], ['aspect_ratio' => -2], ['aspect_ratio' => true], ['aspect_ratio' => INF],
            ['aspect_ratio' => '16:0'], ['aspect_ratio' => '16:9; color:red'], ['aspect_ratio' => null],
            ['aspect_ratio' => 1, 'sizes' => []], ['type' => 'text', 'aspect_ratio' => 1],
            ['sizes' => []], ['sizes' => '100x100'], ['sizes' => null],
            ['sizes' => [['width' => 5000, 'height' => 100]]], ['sizes' => [['width' => 0, 'height' => 100]]],
            ['sizes' => [['width' => '100', 'height' => 100]]], ['sizes' => [['width' => 100]]],
            ['sizes' => [['width' => 100, 'height' => 100, 'label' => []]]],
            ['sizes' => array_fill(0, 11, ['width' => 100, 'height' => 100])],
            ['sizes' => array_fill(0, 2, ['width' => 100, 'height' => 100])],
        ]);
    }
}
