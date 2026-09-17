<?php

declare(strict_types=1);

// Differential-test bridge. This process initializes the same minimal Illuminate
// container as the PHP package tests; it never evaluates submitted template code.
require dirname(__DIR__, 2).'/template-dsl/tests/bootstrap.php';

use Illuminate\Container\Container;
use Illuminate\Support\Facades\Facade;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use TrafficOps\TemplateDsl\TemplateDslServiceProvider;
use TrafficOps\TemplateDsl\TemplateEngine;
use TrafficOps\TemplateDsl\TemplateSourceParser;

$container = new Container;
Container::setInstance($container);
Facade::clearResolvedInstances();
Facade::setFacadeApplication($container);
$container->instance('validator', new Factory(new Translator(new ArrayLoader, 'en'), $container));
(new TemplateDslServiceProvider($container))->register();

try {
    $input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
    $sources = $input['includes'] ?? [];
    $include = static function (string $path) use ($sources): string {
        if (! array_key_exists($path, $sources)) {
            throw new RuntimeException('Missing include: '.$path);
        }

        return $sources[$path];
    };
    $engine = $container->make(TemplateEngine::class);
    $parser = $container->make(TemplateSourceParser::class);
    $definition = $engine->validateDefinition($parser->parse(
        $input['source'],
        include: $include,
        filename: $input['filename'] ?? 'index.tpl.html',
    ));
    echo json_encode([
        'ok' => true,
        'defaults' => $engine->defaults($definition),
        'html' => $engine->render($definition, $input['values'] ?? [], $input['context'] ?? []),
    ], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    echo json_encode(['ok' => false, 'error' => $error->getMessage()], JSON_THROW_ON_ERROR);
}
