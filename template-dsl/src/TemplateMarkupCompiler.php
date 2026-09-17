<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;

/** Markup AST -> bounded, escaped renderer instructions. Blocks are typed reusable macros. */
final class TemplateMarkupCompiler
{
    private int $maxDefinitionBytes;

    public function __construct(int $maxDefinitionBytes = 2097152)
    {
        $this->maxDefinitionBytes = max(1, min(2097152, $maxDefinitionBytes));
    }

    public function compile(array $layout, array $blocks, array $rootTypes, array $types, TemplateFieldTypes $registry): string
    {
        foreach ($blocks as &$block) {
            foreach ($block['arguments'] as $type) {
                $base = str_ends_with($type, '[]') ? substr($type, 0, -2) : $type;
                if (! isset($types[$base]) && ! $registry->has($base)) {
                    $this->fail($block['source'], "Unknown block argument type {$type}.");
                }
            }
            $index = 0;
            $block['nodes'] = $this->nodes($block['body'], $index);
        }
        unset($block);
        $index = 0;
        $nodes = $this->nodes($layout, $index);

        $budget = 50000;
        $scopeId = 0;

        return $this->emit($nodes, $blocks, $rootTypes, $types, [], [[]], [], $budget, $scopeId);
    }

    private function nodes(array $tokens, int &$index, ?string $end = null, int $depth = 0): array
    {
        if ($depth > 20) {
            $this->fail($tokens[$index] ?? ['file' => 'template', 'line' => 1], 'Markup directives may nest at most 20 levels deep.');
        }
        $nodes = [];
        for (; $index < count($tokens); $index++) {
            $token = $tokens[$index];
            $kind = $token['kind'];
            if ($end !== null && $kind === $end && $token['args'] === '') {
                return $nodes;
            }
            if ($kind === 'each') {
                if (! preg_match('/^([A-Za-z][A-Za-z0-9_]*)\s+in\s+([A-Za-z][A-Za-z0-9_.]*)\s*:?$/', $token['args'], $match)) {
                    $this->fail($token, 'Use @each item in items: … @endeach.');
                }
                $index++;
                $nodes[] = ['kind' => 'each', 'alias' => $match[1], 'path' => $match[2], 'children' => $this->nodes($tokens, $index, 'endeach', $depth + 1), 'source' => $token];
            } elseif ($kind === 'if') {
                $path = trim($token['args']);
                if (! preg_match('/^[A-Za-z][A-Za-z0-9_.]*$/', $path)) {
                    $this->fail($token, '@if expects a parameter path.');
                }
                $index++;
                $nodes[] = ['kind' => 'if', 'path' => $path, 'children' => $this->nodes($tokens, $index, 'endif', $depth + 1), 'source' => $token];
            } elseif ($kind === 'render') {
                if (! preg_match('/^([A-Za-z][A-Za-z0-9_]*)\s*\((.*)\)$/', $token['args'], $match)) {
                    $this->fail($token, 'Use @render blockName(argument, otherArgument).');
                }
                $nodes[] = ['kind' => 'render', 'name' => $match[1], 'arguments' => trim($match[2]) === '' ? [] : array_map('trim', explode(',', $match[2])), 'source' => $token];
            } elseif ($kind === 'text' || in_array($kind, ['media', 'supports', 'font-face', 'keyframes', 'import', 'layer', 'container', 'charset', 'page', 'property', 'starting-style', 'namespace', 'scope', 'counter-style'], true)) {
                $nodes[] = ['kind' => 'text', 'text' => $token['text'], 'source' => $token];
            } else {
                $this->fail($token, "Unknown or unexpected markup directive @{$kind}.");
            }
        }
        if ($end !== null) {
            $this->fail(end($tokens) ?: ['file' => 'template', 'line' => 1], "Missing @{$end}.");
        }

        return $nodes;
    }

