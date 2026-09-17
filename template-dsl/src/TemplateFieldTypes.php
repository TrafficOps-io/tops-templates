<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Closure;
use Illuminate\Validation\ValidationException;

/** Authoring types map to supported form controls; applications may register more aliases. */
final class TemplateFieldTypes
{
    private array $types = [];

    public function __construct()
    {
        foreach ([
            'String' => 'text', 'Text' => 'textarea', 'Color' => 'color',
            'Wysiwyg' => 'wysiwyg', 'Markdown' => 'markdown',
            'Number' => 'number', 'Range' => 'range', 'Boolean' => 'checkbox',
            'Image' => 'image', 'Url' => 'url', 'Email' => 'email', 'Select' => 'select',
        ] as $name => $control) {
            $this->register($name, function (array $options) use ($control): array {
                if (array_key_exists('default', $options)) {
                    $value = $options['default'];
                    if (in_array($control, ['number', 'range'], true) && is_numeric($value)) {
                        $options['default'] = $value + 0;
                    } elseif ($control === 'checkbox' && in_array($value, ['true', 'false'], true)) {
                        $options['default'] = $value === 'true';
                    }
                }

                return ['type' => $control, ...$options];
            });
        }
    }

    public function register(string $name, Closure $factory): void
    {
        $this->types[$name] = $factory;
    }

    public function has(string $name): bool
    {
        return isset($this->types[$name]);
    }

    public function field(string $name, array $options): array
    {
        if (! $this->has($name)) {
            throw ValidationException::withMessages(['template' => "Unknown field type {$name}."]);
        }

        return ($this->types[$name])($options);
    }
}
