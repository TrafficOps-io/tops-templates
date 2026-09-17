<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;
use JsonException;

/** DSL v1 declarations -> a form schema and a markup AST, without executing source code. */
final class TemplateSourceParser
{
    private const MAX_DEFINITION_BYTES = 2097152;

    private const MAX_SOURCE_FILES = 100;

    private const MAX_TOKENS = 20000;

    private TemplateDialect $dialect;

    private int $maxDefinitionBytes;

    public function __construct(
        private TemplateFieldTypes $types,
        private TemplateMarkupCompiler $compiler,
        ?TemplateDialect $dialect = null,
        int $maxDefinitionBytes = 2097152,
    ) {
        $this->dialect = $dialect ?? new SafeTemplateDialect;
        $this->maxDefinitionBytes = max(1, min(self::MAX_DEFINITION_BYTES, $maxDefinitionBytes));
    }

    public function parse(string $source, ?callable $include = null, string $filename = 'template'): array
    {
        return $this->parsePages([$filename => $source], $filename, $include);
    }

    /** Discover fragments before choosing which HTML source files are pages. */
    public function includedPaths(array $sources, callable $include): array
    {
        if ($sources === [] || count($sources) > self::MAX_SOURCE_FILES) {
            $this->fail(['file' => 'template', 'line' => 1], 'Provide 1 to 100 source files.');
        }

        $paths = [];
        $sourceBytes = 0;
        $preparedBytes = 0;
        $tokenBudget = self::MAX_TOKENS;
        $opaque = [];
        foreach ($sources as $filename => $source) {
            if (! is_string($filename) || ! is_string($source)) {
                $this->fail(['file' => 'template', 'line' => 1], 'Source files must map safe names to text.');
            }
            TemplateSourceSafety::assertRelativePath($filename);
            $this->dialect->assertSourcePath($filename);
            $this->tokens($source, $filename, function (string $path) use ($include, &$paths) {
                $paths[$path] = true;

                return $include($path);
            }, [], $sourceBytes, $preparedBytes, $tokenBudget, $opaque);
        }

        return array_keys($paths);
    }

