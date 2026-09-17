<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Closure;
use Illuminate\Validation\ValidationException;
use JsonException;

/** A deliberately small, non-executable template language. */
final class TemplateEngine
{
    private const TYPES = ['text', 'textarea', 'wysiwyg', 'markdown', 'select', 'color', 'number', 'range', 'checkbox', 'image', 'url', 'email', 'group', 'repeater'];

    private const MAX_VALUES = 10000;

    private TemplateDialect $dialect;

    private int|Closure $maxRenderBytes;

    public function __construct(
        private TemplateRichText $richText,
        int|Closure $maxRenderBytes = 8388608,
        ?TemplateDialect $dialect = null,
    ) {
        $this->maxRenderBytes = $maxRenderBytes;
        $this->dialect = $dialect ?? new SafeTemplateDialect;
    }

    public function previewRichText(array $field, mixed $value, string $path): string
    {
        if (! in_array($field['type'], TemplateRichText::TYPES, true)) {
            $this->valueError($path, 'This setting is not a rich text field.');
        }
        $budget = self::MAX_VALUES;
        $value = $this->normalizeField($field, $value, $path, false, $budget);

        return $this->richText->render($field['type'], $value);
    }

    public function parse(string $json): array
    {
        if (strlen($json) > 8 * 1024 * 1024) {
            $this->invalid('The template definition exceeds 8 MB.');
        }

        try {
            $definition = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            $this->invalid('The template must contain valid JSON.');
        }

        if (! is_array($definition) || array_is_list($definition)) {
            $this->invalid('The template definition must be a JSON object.');
        }

        return $this->validateDefinition($definition);
    }

