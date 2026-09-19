import { imageSize } from 'image-size';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

// Mirrors ProjectCompiler's SVG pixel/viewBox policy. Unit conversion is not
// inferred: the template contract accepts numeric or px dimensions, then viewBox.
export function imageDimensions(path, value) {
  try {
    if (!path.toLowerCase().endsWith('.svg')) {
      const result = imageSize(typeof value === 'string' ? encoder.encode(value) : value);
      return result.width > 0 && result.height > 0 ? result : null;
    }
    const source = typeof value === 'string' ? value : decoder.decode(value);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return null;
    const root = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(source);
    if (!root) return null;
    const attributes = Object.fromEntries([...root[1].matchAll(/([^\s=]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1], match[3]]));
    const pixel = text => /^([0-9]+(?:\.[0-9]+)?)(?:px)?$/.exec(text || '');
    const width = pixel(attributes.width), height = pixel(attributes.height);
    if (width && height) return +width[1] > 0 && +height[1] > 0 ? { width: +width[1], height: +height[1] } : null;
    const box = (attributes.viewBox || '').trim().split(/[\s,]+/).map(Number);
    return box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? { width: box[2], height: box[3] } : null;
  } catch { return null; }
}