    /** All page layouts share one set of settings, types and reusable blocks. */
    public function parsePages(array $sources, string $filename, ?callable $include = null): array
    {
        if ($sources === [] || count($sources) > self::MAX_SOURCE_FILES || ! array_key_exists($filename, $sources)) {
            $this->fail(['file' => $filename, 'line' => 1], 'Provide 1 to 100 pages including the entry source.');
        }
        $sourceBytes = 0;
        $preparedBytes = 0;
        $tokenBudget = self::MAX_TOKENS;
        $opaque = [];
        $tokens = [];
        foreach ($sources as $page => $source) {
            if (! is_string($page) || ! is_string($source)) {
                $this->fail(['file' => $filename, 'line' => 1], 'Page sources must map safe names to text.');
            }
            TemplateSourceSafety::assertRelativePath($page);
            $this->dialect->assertSourcePath($page);
            $tokens[] = ['kind' => '_page', 'file' => $page, 'line' => 1, 'text' => '', 'args' => ''];
            $tokens = [...$tokens, ...$this->tokens($source, $page, $include, [], $sourceBytes, $preparedBytes, $tokenBudget, $opaque)];
        }
        $sourceTokens = $tokens;
        $extraction = $this->dialect->extractDirectives($tokens, $filename);
        $this->assertDirectiveExtraction($extraction, $sourceTokens, $filename);
        $tokens = $extraction->tokens;
        $definition = ['version' => 1, 'name' => 'Imported template', 'sections' => []];
        $types = [];
        $blocks = [];
        $layouts = [];
        $page = $filename;
        $section = null;
        $header = false;

        for ($i = 0; $i < count($tokens); $i++) {
            $token = $tokens[$i];
            switch ($token['kind']) {
                case '_page':
                    if ($section !== null || ($i > 0 && ! isset($layouts[$page]))) {
                        $this->fail($token, 'Each page requires a layout and closed sections.');
                    }
                    $page = $token['file'];
                    break;
                case 'template':
                    if ($header) {
                        $this->fail($token, 'Only one @template declaration is allowed.');
                    }
                    $args = $this->arguments($token['args'], $token);
                    $definition['name'] = array_shift($args) ?? '';
                    $options = $this->options($args, $token);
                    if (array_diff(array_keys($options), ['version', 'description', 'previewData', 'previewUrl'])) {
                        $this->fail($token, '@template accepts version, description, previewData and previewUrl.');
                    }
                    if (array_key_exists('previewData', $options)) {
                        if (array_key_exists('previewData', $definition)) {
                            $this->fail($token, 'Only one previewData declaration is allowed.');
                        }
                        $options['previewData'] = $this->previewData($options['previewData'], $token);
                    }
                    $definition = [...$definition, ...$options];
                    $header = true;
                    break;
                case 'previewData':
                    if ($section !== null || trim($token['args']) !== '' || array_key_exists('previewData', $definition)) {
                        $this->fail($token, 'Use one top-level @previewData … @endpreviewData block without arguments.');
                    }
                    $definition['previewData'] = $this->previewData(implode('', array_column($this->body($tokens, $i, 'endpreviewData'), 'text')), $token);
                    break;
                case 'section':
                    if ($section !== null) {
                        $this->fail($token, 'Close the current section with @endsection.');
                    }
                    $args = $this->arguments($token['args'], $token);
                    if (count($args) < 1 || count($args) > 2 || ! preg_match('/^[a-zA-Z][a-zA-Z0-9_]*$/', $args[0])) {
                        $this->fail($token, 'Use @section identifier "Label".');
                    }
                    $section = $args[0];
                    if (isset($definition['sections'][$section])) {
                        $this->fail($token, "Duplicate section {$section}.");
                    }
                    $definition['sections'][$section] = ['id' => $section, 'label' => $args[1] ?? $section, 'fields' => []];
                    break;
                case 'endsection':
                    if ($section === null || trim($token['args']) !== '') {
                        $this->fail($token, 'Unexpected @endsection.');
                    }
                    $section = null;
                    break;
                case 'param':
                    $key = $section ?? 'general';
                    $definition['sections'][$key] ??= ['id' => $key, 'label' => 'General', 'fields' => []];
                    $definition['sections'][$key]['fields'][] = $this->parameter($token);
                    break;
                case 'type':
                    $name = trim($token['args']);
                    if (! preg_match('/^[A-Z][A-Za-z0-9_]*$/', $name) || isset($types[$name]) || $this->types->has($name)) {
                        $this->fail($token, 'A type needs a unique name beginning with a capital letter.');
                    }
                    $fields = [];
                    foreach ($this->body($tokens, $i, 'endtype') as $field) {
                        if ($field['kind'] === 'text' && trim($field['text']) === '') {
                            continue;
                        }
                        if ($field['kind'] !== 'param') {
                            $this->fail($field, 'Only @param declarations are allowed inside @type.');
                        }
                        $fields[] = $this->parameter($field);
                    }
                    $types[$name] = $fields;
                    break;
                case 'block':
                    if (! preg_match('/^([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s+(.*))?$/', trim($token['args']), $match)) {
                        $this->fail($token, 'Use @block name(argument: Type), optionally followed by aiInstructions="instructions".');
                    }
                    if (isset($blocks[$match[1]])) {
                        $this->fail($token, "Duplicate block {$match[1]}.");
                    }
                    $arguments = [];
                    foreach (trim($match[2]) === '' ? [] : explode(',', $match[2]) as $argument) {
                        if (! preg_match('/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*([A-Za-z][A-Za-z0-9_]*(?:\[\])?)\s*$/', $argument, $parts) || isset($arguments[$parts[1]])) {
                            $this->fail($token, 'Block arguments require unique names and types.');
                        }
                        $arguments[$parts[1]] = $parts[2];
                    }
                    $options = $this->options($this->arguments($match[3] ?? '', $token), $token);
                    if (array_diff(array_keys($options), ['aiInstructions'])) {
                        $this->fail($token, 'Unknown @block option. Only aiInstructions is supported.');
                    }
                    if (array_key_exists('aiInstructions', $options)) {
                        $definition['blocks'][$match[1]] = $options;
                    }
                    $blocks[$match[1]] = ['arguments' => $arguments, 'body' => $this->body($tokens, $i, 'endblock'), 'source' => $token];
                    break;
                case 'layout':
                    if (isset($layouts[$page]) || trim($token['args']) !== '') {
                        $this->fail($token, 'Only one @layout is allowed per page.');
                    }
                    $layouts[$page] = $this->body($tokens, $i, 'endlayout');
                    break;
                case 'text':
                    if (trim($token['text']) !== '') {
                        $this->fail($token, 'Place HTML inside @layout or @block.');
                    }
                    break;
                default:
                    $this->fail($token, "Unknown or unexpected directive @{$token['kind']}.");
            }
        }
        if (! isset($layouts[$page]) || $section !== null || $definition['version'] !== 1) {
            $this->fail(['file' => $filename, 'line' => 1], 'DSL v1 requires @layout … @endlayout and closed sections.');
        }
        // Resolve after parsing so author-defined types may be declared in any order.
        foreach ($types as $name => $fields) {
            $this->resolveFields($fields, $types, [$name]);
        }
        foreach ($definition['sections'] as &$entry) {
            $entry['fields'] = $this->resolveFields($entry['fields'], $types);
        }
        unset($entry);
        $definition['sections'] = array_values($definition['sections']);
        $rootTypes = [];
        foreach ($definition['sections'] as $entry) {
            foreach ($entry['fields'] as $field) {
                $rootTypes[$field['name']] = $field['author_type'];
            }
        }
        $pageBytes = 0;
        foreach ($layouts as $page => $layout) {
            $html = $this->dialect->finishParsedPage(
                $page,
                $this->compiler->compile($layout, $blocks, $rootTypes, $types, $this->types),
                $extraction,
                $opaque,
            );
            $bytes = strlen($html);
            if ($bytes > self::MAX_DEFINITION_BYTES) {
                $this->fail(['file' => $page, 'line' => 1], 'A parsed page may not exceed 2 MB.');
            }
            $pageBytes += $bytes;
            if ($pageBytes > $this->maxDefinitionBytes) {
                $this->fail(['file' => $page, 'line' => 1], 'Parsed pages exceed the aggregate template definition limit.');
            }
            if (! mb_check_encoding($html, 'UTF-8') || str_contains($html, "\0")) {
                $this->fail(['file' => $page, 'line' => 1], 'Parsed pages must be UTF-8 text without null bytes.');
            }
            if ($page === $filename) {
                $definition['html'] = $html;
            } else {
                $definition['pages'][$page] = $html;
            }
        }

        return $definition;
    }