    public function validateDefinition(array $definition): array
    {
        if (($definition['version'] ?? null) !== 1) {
            $this->invalid('The template version must be 1.');
        }

        $name = $this->schemaString($definition['name'] ?? null, 'name', 200);
        $description = $this->schemaString($definition['description'] ?? '', 'description', 2000, true);
        $html = $this->schemaString($definition['html'] ?? null, 'html', 2 * 1024 * 1024);
        $entrypoint = $definition['entrypoint'] ?? 'index.html';
        if (! is_string($entrypoint)) {
            $this->invalid('The template entrypoint must be a path.');
        }
        TemplateSourceSafety::assertRelativePath($entrypoint);
        $this->dialect->assertEntrypoint($entrypoint);
        $pages = $definition['pages'] ?? [];
        if (! is_array($pages) || ($pages !== [] && array_is_list($pages)) || count($pages) > 100) {
            $this->invalid('pages must contain at most 100 output paths.');
        }
        $pageNames = [strtolower($entrypoint)];
        foreach ($pages as $path => $source) {
            if (! is_string($path) || ! TemplateSourceSafety::isRelativePath($path)
                || str_contains($path, '\\')
                || preg_match('~^_(?:uploads|media)/~i', $path) || in_array(strtolower($path), $pageNames, true)) {
                $this->invalid('Template page paths must be unique, safe output paths.');
            }
            $this->dialect->assertPagePath($path);
            $pages[$path] = $this->schemaString($source, "pages.{$path}", 2 * 1024 * 1024);
            $pageNames[] = strtolower($path);
        }
        $sourceFile = isset($definition['source']) ? $this->schemaString($definition['source'], 'source', 255) : null;
        if ($sourceFile !== null) {
            TemplateSourceSafety::assertRelativePath($sourceFile);
            $this->dialect->assertSourcePath($sourceFile);
        }
        $sections = $definition['sections'] ?? null;
        if (! is_array($sections) || ! array_is_list($sections) || count($sections) > 50) {
            $this->invalid('sections must be a list containing at most 50 sections.');
        }

        $count = 0;
        $sectionIds = [];
        $rootNames = [];
        foreach ($sections as $index => &$section) {
            if (! is_array($section)) {
                $this->invalid("sections.{$index} must be an object.");
            }
            $id = $this->identifier($section['id'] ?? null, "sections.{$index}.id");
            if (isset($sectionIds[$id])) {
                $this->invalid("Duplicate section id: {$id}.");
            }
            $sectionIds[$id] = true;
            $section = [
                'id' => $id,
                'label' => $this->schemaString($section['label'] ?? null, "sections.{$index}.label", 200),
                'fields' => $this->validateFields($section['fields'] ?? null, "sections.{$index}.fields", 1, $count),
            ];
            foreach ($section['fields'] as $field) {
                if (isset($rootNames[$field['name']])) {
                    $this->invalid("Root field names must be unique across sections: {$field['name']}.");
                }
                $rootNames[$field['name']] = true;
            }
        }
        unset($section);

        $partials = $definition['partials'] ?? [];
        if (! is_array($partials) || ($partials !== [] && array_is_list($partials)) || count($partials) > 50) {
            $this->invalid('partials must be an object containing at most 50 named fragments.');
        }
        $sourceBytes = strlen($html) + array_sum(array_map('strlen', $pages));
        foreach ($partials as $key => $partial) {
            $this->identifier($key, 'partial name');
            $partials[$key] = $this->schemaString($partial, "partials.{$key}", 2 * 1024 * 1024, true);
            $this->dialect->validateSource($partials[$key], "partials.{$key}");
            $sourceBytes += strlen($partial);
        }
        if ($sourceBytes > 4 * 1024 * 1024) {
            $this->invalid('The combined pages and partials exceed 4 MB.');
        }

        // Typed blocks are expanded into HTML; keep their authoring metadata separately.
        $blocks = $definition['blocks'] ?? [];
        if (array_key_exists('blocks', $definition)) {
            if (! is_array($definition['blocks']) || ($blocks !== [] && array_is_list($blocks)) || count($blocks) > 200) {
                $this->invalid('blocks must be an object containing at most 200 named block annotations.');
            }
            foreach ($blocks as $key => &$block) {
                $this->identifier($key, 'block name');
                if (! is_array($block)) {
                    $this->invalid("blocks.{$key} must be an object.");
                }
                $block = ['aiInstructions' => $this->schemaString($block['aiInstructions'] ?? null, "blocks.{$key}.aiInstructions", 10000, true)];
            }
            unset($block);
        }

        $preview = [];
        if (array_key_exists('previewUrl', $definition)) {
            $preview['previewUrl'] = $this->previewUrl($definition['previewUrl']);
        }
        if (array_key_exists('previewData', $definition)) {
            $values = $definition['previewData'];
            if (! is_array($values) || ($values !== [] && array_is_list($values))) {
                $this->invalid('previewData must be an object containing template settings.');
            }
            $budget = self::MAX_VALUES;
            try {
                // Validate directly: validateValues() would re-validate this definition recursively.
                $preview['previewData'] = $this->normalizeValues($this->rootFields(['sections' => $sections]), $values, 'previewData', true, $budget);
            } catch (ValidationException $exception) {
                $messages = [];
                foreach ($exception->errors() as $path => $errors) {
                    foreach ($errors as $error) {
                        $messages[] = "{$path}: {$error}";
                    }
                }
                $this->invalid(implode(' ', $messages));
            }
        }

        $definition = [...compact('name', 'description', 'sections', 'html', 'partials'), ...$preview];
        if ($entrypoint !== 'index.html' || $pages !== [] || $sourceFile !== null) {
            $definition += ['entrypoint' => $entrypoint, 'pages' => $pages];
        }
        if ($sourceFile !== null) {
            $definition['source'] = $sourceFile;
        }
        if ($blocks !== []) {
            $definition['blocks'] = $blocks;
        }
        $definition['version'] = 1;
        $defaultBudget = self::MAX_VALUES;
        $this->defaultValues($this->rootFields($definition), $defaultBudget);
        $this->dialect->validateSource($html, $entrypoint);
        $this->compile($definition);
        foreach ($pages as $path => $page) {
            $this->dialect->validateSource($page, $path);
            $this->compile([...$definition, 'html' => $page, 'pages' => []]);
        }

        return $definition;
    }

