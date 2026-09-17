<?php

// Optional integration helper: exercise the actual application parser and renderer.
// Usage: php test/fixtures/formatter/render.php /absolute/path/to/template.tpl
// It never connects to the database, writes configuration, or runs template JavaScript.
require __DIR__.'/../../../../template-dsl/tests/bootstrap.php';

$app = new \Illuminate\Container\Container;
\Illuminate\Container\Container::setInstance($app);
\Illuminate\Support\Facades\Facade::setFacadeApplication($app);
$app->instance('validator', new \Illuminate\Validation\Factory(
    new \Illuminate\Translation\Translator(new \Illuminate\Translation\ArrayLoader, 'en'), $app
));
(new \TrafficOps\TemplateDsl\TemplateDslServiceProvider($app))->register();

$source = file_get_contents($argv[1]);
$parser = $app->make(\TrafficOps\TemplateDsl\TemplateSourceParser::class);
$engine = $app->make(\TrafficOps\TemplateDsl\TemplateEngine::class);
$definition = $engine->validateDefinition($parser->parse($source, filename: basename($argv[1])));
$defaults = $engine->defaults($definition);
$html = $engine->render($definition, $defaults);
unset($definition['html']);

echo json_encode(['schema' => $definition, 'defaults' => $defaults, 'html' => $html], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