    private function previewData(string $json, array $token): array
    {
        try {
            $values = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            $this->fail($token, 'previewData must contain a valid JSON object.');
        }
        if (! is_array($values) || ! str_starts_with(ltrim($json), '{')) {
            $this->fail($token, 'previewData must contain a JSON object.');
        }

        return $values;
    }

    private function tokens(
        string $source,
        string $file,
        ?callable $include,
        array $stack,
        int &$sourceBytes,
        int &$preparedBytes,
        int &$tokenBudget,
        array &$opaque,
    ): array {
        $sourceBytes += strlen($source);
        if ($sourceBytes > $this->maxDefinitionBytes || count($stack) > 10 || in_array($file, $stack, true) || ! mb_check_encoding($source, 'UTF-8') || str_contains($source, "\0")) {
            $this->fail(['file' => $file, 'line' => 1], 'Template text must be UTF-8, under 2 MB, without recursive includes.');
        }
        $prepared = $this->dialect->prepareSource($source, $file, SourcePhase::Parser);
        $preparedBytes += strlen($prepared->text);
        if ($preparedBytes > $this->maxDefinitionBytes || ! mb_check_encoding($prepared->text, 'UTF-8') || str_contains($prepared->text, "\0")) {
            $this->fail(['file' => $file, 'line' => 1], 'Prepared template text exceeds the aggregate source limit or is not safe UTF-8 text.');
        }
        foreach ($prepared->opaque as $marker => $fragment) {
            if (! is_string($marker) || $marker === '' || ! is_string($fragment)) {
                $this->fail(['file' => $file, 'line' => 1], 'The template dialect produced invalid opaque source markers.');
            }
            if (isset($opaque[$marker]) && $opaque[$marker] !== $fragment) {
                $this->fail(['file' => $file, 'line' => 1], 'The template dialect produced conflicting opaque source markers.');
            }
            $opaque[$marker] = $fragment;
        }
        $source = $prepared->text;
        $tokens = [];
        // Bound the split itself; a 2 MB file can otherwise contain millions of empty lines.
        foreach (explode("\n", str_replace(["\r\n", "\r"], "\n", $source), $tokenBudget + 2) as $line => $text) {
            if (--$tokenBudget < 0) {
                $this->fail(['file' => $file, 'line' => $line + 1], 'Expanded template source exceeds the 20,000 line limit.');
            }
            $token = ['file' => $file, 'line' => $line + 1, 'text' => $text."\n", 'kind' => 'text', 'args' => ''];
            if (preg_match('/^\s*@([A-Za-z][A-Za-z0-9_-]*)\b(.*)$/', $text, $match)) {
                $token['kind'] = $match[1];
                $token['args'] = trim($match[2]);
            } elseif (preg_match('/^(\s*)@@/', $text)) {
                $token['text'] = preg_replace('/^(\s*)@@/', '$1@', $text)."\n";
                $token['text'] = preg_replace('/^(\s*)@(validation|endvalidation)\b/', '$1&#64;$2', $token['text']);
            }
            if ($token['kind'] === 'include') {
                $args = $this->arguments($token['args'], $token);
                if ($include === null || count($args) !== 1) {
                    $this->fail($token, '@include "path.tpl" requires a source resolver.');
                }
                TemplateSourceSafety::assertRelativePath($args[0]);
                $this->dialect->assertSourcePath($args[0]);
                $included = $include($args[0]);
                if (! is_string($included)) {
                    $this->fail($token, 'The source resolver must return template text.');
                }
                $tokens = [...$tokens, ...$this->tokens($included, $args[0], $include, [...$stack, $file], $sourceBytes, $preparedBytes, $tokenBudget, $opaque)];
            } else {
                $tokens[] = $token;
            }
        }

        return $tokens;
    }

