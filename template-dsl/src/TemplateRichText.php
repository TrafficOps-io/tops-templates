<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Dom\HTMLDocument;
use League\CommonMark\CommonMarkConverter;
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/** The same bounded renderer is used for previews, validation and static releases. */
final class TemplateRichText
{
    public const TYPES = ['wysiwyg', 'markdown'];

    public const MAX_BYTES = 100000;

    private HtmlSanitizer $sanitizer;

    private CommonMarkConverter $markdown;

    public function __construct()
    {
        $config = (new HtmlSanitizerConfig)
            ->withMaxInputLength(self::MAX_BYTES * 10)
            ->allowLinkSchemes(['https', 'http', 'mailto'])
            ->allowRelativeLinks()
            ->allowMediaSchemes(['https', 'http'])
            ->allowRelativeMedias()
            ->allowElement('img', ['src', 'alt', 'title']);

        foreach (['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'u', 'ul', 'li', 'blockquote', 'pre', 'code', 'hr'] as $tag) {
            $config = $config->allowElement($tag, []);
        }
        $config = $config->allowElement('ol', ['start'])->allowElement('a', ['href', 'title']);
        $this->sanitizer = new HtmlSanitizer($config);
        $this->markdown = new CommonMarkConverter([
            'html_input' => 'strip',
            'allow_unsafe_links' => false,
            'max_nesting_level' => 32,
            'max_delimiters_per_line' => 1000,
        ]);
    }

    public function render(string $type, string $value): string
    {
        $html = $type === 'markdown' ? (string) $this->markdown->convert($value) : $value;

        return $this->sanitizer->sanitize($html);
    }

    public function isEmpty(string $html): bool
    {
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return preg_replace('/[\s\p{Z}\x{200B}\x{FEFF}]+/u', '', $text) === '' && ! str_contains($html, '<hr') && $this->imageSources($html) === [];
    }

    public function imageSources(string $html): array
    {
        if ($html === '') {
            return [];
        }
        $document = HTMLDocument::createFromString($html, LIBXML_NOERROR, 'UTF-8');
        $sources = [];
        foreach ($document->getElementsByTagName('img') as $image) {
            $src = $image->getAttribute('src');
            if (is_string($src) && $src !== '') {
                $sources[] = $src;
            }
        }

        return array_values(array_unique($sources));
    }
}
