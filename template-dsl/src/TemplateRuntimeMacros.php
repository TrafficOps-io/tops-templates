<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;

/** Single-pass runtime data tokens: request objects and field values are never inspected. */
final class TemplateRuntimeMacros
{
    public static function validateContext(array $context): array
    {
        if (array_diff(array_keys($context), ['query', 'locale', 'actions'])) {
            self::fail('Runtime context only accepts explicit query, locale and actions data.');
        }
        $result = ['query' => [], 'locale' => '', 'actions' => []];
        foreach (['query', 'actions'] as $group) {
            $values = $context[$group] ?? [];
            if (! is_array($values) || count($values) > 100) {
                self::fail("Runtime {$group} must be a scalar map with at most 100 entries.");
            }
            foreach ($values as $name => $value) {
                if (! is_string($name) || ! preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,63}$/D', $name)) {
                    self::fail('Runtime names must be bounded identifiers.');
                }
                $value = self::scalar($value);
                if ($group === 'actions' && ! self::actionUrl($value)) {
                    self::fail('Platform actions require an HTTPS URL or a safe absolute local path.');
                }
                $result[$group][$name] = $value;
            }
        }
        $result['locale'] = self::scalar($context['locale'] ?? '');
        if ($result['locale'] !== '' && ! preg_match('/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{2,8})*$/D', $result['locale'])) {
            self::fail('Runtime locale must be a language tag.');
        }