    private function assertDirectiveExtraction(DirectiveExtraction $extraction, array $sourceTokens, string $filename): void
    {
        $tokens = $extraction->tokens;
        if (! array_is_list($tokens) || count($tokens) > self::MAX_TOKENS) {
            $this->fail(['file' => $filename, 'line' => 1], 'The template dialect must return a token list within the 20,000 token limit.');
        }

        $required = ['args', 'file', 'kind', 'line', 'text'];
        foreach ($tokens as $token) {
            if (! is_array($token) || array_diff(array_keys($token), $required) !== [] || array_diff($required, array_keys($token)) !== []
                || ! is_string($token['file']) || $token['file'] === '' || ! is_int($token['line']) || $token['line'] < 1
                || ! is_string($token['text']) || ! is_string($token['kind']) || ! preg_match('/^(?:_page|[A-Za-z][A-Za-z0-9_-]*)$/D', $token['kind'])
                || ! is_string($token['args'])) {
                $this->fail(['file' => $filename, 'line' => 1], 'The template dialect returned a malformed token.');
            }
            if ($token['kind'] === '_page' && ($token['line'] !== 1 || $token['text'] !== '' || $token['args'] !== '')) {
                $this->fail(['file' => $filename, 'line' => 1], 'The template dialect returned a malformed page boundary.');
            }
        }

        $pageTokens = static fn (array $stream): array => array_values(array_filter(
            $stream,
            static fn (array $token): bool => $token['kind'] === '_page',
        ));
        if ($pageTokens($tokens) !== $pageTokens($sourceTokens)) {
            $this->fail(['file' => $filename, 'line' => 1], 'The template dialect may not add, remove or reorder page boundaries.');
        }

        $sourceIndex = 0;
        foreach ($tokens as $token) {
            while ($sourceIndex < count($sourceTokens) && $sourceTokens[$sourceIndex] !== $token) {
                $sourceIndex++;
            }
            if ($sourceIndex === count($sourceTokens)) {
                $this->fail(['file' => $filename, 'line' => 1], 'The template dialect may only remove tokens without injecting, mutating or reordering them.');
            }
            $sourceIndex++;
        }
    }

    private function body(array $tokens, int &$index, string $end): array
    {
        $start = $tokens[$index];
        $body = [];
        while (++$index < count($tokens)) {
            if ($tokens[$index]['kind'] === $end && $tokens[$index]['args'] === '') {
                return $body;
            }
            $body[] = $tokens[$index];
        }
        $this->fail($start, "Missing @{$end}.");
    }

