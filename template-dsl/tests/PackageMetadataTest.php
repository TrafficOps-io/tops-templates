<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl\Tests;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;
use TrafficOps\TemplateDsl\LiteralRuntimeStrategy;
use TrafficOps\TemplateDsl\SafeRuntimeStrategy;
use TrafficOps\TemplateDsl\SafeTemplateDialect;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateSourceParser;

final class PackageMetadataTest extends TestCase
{
    public function test_safe_dialect_profile_matches_the_shipped_implementation(): void
    {
        $profile = $this->json('resources/dialects/core-v1.json');

        $this->assertSame((new SafeTemplateDialect)->id(), $profile['id']);
        $this->assertSame(SafeTemplateDialect::class, $profile['implementation']['class']);
        $this->assertSame(SafeRuntimeStrategy::class, $profile['runtime']['strategy']);
        $this->assertTrue($profile['implementation']['included']);
        $this->assertSame('host-only', $profile['selection']);
        $this->assertFalse($profile['execution']['phpSource']);
        $this->assertFalse($profile['execution']['phpOutput']);
        $this->assertFalse($profile['execution']['requestValidation']);
        $this->assertSame(['query', 'locale', 'actions'], $profile['runtime']['contextKeys']);
        $this->assertSame(['{query.name}', '{locale}', '{actions.name}'], $profile['runtime']['tokens']);
    }

    public function test_trusted_profile_is_descriptive_and_cannot_enable_itself(): void
    {
        $profile = $this->json('resources/dialects/fast-landings-v1.json');

        $this->assertSame('fast-landings-v1', $profile['id']);
        $this->assertSame('safe-html-v1', $profile['extends']);
        $this->assertSame('application-owned', $profile['implementation']['kind']);
        $this->assertFalse($profile['implementation']['included']);
        $this->assertSame('host-only', $profile['selection']);
        $this->assertSame(LiteralRuntimeStrategy::class, $profile['runtime']['strategy']);
        $this->assertTrue($profile['execution']['phpSource']);
        $this->assertTrue($profile['execution']['phpOutput']);
        $this->assertTrue($profile['execution']['requestValidation']);
    }

    public function test_definition_schema_describes_the_versioned_contract(): void
    {
        $schema = $this->json('resources/schema/template-definition-v1.schema.json');

        $this->assertSame('https://json-schema.org/draft/2020-12/schema', $schema['$schema']);
        $this->assertSame(1, $schema['properties']['version']['const']);
        $this->assertContains('version', $schema['required']);
        $this->assertContains('html', $schema['required']);

        $authorType = '~'.$schema['$defs']['authorType']['pattern'].'~D';
        $this->assertSame(1, preg_match($authorType, 'Article[]'));
        $this->assertSame(0, preg_match($authorType, 'article[]'));
    }

    public function test_definition_schema_accepts_real_normalized_json_encodings(): void
    {
        if (! class_exists(Validator::class)) {
            $this->markTestSkipped('The standalone package development dependencies provide the JSON Schema validator.');
        }

        $engine = app(TemplateEngine::class);
        $definitions = [
            $engine->validateDefinition([
                'version' => 1,
                'name' => 'Empty maps',
                'sections' => [],
                'html' => '<main>Empty</main>',
                'source' => 'template.tpl.html',
                'previewData' => [],
            ]),
            $engine->validateDefinition([
                'version' => 1,
                'name' => 'Complete definition',
                'sections' => [[
                    'id' => 'content',
                    'label' => 'Content',
                    'fields' => [
                        ['name' => 'kind', 'type' => 'select', 'label' => 'Kind', 'options' => [0 => 'Zero', 1 => 'One']],
                        ['name' => 'settings', 'type' => 'group', 'fields' => []],
                        ['name' => 'items', 'type' => 'repeater', 'label' => 'Items', 'min_items' => 0, 'max_items' => 2, 'fields' => [
                            ['name' => 'photo', 'type' => 'image', 'label' => 'Photo', 'sizes' => [
                                ['width' => 1200, 'height' => 630],
                            ]],
                        ]],
                    ],
                ]],
                'html' => '<main>{{kind}}</main>',
                'pages' => ['thanks.html' => '<main>Thanks</main>'],
                'partials' => ['card' => '<article>Card</article>'],
                'blocks' => ['card' => ['aiInstructions' => 'Keep it short.']],
                'previewData' => ['kind' => 0],
            ]),
            $engine->validateDefinition(app(TemplateSourceParser::class)->parse(<<<'TPL'
@param kind Select options="0:Zero|1:One"
@param cover Image sizes="1200x630"
@layout
<main>{{kind}} <img src="{{cover}}"></main>
@endlayout
TPL)),
        ];

        $validator = new Validator;
        $schema = $this->jsonObject('resources/schema/template-definition-v1.schema.json');
        foreach ($definitions as $definition) {
            $encoded = json_encode($definition, JSON_THROW_ON_ERROR);
            $data = json_decode($encoded, false, 512, JSON_THROW_ON_ERROR);
            $result = $validator->validate($data, $schema);
            $errors = $result->isValid() ? [] : (new ErrorFormatter)->format($result->error());

            $this->assertTrue($result->isValid(), json_encode($errors, JSON_THROW_ON_ERROR));
        }

        $invalid = json_decode(json_encode([...$definitions[0], 'version' => 2], JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
        $this->assertFalse($validator->validate($invalid, $schema)->isValid());
    }

    private function json(string $path): array
    {
        $contents = file_get_contents(dirname(__DIR__).'/'.$path);
        $this->assertIsString($contents);

        return json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
    }

    private function jsonObject(string $path): object
    {
        $contents = file_get_contents(dirname(__DIR__).'/'.$path);
        $this->assertIsString($contents);

        return json_decode($contents, false, 512, JSON_THROW_ON_ERROR);
    }
}
