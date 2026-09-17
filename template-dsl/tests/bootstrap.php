<?php

declare(strict_types=1);
use Illuminate\Container\Container;

$autoload = getenv('TEMPLATE_DSL_TEST_AUTOLOAD') ?: __DIR__.'/../../vendor/autoload.php';
if (! is_file($autoload)) {
    throw new RuntimeException('Install package dependencies or set TEMPLATE_DSL_TEST_AUTOLOAD to a Composer autoloader.');
}
require $autoload;

// The package deliberately depends on Illuminate components rather than the
// full Laravel framework, so the framework's global app() helper is not
// available in a standalone install. Keep this test-only compatibility helper
// backed by the container initialized in TestCase.
if (! function_exists('app')) {
    function app(?string $abstract = null, array $parameters = []): mixed
    {
        $container = Container::getInstance();

        return $abstract === null ? $container : $container->make($abstract, $parameters);
    }
}

// Application autoloaders intentionally do not include this package's
// autoload-dev mapping. Keep only the test namespace available for monorepo
// compatibility runs; production classes must always come from Composer.
spl_autoload_register(function (string $class): void {
    $prefix = 'TrafficOps\\TemplateDsl\\Tests\\';
    if (! str_starts_with($class, $prefix)) {
        return;
    }
    $path = __DIR__.'/'.str_replace('\\', '/', substr($class, strlen($prefix))).'.php';
    if (is_file($path)) {
        require $path;
    }
});
