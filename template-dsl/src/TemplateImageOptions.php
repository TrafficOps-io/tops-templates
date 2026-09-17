<?php

declare(strict_types=1);

namespace TrafficOps\TemplateDsl;

use Illuminate\Validation\ValidationException;

final class TemplateImageOptions
{
    public static function normalize(array $field, string $path): array
    {
        $hasRatio = array_key_exists('aspect_ratio', $field);
        $hasSizes = array_key_exists('sizes', $field);
        if (! $hasRatio && ! $hasSizes) {
            return $field;
        }
        if ($field['type'] !== 'image' || ($hasRatio && $hasSizes)) {
            self::invalid("{$path}: use either aspect_ratio or sizes, on Image fields only.");
        }
        if ($hasRatio) {
            $ratio = $field['aspect_ratio'];
            if (is_string($ratio) && preg_match('/^([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/D', $ratio, $parts)) {
                $ratio = (int) $parts[1] / (int) $parts[2];
            }
            if ((! is_int($ratio) && ! is_float($ratio)) || ! is_finite((float) $ratio) || $ratio < 0.01 || $ratio > 100) {
                self::invalid("{$path}.aspect_ratio must be a ratio such as 16:9 or a number between 0.01 and 100.");
            }
            $field['aspect_ratio'] = $ratio;
        }
        if ($hasSizes) {
            $sizes = $field['sizes'];
            if (! is_array($sizes) || ! array_is_list($sizes) || count($sizes) < 1 || count($sizes) > 10) {
                self::invalid("{$path}.sizes must contain between 1 and 10 image sizes.");
            }
            $seen = [];
            foreach ($sizes as &$size) {
                if (! is_array($size) || ! is_int($size['width'] ?? null) || ! is_int($size['height'] ?? null)
                    || min($size['width'], $size['height']) < 1 || max($size['width'], $size['height']) > 4096) {
                    self::invalid("{$path}.sizes requires integer width and height between 1 and 4096 pixels.");
                }
                $key = $size['width'].'x'.$size['height'];
                if (isset($seen[$key])) {
                    self::invalid("{$path}.sizes contains a duplicate size.");
                }
                $seen[$key] = true;
                $label = $size['label'] ?? '';
                if (! is_string($label) || ! mb_check_encoding($label, 'UTF-8') || strlen($label) > 100 || preg_match('/[\x00-\x1F\x7F]/', $label)) {
                    self::invalid("{$path}.sizes labels must be text of at most 100 bytes.");
                }
                $size = ['width' => $size['width'], 'height' => $size['height'], 'label' => $label];
            }
            unset($size);
            $field['sizes'] = $sizes;
        }

        return $field;
    }

    public static function ratioLabel(float $ratio): string
    {
        for ($denominator = 1; $denominator <= 100; $denominator++) {
            $numerator = round($ratio * $denominator);
            if ($numerator > 0 && abs($numerator / $denominator - $ratio) < 0.00001) {
                return (int) $numerator.':'.$denominator;
            }
        }

        return round($ratio, 4).':1';
    }

    private static function invalid(string $message): never
    {
        throw ValidationException::withMessages(['template' => $message]);
    }
}