    private function previewUrl(mixed $value): string
    {
        $url = $this->schemaString($value, 'previewUrl', 2048);
        $parts = parse_url($url);
        if (! filter_var($url, FILTER_VALIDATE_URL) || ! is_array($parts)
            || ! in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass'])
            || (isset($parts['port']) && ! in_array($parts['port'], [80, 443], true))
            || preg_match('/[\x00-\x20\x7F\\\\]/', $url)) {
            $this->invalid('previewUrl must be an absolute public HTTP(S) URL without credentials, on port 80 or 443.');
        }
        $host = strtolower(rtrim(trim($parts['host'] ?? '', '[]'), '.'));
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $public = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE) !== false;
        } else {
            $public = str_contains($host, '.')
                && ! preg_match('/(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan)$/D', $host)
                // Browser URL parsers accept abbreviated, integer, octal and hexadecimal IPv4.
                && ! preg_match('/(?:^|\.)(?:[0-9]+|0x[0-9a-f]+)$/D', $host);
        }
        if (! $public) {
            $this->invalid('previewUrl must use a public hostname or public IP address.');
        }

        return $url;
    }

    public function defaults(array $definition): array
    {
        return $this->defaultsForFields($this->rootFields($definition));
    }

    /** Also used when the form adds a new repeater item. */
    public function defaultsForFields(array $fields): array
    {
        $budget = self::MAX_VALUES;

        return $this->defaultValues($fields, $budget);
    }

    public function fieldAtPath(array $definition, string $path): ?array
    {
        $parts = explode('.', $path);
        $fields = $this->rootFields($definition);
        $field = null;
        while ($parts !== []) {
            $name = array_shift($parts);
            $field = $this->namedField($fields, $name);
            if ($field === null) {
                return null;
            }
            if ($field['type'] === 'repeater' && $parts !== [] && ctype_digit($parts[0])) {
                array_shift($parts);
            }
            $fields = $field['fields'] ?? [];
        }

        return $field;
    }

    public function validateValues(array $definition, array $values): array
    {
        $definition = $this->validateDefinition($definition);
        $budget = self::MAX_VALUES;

        return $this->normalizeValues($this->rootFields($definition), $values, 'values', true, $budget);
    }

    /** Context is explicitly supplied application data, never a request or service container. */
    public function render(array $definition, array $values, array $context = []): string
    {
        $definition = $this->validateDefinition($definition);
        $runtime = $this->dialect->runtime();
        $context = $runtime->validateContext($context);
        $budget = self::MAX_VALUES;
        $values = $this->normalizeValues($this->rootFields($definition), $values, 'values', true, $budget);
        [$nodes, $partials, $mainSource, $partialSources] = $this->compile($definition);
        $output = '';
        $operations = 200000;
        $maxBytes = $this->renderByteLimit();
        $usedPartials = [];
        $placements = [];
        $this->renderNodes($nodes, [$values], [$this->rootFields($definition)], $partials, $output, $operations, $maxBytes, 0, $usedPartials, $runtime, $context, $placements);

        $runtime->assertRenderedPositions($output, $placements);
        $output = $this->dialect->finishRendered($output, $mainSource, $partialSources, $usedPartials);
        if (strlen($output) > $maxBytes) {
            $this->invalid('The generated HTML exceeds the configured size limit.');
        }
        if (! mb_check_encoding($output, 'UTF-8') || str_contains($output, "\0")) {
            $this->invalid('The generated output must be UTF-8 text without null bytes.');
        }

        return $output;
    }

    /** Render every dialect-approved page with the same validated settings and context. */
    public function renderPages(array $definition, array $values, array $context = []): array
    {
        $definition = $this->validateDefinition($definition);
        $pages = [$definition['entrypoint'] ?? 'index.html' => $this->render($definition, $values, $context)];
        $bytes = strlen(reset($pages));
        foreach ($definition['pages'] ?? [] as $path => $source) {
            $pages[$path] = $this->render([...$definition, 'html' => $source, 'pages' => []], $values, $context);
            $bytes += strlen($pages[$path]);
            if ($bytes > $this->renderByteLimit()) {
                $this->invalid('Combined rendered pages exceed the configured size limit.');
            }
        }

        return $pages;
    }

    private function renderByteLimit(): int
    {
        $limit = $this->maxRenderBytes instanceof Closure
            ? ($this->maxRenderBytes)()
            : $this->maxRenderBytes;

        return max(1, min(8388608, (int) $limit));
    }

    private function validateFields(mixed $fields, string $path, int $depth, int &$count): array
    {
        if ($depth > 6 || ! is_array($fields) || ! array_is_list($fields)) {
            $this->invalid("{$path} must be a field list nested at most 6 levels deep.");
        }
        $names = [];
        foreach ($fields as $index => &$field) {
            if (++$count > 200 || ! is_array($field)) {
                $this->invalid('A template may contain at most 200 field definitions, each an object.');
            }
            $fieldPath = "{$path}.{$index}";
            $name = $this->identifier($field['name'] ?? null, "{$fieldPath}.name");
            if (isset($names[$name])) {
                $this->invalid("Duplicate field name {$name} in {$path}.");
            }
            $names[$name] = true;
            $type = $field['type'] ?? null;
            if (! in_array($type, self::TYPES, true)) {
                $this->invalid("{$fieldPath}.type is unsupported.");
            }
            if (array_key_exists('author_type', $field)
                && (! is_string($field['author_type']) || ! preg_match('/^[A-Z][A-Za-z0-9_]*(?:\[\])?$/D', $field['author_type']))) {
                $this->invalid("{$fieldPath}.author_type must name an author type beginning with a capital letter.");
            }
            foreach ([
                'fields' => ['group', 'repeater'],
                'options' => ['select'],
                'min' => ['number', 'range'],
                'max' => ['number', 'range'],
                'step' => ['number', 'range'],
                'min_items' => ['repeater'],
                'max_items' => ['repeater'],
                'aspect_ratio' => ['image'],
                'sizes' => ['image'],
            ] as $option => $supportedTypes) {
                if (array_key_exists($option, $field) && ! in_array($type, $supportedTypes, true)) {
                    $this->invalid("{$fieldPath}.{$option} is unsupported for {$type} fields.");
                }
            }
            $field['label'] = $this->schemaString($field['label'] ?? ($type === 'group' ? '' : null), "{$fieldPath}.label", 200, $type === 'group');
            $field['help'] = $this->schemaString($field['help'] ?? '', "{$fieldPath}.help", 2000, true);
            if (array_key_exists('aiInstructions', $field)) {
                $field['aiInstructions'] = $this->schemaString($field['aiInstructions'], "{$fieldPath}.aiInstructions", 10000, true);
            }
            if (isset($field['required']) && ! is_bool($field['required'])) {
                $this->invalid("{$fieldPath}.required must be a boolean.");
            }
            $field['required'] = $field['required'] ?? false;
            if (in_array($type, ['group', 'repeater'], true)) {
                $field['fields'] = $this->validateFields($field['fields'] ?? null, "{$fieldPath}.fields", $depth + 1, $count);
            }
            if ($type === 'repeater') {
                $field['min_items'] = $field['min_items'] ?? 0;
                $field['max_items'] = $field['max_items'] ?? 50;
                if (! is_int($field['min_items']) || ! is_int($field['max_items'])
                    || $field['min_items'] < 0 || $field['max_items'] > 50
                    || $field['max_items'] < $field['min_items']) {
                    $this->invalid("{$fieldPath} requires 0 <= min_items <= max_items <= 50.");
                }
            }
            if ($type === 'select') {
                $options = $field['options'] ?? null;
                if (! is_array($options) || $options === [] || count($options) > 100) {
                    $this->invalid("{$fieldPath}.options must contain between 1 and 100 value-to-label entries.");
                }
                foreach ($options as $option => $label) {
                    $this->schemaString((string) $option, "{$fieldPath}.options key", 200, true);
                    $this->schemaString($label, "{$fieldPath}.options label", 200);
                }
            }
            if (in_array($type, ['number', 'range'], true)) {
                foreach (['min', 'max', 'step'] as $bound) {
                    if (array_key_exists($bound, $field)
                        && ((! is_int($field[$bound]) && ! is_float($field[$bound])) || ! is_finite((float) $field[$bound]))) {
                        $this->invalid("{$fieldPath}.{$bound} must be a finite number.");
                    }
                }
                if (isset($field['min'], $field['max']) && $field['min'] > $field['max']) {
                    $this->invalid("{$fieldPath}.min cannot exceed max.");
                }
                if (isset($field['step']) && $field['step'] <= 0) {
                    $this->invalid("{$fieldPath}.step must be greater than zero.");
                }
            }
            $field = TemplateImageOptions::normalize($field, $fieldPath);
            if (array_key_exists('default', $field)) {
                try {
                    $budget = self::MAX_VALUES;
                    $field['default'] = $this->normalizeField($field, $field['default'], "{$fieldPath}.default", false, $budget);
                } catch (ValidationException $exception) {
                    $this->invalid('Invalid default: '.implode(' ', array_merge(...array_values($exception->errors()))));
                }
            }
        }
        unset($field);

        return $fields;
    }

    private function defaultValues(array $fields, int &$budget): array
    {
        $values = [];
        foreach ($fields as $field) {
            if (--$budget < 0) {
                $this->invalid('The template defaults exceed the maximum number of settings.');
            }
            $values[$field['name']] = $this->defaultValue($field, $budget);
        }

        return $values;
    }

    private function defaultValue(array $field, int &$budget): mixed
    {
        if (array_key_exists('default', $field)) {
            if (is_array($field['default'])) {
                $this->countDefaultValues($field['default'], $budget);
            }

            return $field['default'];
        }

        return match ($field['type']) {
            'checkbox' => false,
            'number', 'range' => $field['min'] ?? min(0, $field['max'] ?? 0),
            'color' => '#000000',
            'select' => (string) array_key_first($field['options']),
            'group' => $this->defaultValues($field['fields'], $budget),
            'repeater' => $this->defaultItems($field, $budget),
            default => '',
        };
    }

    private function countDefaultValues(array $values, int &$budget): void
    {
        foreach ($values as $value) {
            if (--$budget < 0) {
                $this->invalid('The template defaults exceed the maximum number of settings.');
            }
            if (is_array($value)) {
                $this->countDefaultValues($value, $budget);
            }
        }
    }

    private function defaultItems(array $field, int &$budget): array
    {
        $items = [];
        for ($index = 0; $index < ($field['min_items'] ?? 0); $index++) {
            if (--$budget < 0) {
                $this->invalid('The template defaults exceed the maximum number of settings.');
            }
            $items[] = $this->defaultValues($field['fields'], $budget);
        }

        return $items;
    }

    private function normalizeValues(array $fields, array $values, string $path, bool $required, int &$budget): array
    {
        $known = array_column($fields, 'name');
        foreach ($values as $key => $_) {
            if (! in_array($key, $known, true)) {
                $this->valueError("{$path}.{$key}", 'This setting is not defined in the template.');
            }
        }
        $normalized = [];
        foreach ($fields as $field) {
            if (--$budget < 0) {
                $this->valueError($path, 'The maximum number of settings was exceeded.');
            }
            $name = $field['name'];
            $value = array_key_exists($name, $values) ? $values[$name] : $this->defaultValue($field, $budget);
            $normalized[$name] = $this->normalizeField($field, $value, "{$path}.{$name}", $required, $budget);
        }

        return $normalized;
    }

    private function normalizeField(array $field, mixed $value, string $path, bool $required, int &$budget): mixed
    {
        $type = $field['type'];
        if ($type === 'group') {
            if (! is_array($value) || ($value !== [] && array_is_list($value))) {
                $this->valueError($path, 'Block settings must be an object.');
            }

            return $this->normalizeValues($field['fields'], $value, $path, $required, $budget);
        }
        if ($type === 'repeater') {
            if (! is_array($value) || ! array_is_list($value)
                || count($value) < $field['min_items'] || count($value) > $field['max_items']) {
                $this->valueError($path, "Provide between {$field['min_items']} and {$field['max_items']} items.");
            }
            if ($required && $field['required'] && $value === []) {
                $this->valueError($path, 'At least one item is required.');
            }
            foreach ($value as $index => &$item) {
                if (--$budget < 0 || ! is_array($item) || ($item !== [] && array_is_list($item))) {
                    $this->valueError("{$path}.{$index}", 'Each item must be an object within the settings limit.');
                }
                $item = $this->normalizeValues($field['fields'], $item, "{$path}.{$index}", $required, $budget);
            }
            unset($item);

            return $value;
        }
        if ($type === 'checkbox') {
            if (! in_array($value, [true, false, 0, 1, '0', '1'], true)) {
                $this->valueError($path, 'Choose a boolean value.');
            }

            return (bool) $value;
        }
        if ($value === null) {
            $value = '';
        }
        if ($value === '' && $required && $field['required']) {
            $this->valueError($path, 'This setting is required.');
        }
        if (in_array($type, ['number', 'range'], true)) {
            if ($value === '' && ! $field['required']) {
                return '';
            }
            if ((! is_int($value) && ! is_float($value) && ! is_string($value)) || ! is_numeric($value) || ! is_finite((float) $value)) {
                $this->valueError($path, 'Enter a finite number.');
            }
            $number = $value + 0;
            if ((isset($field['min']) && $number < $field['min']) || (isset($field['max']) && $number > $field['max'])) {
                $this->valueError($path, 'The number is outside the allowed range.');
            }
            if (isset($field['step'])) {
                $steps = ($number - ($field['min'] ?? 0)) / $field['step'];
                if (! is_finite($steps) || abs($steps - round($steps)) > 0.000001) {
                    $this->valueError($path, 'The number must follow the configured step.');
                }
            }

            return $number;
        }
        if ($type === 'select' && (is_int($value) || is_float($value))) {
            $value = (string) $value;
        }
        $maxLength = in_array($type, ['textarea', ...TemplateRichText::TYPES], true) ? 100000 : 10000;
        if (! is_string($value) || ! mb_check_encoding($value, 'UTF-8') || strlen($value) > $maxLength
            || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
            $this->valueError($path, "Enter valid text no longer than {$maxLength} bytes.");
        }
        if ($required && $field['required'] && trim($value) === '') {
            $this->valueError($path, 'This setting is required.');
        }
        if (in_array($type, TemplateRichText::TYPES, true)) {
            $html = $this->richText->render($type, $value);
            foreach ($this->richText->imageSources($html) as $image) {
                if (! $this->safeUrl($image, true, 'image')) {
                    $this->valueError($path, 'Use HTTP(S) image URLs or safe relative image paths.');
                }
            }
            if ($required && $field['required'] && $this->richText->isEmpty($html)) {
                $this->valueError($path, 'This setting is required.');
            }

            // Keep Markdown source editable; store only sanitized HTML for WYSIWYG.
            return $type === 'wysiwyg' ? $html : $value;
        }
        if ($type === 'select' && ! array_key_exists($value, $field['options'])) {
            $this->valueError($path, 'Choose one of the available options.');
        }
        if ($value !== '') {
            if ($type === 'color' && ! preg_match('/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/D', $value)) {
                $this->valueError($path, 'Enter a hexadecimal color such as #336699.');
            }
            if (in_array($type, ['url', 'image'], true) && ! $this->safeUrl($value, $type === 'image', $type)) {
                $this->valueError($path, $type === 'image' ? 'Use an HTTP(S) URL or a safe relative image path.' : 'Use an HTTP(S) URL.');
            }
            if ($type === 'email') {
                $sample = $this->dialect->validationSample($type, $value);
                $deferred = $sample === 'runtime-value' && $sample !== $value;
                if (! $deferred && ! filter_var($sample, FILTER_VALIDATE_EMAIL)) {
                    $this->valueError($path, 'Enter a valid email address.');
                }
            }
        }

        return $value;
    }

    private function safeUrl(string $value, bool $allowRelative, string $fieldType): bool
    {
        $value = $this->dialect->validationSample($fieldType, $value);
        // Decode repeatedly so encoded controls, schemes and traversal cannot bypass validation.
        $decoded = $value;
        for ($index = 0; $index < 5; $index++) {
            $next = rawurldecode($decoded);
            if ($next === $decoded) {
                break;
            }
            $decoded = $next;
        }
        if (strlen($value) > 2048 || preg_match('/[\x00-\x20\x7F\\\\]/', $decoded)
            || str_starts_with($decoded, '//') || str_contains($decoded, '%')) {
            return false;
        }
        if (preg_match('~^https?://~i', $value)) {
            $parts = parse_url($value);

            return filter_var($value, FILTER_VALIDATE_URL) !== false
                && isset($parts['host'])
                && ! isset($parts['user']) && ! isset($parts['pass']);
        }
        if (! $allowRelative || str_starts_with($decoded, '/') || str_contains($decoded, ':')
            || str_contains($decoded, '?') || str_contains($decoded, '#')) {
            return false;
        }
        foreach (explode('/', $decoded) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
        }

        return true;
    }

    /** @return array{array, array, PreparedSource, array<string, PreparedSource>} */
    private function compile(array $definition): array
    {
        $runtime = $this->dialect->runtime();
        $tokenBudget = 10000;
        $offset = 0;
        $mainSource = $this->preparedSource($definition['html'], $definition['entrypoint'] ?? 'index.html');
        $nodes = $this->parseNodes($mainSource, $offset, null, 0, $tokenBudget, $runtime, $runtime->compile($mainSource));
        $partials = [];
        $partialSources = [];
        foreach ($definition['partials'] as $name => $source) {
            $offset = 0;
            $prepared = $this->preparedSource($source, "partials.{$name}");
            $partialSources[$name] = $prepared;
            $partials[$name] = $this->parseNodes($prepared, $offset, null, 0, $tokenBudget, $runtime, $runtime->compile($prepared));
        }
        foreach ($partials as $name => $partial) {
            $budget = 50000;
            $this->validatePartialLinks($partial, $partials, [$name], $budget);
        }
        $budget = 50000;
        $this->validatePartialLinks($nodes, $partials, [], $budget);
        $budget = 50000;
        $this->validateBindings($nodes, [$this->rootFields($definition)], $partials, $budget);

        return [$nodes, $partials, $mainSource, $partialSources];
    }

    private function preparedSource(string $source, string $file): PreparedSource
    {
        $prepared = $this->dialect->prepareSource($source, $file, SourcePhase::Renderer);
        if (strlen($prepared->text) > 2 * 1024 * 1024 || ! mb_check_encoding($prepared->text, 'UTF-8') || str_contains($prepared->text, "\0")) {
            $this->invalid('Prepared template source must be UTF-8 text without null bytes within the 2 MB source limit.');
        }
        foreach ($prepared->opaque as $marker => $fragment) {
            if (! is_string($marker) || $marker === '' || ! is_string($fragment)) {
                $this->invalid('The template dialect produced invalid opaque source markers.');
            }
        }

        return $prepared;
    }

    private function parseNodes(
        PreparedSource $prepared,
        int &$offset,
        ?string $closing,
        int $depth,
        int &$budget,
        TemplateRuntimeStrategy $runtime,
        mixed $compiled,
    ): array {
        if ($depth > 24) {
            $this->invalid('Template sections may nest at most 24 levels deep.');
        }
        $source = $prepared->text;
        $nodes = [];
        $length = strlen($source);
        while ($offset < $length) {
            if (--$budget < 0) {
                $this->invalid('The template contains too many expressions.');
            }
            $start = strpos($source, '{{', $offset);
            if ($start === false) {
                $nodes = [...$nodes, ...$this->runtimeNodes($runtime, $prepared, $offset, $length - $offset, $budget, $compiled)];
                $offset = $length;
                break;
            }
            if ($start > $offset) {
                $nodes = [...$nodes, ...$this->runtimeNodes($runtime, $prepared, $offset, $start - $offset, $budget, $compiled)];
            }
            $end = strpos($source, '}}', $start + 2);
            if ($end === false) {
                $this->invalid('An expression is missing its closing }}.');
            }
            $expression = trim(substr($source, $start + 2, $end - $start - 2));
            $offset = $end + 2;
            if (! preg_match('~^([#^/>&]?)\s*((?:@root\.|(?:\.\./)+)?[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)$~D', $expression, $match)) {
                $this->invalid('Unsupported template expression: '.$expression.'. Use escaped values, sections or partials.');
            }
            [, $operator, $name] = $match;
            if ($operator === '/') {
                if ($closing !== $name) {
                    $this->invalid("Unexpected closing section: {$name}.");
                }

                return $nodes;
            }
            if (in_array($operator, ['#', '^'], true)) {
                $nodes[] = ['type' => $operator, 'name' => $name, 'children' => $this->parseNodes($prepared, $offset, $name, $depth + 1, $budget, $runtime, $compiled)];
            } else {
                $nodes[] = ['type' => match ($operator) {
                    '>' => 'partial', '&' => 'html', default => 'value'
                }, 'name' => $name];
            }
        }
        if ($closing !== null) {
            $this->invalid("Unclosed section: {$closing}.");
        }

        return $nodes;
    }

    private function runtimeNodes(
        TemplateRuntimeStrategy $runtime,
        PreparedSource $source,
        int $offset,
        int $length,
        int &$budget,
        mixed $compiled,
    ): array {
        $nodes = $runtime->nodes($source, $offset, $length, $compiled);
        if (count($nodes) > $budget) {
            $this->invalid('The template contains too many expressions.');
        }
        $budget -= count($nodes);

        return $nodes;
    }

    private function validatePartialLinks(array $nodes, array $partials, array $stack, int &$budget): void
    {
        foreach ($nodes as $node) {
            if (--$budget < 0) {
                $this->invalid('The template expands into too many expressions.');
            }
            if ($node['type'] === 'partial') {
                $name = $node['name'];
                if (! array_key_exists($name, $partials)) {
                    $this->invalid("Unknown partial: {$name}.");
                }
                if (in_array($name, $stack, true) || count($stack) >= 16) {
                    $this->invalid('Recursive partials or partial chains longer than 16 are not supported.');
                }
                $this->validatePartialLinks($partials[$name], $partials, [...$stack, $name], $budget);
            } elseif (isset($node['children'])) {
                $this->validatePartialLinks($node['children'], $partials, $stack, $budget);
            }
        }
    }

    private function validateBindings(array $nodes, array $scopes, array $partials, int &$budget): void
    {
        $runtime = $this->dialect->runtime();
        foreach ($nodes as $node) {
            if (--$budget < 0) {
                $this->invalid('The template expands into too many expressions.');
            }
            if ($node['type'] === 'text' || $runtime->isRuntimeNode($node)) {
                continue;
            }
            if ($node['type'] === 'partial') {
                $this->validateBindings($partials[$node['name']], $scopes, $partials, $budget);

                continue;
            }
            $field = $this->lookupField($node['name'], $scopes);
            if ($field === null) {
                $this->invalid("Unknown setting in template expression: {$node['name']}.");
            }
            if ($node['type'] === 'value' && in_array($field['type'], ['group', 'repeater'], true)) {
                $this->invalid("{$node['name']} is a block and must be rendered with a section.");
            }
            if ($node['type'] === 'html' && ! in_array($field['type'], TemplateRichText::TYPES, true)) {
                $this->invalid("Formatted output requires a Wysiwyg or Markdown field: {$node['name']}.");
            }
            if (isset($node['children'])) {
                $nested = $node['type'] === '#' && in_array($field['type'], ['group', 'repeater'], true);
                $this->validateBindings($node['children'], $nested ? [...$scopes, $field['fields']] : $scopes, $partials, $budget);
            }
        }
    }

    private function lookupField(string $path, array $scopes): ?array
    {
        [$path, $scopes] = $this->resolveScopes($path, $scopes);
        foreach ($scopes as $fields) {
            $parts = explode('.', $path);
            $field = $this->namedField($fields, array_shift($parts));
            if ($field === null) {
                continue;
            }
            foreach ($parts as $part) {
                if ($field['type'] !== 'group') {
                    return null;
                }
                $field = $this->namedField($field['fields'], $part);
                if ($field === null) {
                    return null;
                }
            }

            return $field;
        }

        return null;
    }

    private function renderNodes(
        array $nodes,
        array $scopes,
        array $fieldScopes,
        array $partials,
        string &$output,
        int &$budget,
        int $maxBytes,
        int $depth,
        array &$usedPartials,
        TemplateRuntimeStrategy $runtime,
        array $context,
        array &$placements,
    ): void {
        if ($depth > 64) {
            $this->invalid('The rendered template exceeds the maximum nesting depth.');
        }
        foreach ($nodes as $node) {
            if (--$budget < 0) {
                $this->invalid('The template exceeds the rendering operation limit.');
            }
            $type = $node['type'];
            if ($type === 'partial') {
                $usedPartials[$node['name']] = true;
                $this->renderNodes($partials[$node['name']], $scopes, $fieldScopes, $partials, $output, $budget, $maxBytes, $depth + 1, $usedPartials, $runtime, $context, $placements);

                continue;
            }
            $runtimeNode = $runtime->isRuntimeNode($node);
            $value = $type === 'text' || $runtimeNode ? null : $this->lookupValue($node['name'], $scopes);
            if ($type === 'text' || $runtimeNode || in_array($type, ['value', 'html'], true)) {
                $chunk = $runtimeNode
                    ? $runtime->render($node, $context)
                    : match ($type) {
                        'text' => $node['text'],
                        'html' => $this->richText->render($this->lookupField($node['name'], $fieldScopes)['type'], (string) $value),
                        default => htmlspecialchars(is_bool($value) ? ($value ? '1' : '') : (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
                    };
                if (strlen($output) + strlen($chunk) > $maxBytes) {
                    $this->invalid('The generated HTML exceeds the configured size limit.');
                }
                if ($runtimeNode && $chunk !== '') {
                    $placements[] = ['offset' => strlen($output), 'length' => strlen($chunk), 'node' => $node];
                }
                $output .= $chunk;
            } elseif ($type === '^') {
                if (! $value) {
                    $this->renderNodes($node['children'], $scopes, $fieldScopes, $partials, $output, $budget, $maxBytes, $depth + 1, $usedPartials, $runtime, $context, $placements);
                }
            } elseif ($value) {
                $nestedFields = is_array($value) ? [...$fieldScopes, $this->lookupField($node['name'], $fieldScopes)['fields']] : $fieldScopes;
                if (is_array($value) && array_is_list($value)) {
                    foreach ($value as $item) {
                        $this->renderNodes($node['children'], [...$scopes, $item], $nestedFields, $partials, $output, $budget, $maxBytes, $depth + 1, $usedPartials, $runtime, $context, $placements);
                    }
                } else {
                    $this->renderNodes($node['children'], is_array($value) ? [...$scopes, $value] : $scopes, $nestedFields, $partials, $output, $budget, $maxBytes, $depth + 1, $usedPartials, $runtime, $context, $placements);
                }
            }
        }
    }

    private function lookupValue(string $path, array $scopes): mixed
    {
        [$path, $scopes] = $this->resolveScopes($path, $scopes);
        foreach ($scopes as $scope) {
            $parts = explode('.', $path);
            $first = array_shift($parts);
            if (! array_key_exists($first, $scope)) {
                continue;
            }
            $value = $scope[$first];
            foreach ($parts as $part) {
                $value = is_array($value) ? ($value[$part] ?? null) : null;
            }

            return $value;
        }

        return null;
    }

    /** Explicit bindings preserve lexical scope when a nested block shadows a field. */
    private function resolveScopes(string $path, array $scopes): array
    {
        if (str_starts_with($path, '@root.')) {
            return [substr($path, 6), [$scopes[0]]];
        }
        $parents = 0;
        while (str_starts_with($path, '../')) {
            $parents++;
            $path = substr($path, 3);
        }
        if ($parents > 0) {
            $index = count($scopes) - 1 - $parents;

            return [$path, $index >= 0 ? [$scopes[$index]] : []];
        }

        return [$path, array_reverse($scopes)];
    }

    private function rootFields(array $definition): array
    {
        return array_merge([], ...array_column($definition['sections'], 'fields'));
    }

    private function namedField(array $fields, string $name): ?array
    {
        foreach ($fields as $field) {
            if ($field['name'] === $name) {
                return $field;
            }
        }

        return null;
    }

    private function identifier(mixed $value, string $path): string
    {
        if (! is_string($value) || ! preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/D', $value)) {
            $this->invalid("{$path} must start with a letter and contain only letters, digits or underscores (at most 64 characters).");
        }

        return $value;
    }

    private function schemaString(mixed $value, string $path, int $max, bool $empty = false): string
    {
        if (! is_string($value) || ! mb_check_encoding($value, 'UTF-8') || strlen($value) > $max || (! $empty && trim($value) === '') || str_contains($value, "\0")) {
            $this->invalid("{$path} must be valid text of at most {$max} bytes".($empty ? '.' : ' and cannot be empty.'));
        }

        return $value;
    }

    private function valueError(string $path, string $message): never
    {
        throw ValidationException::withMessages([$path => $message]);
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['template' => $message]);
    }
}
