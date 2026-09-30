import { LIMITS } from './project.js';
import { imageSize } from 'image-size';
import { AiProviderError } from './ai-provider-errors.js';

export const MAX_GENERATED_IMAGE_DIMENSION = 4096;
export const MAX_GENERATED_IMAGE_PIXELS = 16 * 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const conversionError = message => new AiProviderError(message, { code: 'image_conversion_failed', retryable: false, terminalImage: true, cancelled: false });

function abortError(signal) {
  return signal?.reason?.name === 'AbortError' ? signal.reason : new DOMException('Image generation cancelled or timed out.', 'AbortError');
}

function checkAbort(signal) { if (signal?.aborted) throw abortError(signal); }

// Cancellation must release our resources without waiting for a native decoder
// or encoder callback. Keep rejection handlers attached to ignore late results.
function abortable(operation, signal, disposeLate) {
  checkAbort(signal);
  if (!signal) return operation();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (value, failed) => {
      if (settled) { if (!failed) { try { disposeLate?.(value); } catch {} } return; }
      settled = true; signal.removeEventListener('abort', onAbort);
      if (failed) reject(value); else resolve(value);
    };
    const onAbort = () => settle(abortError(signal), true);
    signal.addEventListener('abort', onAbort, { once: true });
    try { Promise.resolve(operation()).then(value => settle(value, false), error => settle(error, true)); }
    catch (error) { settle(error, true); }
  });
}

function matchesFormat(bytes, type) {
  if (type === 'image/png') return pngSignature.every((byte, index) => bytes[index] === byte);
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return type === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

function checkDimensions({ width, height } = {}) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw conversionError('The generated image has invalid dimensions.');
  if (width > MAX_GENERATED_IMAGE_DIMENSION || height > MAX_GENERATED_IMAGE_DIMENSION || width * height > MAX_GENERATED_IMAGE_PIXELS) throw conversionError('The generated image exceeds 4096 pixels per side or 16 megapixels. Request a smaller image.');
}

// Node has no native raster decoder. Require complete standard PNG framing,
// including image data and IEND, rather than trusting an eight-byte signature.
function checkPngStructure(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, imageData = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), end = offset + 12 + size;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (end > bytes.length || (offset === 8 ? type !== 'IHDR' || size !== 13 : type === 'IHDR')) break;
    if (type === 'IDAT' && size) imageData = true;
    if (type === 'IEND') {
      if (!size && imageData && end === bytes.length) return;
      break;
    }
    offset = end;
  }
  throw conversionError('The provider returned incomplete or invalid PNG data.');
}

// Image providers may return JPEG/WebP despite a PNG preference. Workflow tool
// paths remain *.png, so convert the bytes rather than relabeling the file.
export async function normalizeGeneratedImagePng(file, { signal } = {}) {
  let image, url, canvas;
  try {
    checkAbort(signal);
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw conversionError('The provider must return a PNG, JPEG or WebP image.');
    if (!file.size || file.size > LIMITS.file) throw conversionError('The generated image is empty or exceeds 8 MiB.');
    const bytes = new Uint8Array(await abortable(() => file.arrayBuffer(), signal));
    checkAbort(signal);
    if (!matchesFormat(bytes, file.type)) throw conversionError('The generated image contents do not match its format.');
    checkDimensions(imageSize(bytes));
    if (file.type === 'image/png') {
      checkPngStructure(bytes);
      if (typeof document === 'undefined') return file;
      if (typeof createImageBitmap !== 'function') throw conversionError('PNG image decoding is unavailable in this browser.');
      // Image.decode can accept a PNG whose IDAT has no decodable pixels.
      // ImageBitmap performs raster decoding; close it even after cancellation.
      const bitmap = await abortable(() => createImageBitmap(file), signal, value => value.close());
      try { checkAbort(signal); checkDimensions(bitmap); return file; }
      finally { bitmap.close(); }
    }
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      throw conversionError('PNG image conversion is unavailable in this environment.');
    }
    image = new Image(); url = URL.createObjectURL(file); image.src = url;
    await abortable(() => image.decode(), signal);
    checkAbort(signal);
    checkDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw conversionError('PNG image conversion is unavailable in this browser.');
    context.drawImage(image, 0, 0);
    const blob = await abortable(() => new Promise(resolve => canvas.toBlob(resolve, 'image/png')), signal);
    checkAbort(signal);
    if (!blob || blob.type !== 'image/png' || !blob.size || blob.size > LIMITS.file) throw conversionError('The converted PNG is empty or exceeds 8 MiB. Request a smaller image.');
    const name = (file.name || 'generated-image').replace(/\.[^.]*$/, '') + '.png';
    return new File([blob], name, { type: 'image/png' });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error instanceof AiProviderError) throw error;
    throw conversionError(error?.message || 'The generated image could not be converted to PNG.');
  } finally {
    if (image) image.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