    private function parameter(array $token): array
    {
        $args = $this->arguments($token['args'], $token);
        $name = array_shift($args) ?? '';
        $type = array_shift($args) ?? '';
        if (! preg_match('/^[A-Za-z][A-Za-z0-9_]*$/', $name) || ! preg_match('/^[A-Z][A-Za-z0-9_]*(?:\[\])?$/', $type)) {
            $this->fail($token, 'Use @param name Type, optionally followed by = "default" and key=value options.');
        }
        $options = $this->options($args, $token);
        if (array_diff(array_keys($options), ['label', 'help', 'aiInstructions', 'required', 'default', 'options', 'min', 'max', 'step', 'min_items', 'max_items', 'aspect_ratio', 'sizes'])) {
            $this->fail($token, 'Unknown @param option.');
        }
        if (array_key_exists('sizes', $options)) {
            if (! is_string($options['sizes'])) {
                $this->fail($token, 'Image sizes use "1200x630|1080x1080".');
            }
            $sizes = [];
            foreach (explode('|', $options['sizes']) as $size) {
                if (! preg_match('/^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/D', trim($size), $match)) {
                    $this->fail($token, 'Image sizes use "1200x630|1080x1080".');
                }
                $sizes[] = ['width' => (int) $match[1], 'height' => (int) $match[2]];
            }
            $options['sizes'] = $sizes;
        }
        if (isset($options['options'])) {
            if (! is_string($options['options'])) {
                $this->fail($token, 'Select options use "value:Label|other:Other label".');
            }
            $choices = [];
            foreach (explode('|', $options['options']) as $choice) {
                [$value, $label] = array_pad(explode(':', $choice, 2), 2, null);
                if (array_key_exists($value, $choices)) {
                    $this->fail($token, 'Select option values must be unique.');
                }
                $choices[$value] = $label ?? $value;
            }
            $options['options'] = $choices;
        }

        return ['name' => $name, ...$options, 'author_type' => $type, '_source' => $token];
    }

    private function resolveFields(array $fields, array $types, array $stack = [], int &$count = 0): array
    {
        if (count($stack) > 6) {
            $this->fail(['file' => 'template', 'line' => 1], 'Types may nest at most six levels deep.');
        }
        foreach ($fields as &$field) {
            if (++$count > 200) {
                $this->fail($field['_source'], 'Expanded types may contain at most 200 fields.');
            }
            $type = $field['author_type'];
            $list = str_ends_with($type, '[]');
            $type = $list ? substr($type, 0, -2) : $type;
            $source = $field['_source'];
            unset($field['_source']);
            if ($this->types->has($type) && ! $list) {
                $field['label'] ??= $field['name'];
                $field = $this->types->field($type, $field);
            } elseif (isset($types[$type]) && ! in_array($type, $stack, true)) {
                $field['type'] = $list ? 'repeater' : 'group';
                $field['label'] ??= $list ? $field['name'] : '';
                $field['fields'] = $this->resolveFields($types[$type], $types, [...$stack, $type], $count);
            } else {
                $this->fail($source, "Unknown, recursive or unsupported type {$field['author_type']}. Declare object types using @type.");
            }
        }

        return $fields;
    }

    private function arguments(string $text, array $token): array
    {
        $args = [];
        $offset = 0;
        while ($offset < strlen($text)) {
            if (! preg_match('/\G\s*("(?:[^"\\\\]|\\\\.)*"|\x27(?:[^\x27\\\\]|\\\\.)*\x27|=|[^\s=\x27"]+)/', $text, $match, 0, $offset)) {
                if (trim(substr($text, $offset)) === '') {
                    break;
                }
                $this->fail($token, 'Invalid or unclosed quoted argument.');
            }
            $value = $match[1];
            $args[] = str_starts_with($value, '"') || str_starts_with($value, "'") ? stripcslashes(substr($value, 1, -1)) : $value;
            $offset += strlen($match[0]);
        }

        return $args;
    }

    private function options(array $args, array $token): array
    {
        $options = [];
        while ($args !== []) {
            $key = array_shift($args);
            if ($key === '=') {
                $key = 'default';
            } elseif (($args[0] ?? null) === '=') {
                array_shift($args);
            } elseif ($key === 'required') {
                $options['required'] = true;

                continue;
            } else {
                $this->fail($token, 'Options use key=value.');
            }
            if ($args === [] || isset($options[$key])) {
                $this->fail($token, 'Missing or duplicate option value.');
            }
            $value = array_shift($args);
            $options[$key] = match (true) {
                in_array($key, ['min', 'max', 'step', 'min_items', 'max_items', 'version'], true) && is_numeric($value) => $value + 0,
                $key === 'required' => match ($value) {
                    'true' => true, 'false' => false, default => $value
                },
                default => $value,
            };
        }

        return $options;
    }

    private function fail(array $token, string $message): never
    {
        throw ValidationException::withMessages(['template' => "{$token['file']}:{$token['line']}: {$message}"]);
    }
}