        return $result;
    }

    /** @return array<int,array{type:string,name:string,encoding:string,length:int}> */
    public static function compile(string $source): array
    {
        preg_match_all('/(?<!\{)\{(?:query|headers|body|actions|locale)(?:\.[^{}]*)?\}(?!\})/', $source, $matches, PREG_OFFSET_CAPTURE);
        if (count($matches[0]) > 1000) {
            self::fail('A source may contain at most 1,000 runtime macros.');
        }
        if ($matches[0] === []) {
            return [];
        }
        $ranges = self::markupRanges($source);
        $rangeIndex = 0;
        $result = [];
        foreach ($matches[0] as [$macro, $offset]) {
            if (! preg_match('/^\{(locale|(?:query|actions)\.[A-Za-z][A-Za-z0-9_-]{0,63})\}$/D', $macro, $name)) {
                self::fail('Runtime macros support only {query.name}, {locale} and {actions.name}; request headers, body and wildcards are unavailable.');
            }
            while (isset($ranges[$rangeIndex]) && $ranges[$rangeIndex]['end'] <= $offset) {
                $rangeIndex++;
            }
            $range = $ranges[$rangeIndex] ?? null;
            $encoding = 'html';
            if ($range !== null && $range['start'] <= $offset) {
                if ($range['kind'] !== 'tag') {
                    self::fail('Runtime macros cannot appear in scripts, styles, comments or declarations.');
                }
                $encoding = self::attributeEncoding($range, $offset, $macro, $name[1]);
            } elseif (str_starts_with($name[1], 'actions.')) {
                // Text is safe, but action URLs intentionally belong only to URL attributes.
                self::fail('Platform action macros must fill a quoted link or form action attribute.');
            }
            $result[$offset] = ['type' => 'runtime', 'name' => $name[1], 'encoding' => $encoding, 'length' => strlen($macro)];
        }

        return $result;
    }

    public static function nodes(string $source, int $offset, int $length, int &$budget, array $macros): array
    {
        $nodes = [];
        $end = $offset + $length;
        foreach ($macros as $position => $macro) {
            if ($position < $offset || $position >= $end) {
                continue;
            }
            if (--$budget < 0) {
                self::fail('The template contains too many expressions.');
            }
            if ($position > $offset) {
                $nodes[] = ['type' => 'text', 'text' => substr($source, $offset, $position - $offset)];
            }
            $nodes[] = $macro;
            $offset = $position + $macro['length'];
        }
        if ($offset < $end) {
            $nodes[] = ['type' => 'text', 'text' => substr($source, $offset, $end - $offset)];
        }

        return $nodes;
    }

    /** Verify composed partial/section markup without treating any rendered data as a macro. */
    public static function assertRenderedPositions(string $html, array $placements): void
    {
        if ($placements === []) {
            return;
        }
        $ranges = self::markupRanges($html);
        $rangeIndex = 0;
        foreach ($placements as $placement) {
            $offset = $placement['offset'];
            $node = $placement['node'];
            while (isset($ranges[$rangeIndex]) && $ranges[$rangeIndex]['end'] <= $offset) {
                $rangeIndex++;
            }
            $range = $ranges[$rangeIndex] ?? null;
            $encoding = 'html';
            if ($range !== null && $range['start'] <= $offset) {
                if ($range['kind'] !== 'tag') {
                    self::fail('Composed runtime macros cannot appear in executable or raw-text contexts.');
                }
                $encoding = self::attributeEncoding($range, $offset, substr($html, $offset, $placement['length']), $node['name']);
            } elseif (str_starts_with($node['name'], 'actions.')) {
                self::fail('Composed action macros must remain in a quoted action attribute.');
            }
            if ($encoding !== $node['encoding']) {
                self::fail('Template composition changed a runtime macro escaping context.');
            }
        }
    }

    public static function render(array $node, array $context): string
    {
        $parts = explode('.', $node['name'], 2);
        $value = count($parts) === 1 ? $context[$parts[0]] : ($context[$parts[0]][$parts[1]] ?? '');
        if ($node['encoding'] === 'url') {
            $value = rawurlencode($value);
        }

        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function attributeEncoding(array $range, int $offset, string $macro, string $name): string
    {
        preg_match_all('/([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*([\'"])(.*?)\2/s', $range['text'], $attributes, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($attributes as $attribute) {
            $start = $range['start'] + $attribute[3][1];
            $value = $attribute[3][0];
            if ($offset < $start || $offset + strlen($macro) > $start + strlen($value)) {
                continue;
            }
            $attr = strtolower($attribute[1][0]);
            if (in_array($attr, ['href', 'src', 'action', 'formaction'], true)) {
                if (str_starts_with($name, 'actions.')) {
                    if ($value !== $macro || ! in_array($attr, ['href', 'action', 'formaction'], true)) {
                        self::fail('An action macro must be the whole href, action or formaction value.');
                    }

                    return 'html';
                }
                $before = substr($value, 0, $offset - $start);
                if (! preg_match('~^(?:https?://[A-Za-z0-9.-]+(?::[0-9]+)?/|/(?!/)|(?:[A-Za-z0-9_-]+/)+)~i', $before)
                    || preg_match('/[\x00-\x20\x7F\\\\]/', $value)
                    || str_contains($value, '&colon;')) {
                    self::fail('Query and locale URL macros require a fixed HTTP(S) host or safe path prefix.');
                }

                return 'url';
            }
            if (str_starts_with($name, 'actions.') || ! preg_match('/^(?:title|alt|value|placeholder|lang|aria-[a-z-]+|data-[a-z0-9_-]+)$/D', $attr)) {
                self::fail('Runtime macros require text or a supported quoted content attribute.');
            }

            return 'html';
        }
        self::fail('Runtime macros cannot create tags, attribute names or unquoted attributes.');
    }

    /** Scan HTML once, retaining quoted attributes and raw text boundaries. */
    private static function markupRanges(string $source): array
    {
        $ranges = [];
        $length = strlen($source);
        $offset = 0;
        while (($start = strpos($source, '<', $offset)) !== false) {
            if (substr($source, $start, 4) === '<!--') {
                $close = strpos($source, '-->', $start + 4);
                $end = $close === false ? $length : $close + 3;
                $ranges[] = ['start' => $start, 'end' => $end, 'kind' => 'comment'];
                $offset = $end;

                continue;
            }
            $quote = null;
            $end = $start + 1;
            for (; $end < $length; $end++) {
                $char = $source[$end];
                if ($quote !== null) {
                    if ($char === $quote) {
                        $quote = null;
                    }
                } elseif ($char === '"' || $char === "'") {
                    $quote = $char;
                } elseif ($char === '>') {
                    $end++;
                    break;
                }
            }
            $tag = substr($source, $start, $end - $start);
            $ranges[] = ['start' => $start, 'end' => $end, 'kind' => preg_match('/^<\/?[A-Za-z]/', $tag) ? 'tag' : 'declaration', 'text' => $tag];
            $offset = $end;
            if (preg_match('/^<(script|style|iframe|object|embed|xmp|noembed|noframes|plaintext)\b/i', $tag, $raw)) {
                $name = strtolower($raw[1]);
                $matched = $name !== 'plaintext' && preg_match('~</'.preg_quote($name, '~').'(?=[\x09\x0A\x0C\x0D />])~i', $source, $closing, PREG_OFFSET_CAPTURE, $offset);
                $rawEnd = $matched ? $closing[0][1] : $length;
                // Legacy script comments enter HTML's escaped/double-escaped
                // tokenizer states. Reject that ambiguity when runtime data is
                // present instead of treating a quoted closing tag as text.
                if ($name === 'script' && str_contains(substr($source, $offset, $rawEnd - $offset), '<!--')) {
                    self::fail('Runtime templates cannot use legacy HTML comments inside script elements.');
                }
                $ranges[] = ['start' => $offset, 'end' => $rawEnd, 'kind' => 'raw'];
                $offset = $rawEnd;
            }
        }

        return $ranges;
    }

    private static function scalar(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if (! is_scalar($value) || (is_float($value) && ! is_finite($value))) {
            self::fail('Runtime values must be bounded scalar data.');
        }
        $value = is_bool($value) ? ($value ? '1' : '') : (string) $value;
        if (! mb_check_encoding($value, 'UTF-8') || strlen($value) > 2048 || preg_match('/[\x00-\x1F\x7F]/', $value)) {
            self::fail('Runtime values must be UTF-8 text of at most 2,048 bytes without controls.');
        }

        return $value;
    }

    private static function actionUrl(string $url): bool
    {
        $decoded = $url;
        for ($index = 0; $index < 5; $index++) {
            $next = rawurldecode($decoded);
            if ($next === $decoded) {
                break;
            }
            $decoded = $next;
        }
        if ($url === '' || preg_match('/[\x00-\x20\x7F\\\\{}]/', $decoded) || str_starts_with($decoded, '//')) {
            return false;
        }
        if (str_starts_with($url, '/')) {
            return true;
        }
        $parts = parse_url($url);

        return filter_var($url, FILTER_VALIDATE_URL) !== false && ($parts['scheme'] ?? '') === 'https'
            && ! isset($parts['user']) && ! isset($parts['pass']);
    }

    private static function fail(string $message): never
    {
        throw ValidationException::withMessages(['template' => $message]);
    }
}