    private function emit(array $nodes, array $blocks, array $roots, array $types, array $bindings, array $contexts, array $calls, int &$budget, int &$scopeId): string
    {
        $html = '';
        foreach ($nodes as $node) {
            $token = $node['source'];
            if (--$budget < 0) {
                $this->fail($token, 'Block expansion exceeds the operation limit.');
            }
            if ($node['kind'] === 'text') {
                $html .= preg_replace_callback('/\{\{\s*([^{}]+?)\s*\}\}/', function (array $match) use ($token, $bindings, $roots, $types, $contexts): string {
                    $expression = trim($match[1]);
                    $formatted = str_starts_with($expression, '&');
                    $binding = $this->resolve(trim($formatted ? substr($expression, 1) : $expression), $bindings, $roots, $types, $token);
                    if (str_ends_with($binding['type'], '[]') || isset($types[$binding['type']])) {
                        $this->fail($token, 'Interpolate an individual field, not an object or list.');
                    }

                    return '{{'.($formatted ? '&' : '').$this->reference($binding['path'], $contexts).'}}';
                }, $node['text']);
            } elseif ($node['kind'] === 'render') {
                $name = $node['name'];
                $block = $blocks[$name] ?? null;
                if ($block === null || in_array($name, $calls, true) || count($calls) >= 20) {
                    $this->fail($token, "Unknown or recursive block {$name}.");
                }
                if (count($node['arguments']) !== count($block['arguments'])) {
                    $this->fail($token, "Block {$name} expects ".count($block['arguments']).' arguments.');
                }
                $local = [];
                foreach (array_keys($block['arguments']) as $i => $argument) {
                    $value = $this->resolve($node['arguments'][$i], $bindings, $roots, $types, $token);
                    if ($value['type'] !== $block['arguments'][$argument]) {
                        $this->fail($token, "Argument {$argument} requires {$block['arguments'][$argument]}, received {$value['type']}.");
                    }
                    $local[$argument] = $value;
                }
                $html .= $this->emit($block['nodes'], $blocks, $roots, $types, $local, $contexts, [...$calls, $name], $budget, $scopeId);
            } else {
                $value = $this->resolve($node['path'], $bindings, $roots, $types, $token);
                $reference = $this->reference($value['path'], $contexts);
                $nestedBindings = $bindings;
                $nestedContexts = $contexts;
                if ($node['kind'] === 'each') {
                    if (! str_ends_with($value['type'], '[]')) {
                        $this->fail($token, '@each expects an array of an author-defined type.');
                    }
                    $item = ['path' => [...$value['path'], '*'.++$scopeId], 'type' => substr($value['type'], 0, -2)];
                    $nestedBindings[$node['alias']] = $item;
                    $nestedContexts[] = $item['path'];
                } elseif (str_ends_with($value['type'], '[]')) {
                    $this->fail($token, 'Use @each for lists.');
                } elseif (isset($types[$value['type']])) {
                    $nestedContexts[] = $value['path'];
                }
                $html .= '{{#'.$reference.'}}'.$this->emit($node['children'], $blocks, $roots, $types, $nestedBindings, $nestedContexts, $calls, $budget, $scopeId).'{{/'.$reference.'}}';
            }
            if (strlen($html) > $this->maxDefinitionBytes) {
                $this->fail($token, 'Expanded blocks exceed the 2 MB template limit.');
            }
        }

        return $html;
    }

    private function resolve(string $expression, array $bindings, array $roots, array $types, array $token): array
    {
        if (! preg_match('/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/', $expression)) {
            $this->fail($token, "Invalid parameter expression {$expression}.");
        }
        $segments = explode('.', $expression);
        $name = array_shift($segments);
        $value = $bindings[$name] ?? (isset($roots[$name]) ? ['path' => [$name], 'type' => $roots[$name]] : null);
        if ($value === null) {
            $this->fail($token, "Unknown parameter {$name}.");
        }
        foreach ($segments as $segment) {
            $field = collect($types[$value['type']] ?? [])->firstWhere('name', $segment);
            if ($field === null) {
                $this->fail($token, "Unknown field {$expression}.");
            }
            $value = ['path' => [...$value['path'], $segment], 'type' => $field['author_type']];
        }

        return $value;
    }

    private function reference(array $path, array $contexts): string
    {
        for ($index = count($contexts) - 1; $index >= 0; $index--) {
            $context = $contexts[$index];
            if (array_slice($path, 0, count($context)) === $context) {
                $remaining = array_slice($path, count($context));
                if (! array_filter($remaining, fn (string $part): bool => str_starts_with($part, '*'))) {
                    return str_repeat('../', count($contexts) - $index - 1).implode('.', $remaining);
                }
            }
        }

        throw ValidationException::withMessages(['template' => 'A block refers to a loop item outside its scope.']);
    }

    private function fail(array $token, string $message): never
    {
        throw ValidationException::withMessages(['template' => "{$token['file']}:{$token['line']}: {$message}"]);
    }
}
