<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Support\ServiceProvider;

final class TemplateDslServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TemplateDialect::class, SafeTemplateDialect::class);
        $this->app->singleton(TemplateFieldTypes::class);
        $this->app->singleton(TemplateRichText::class);
        $this->app->singleton(TemplateMarkupCompiler::class);
        $this->app->singleton(TemplateSourceParser::class);
        $this->app->singleton(TemplateEngine::class);
    }
}
