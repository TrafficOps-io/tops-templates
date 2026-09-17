<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;

/** Checks author sources and names without ever reading or executing a file. */
final class TemplateSourceSafety
{
    public static function assertSource(string $source, string $filename = 'template'): void
    {
        self::assertPath($filename);
        if (str_contains($source, '<?') || str_contains($source, '<%') || str_contains($source, '{!!')
            || preg_match('/<script\b[^>]*\blanguage\s*=\s*[\'"]?php\b/i', $source)
            || preg_match('/@(?:php|endphp|extends|yield|inject|use|component|endcomponent|livewire|vite|csrf|method|auth|endauth|guest|endguest|can|endcan|cannot|endcannot|foreach|endforeach|forelse|endforelse|while|endwhile|for|endfor|switch|endswitch|once|endonce|push|endpush|stack|verbatim|endverbatim|validation|endvalidation)\b/i', $source)
            || preg_match('/@(?:include|if|elseif|unless|each)\s*\(/i', $source)
            || preg_match('/\{\{\s*\$/', $source)) {
            throw ValidationException::withMessages(['template' => "{$filename}: Executable PHP, Blade and request validation sources are unsupported."]);
        }
    }

    public static function isSafePath(string $path): bool
    {
        if (! self::isRelativePath($path)
            || preg_match('/\.(?:php\d*|phtml|phar|blade(?:\.php)?|cgi|pl|py|rb|sh|asp|aspx|jsp)(?:\.|$)/i', $path)) {
            return false;
        }

        return true;
    }

    public static function isRelativePath(string $path): bool
    {
        if ($path === '' || strlen($path) > 255 || ! mb_check_encoding($path, 'UTF-8')
            || preg_match('~[\x00-\x20\x7F\\\\:%?#]~', $path) || str_starts_with($path, '/')) {
            return false;
        }
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..' || str_starts_with($segment, '.')) {
                return false;
            }
        }

        return true;
    }

    public static function assertPath(string $path): void
    {
        if (! self::isSafePath($path)) {
            throw ValidationException::withMessages(['template' => 'Source names must be safe relative paths without executable extensions.']);
        }
    }

    public static function assertRelativePath(string $path): void
    {
        if (! self::isRelativePath($path)) {
            throw ValidationException::withMessages(['template' => 'Source names must be safe relative paths.']);
        }
    }
}
