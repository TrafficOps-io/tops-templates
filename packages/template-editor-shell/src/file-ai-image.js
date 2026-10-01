import { imageSize } from 'image-size';
import { LIMITS } from './project.js';
import { imageMime } from './image-editing.js';
import { normalizeGeneratedImagePng, MAX_GENERATED_IMAGE_DIMENSION, MAX_GENERATED_IMAGE_PIXELS } from './generated-image-png.js';

const rasterTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const checkAbort = signal => signal?.throwIfAborted();

function abortable(operation, signal, disposeLate) {
  checkAbort(signal);
  if (!signal) return operation();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (value, failed) => {
      if (settled) { if (!failed) { try { disposeLate?.(value); } catch {} } return; }
      settled = true; signal.removeEventListener('abort', abort);
      if (failed) reject(value); else resolve(value);
    };
    const abort = () => settle(signal.reason || new DOMException('Image editing cancelled.', 'AbortError'), true);
    signal.addEventListener('abort', abort, { once: true });
    try { Promise.resolve(operation()).then(value => settle(value, false), error => settle(error, true)); }
    catch (error) { settle(error, true); }
  });
}

export function fileAiImageDataUrl(bytes, path) {
  const mime = imageMime(path);
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > LIMITS.file || !rasterTypes.has(mime)) throw new Error('Choose a PNG, JPEG or WebP image smaller than 8 MiB.');
  const valid = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw new Error('The selected image contents do not match its file extension.');
  let size;
  try { size = imageSize(bytes); } catch { throw new Error('The selected image cannot be opened.'); }
  if (!size.width || !size.height || size.width > MAX_GENERATED_IMAGE_DIMENSION || size.height > MAX_GENERATED_IMAGE_DIMENSION || size.width * size.height > MAX_GENERATED_IMAGE_PIXELS) throw new Error('AI editing supports images up to 4096 pixels per side and 16 megapixels.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

// The provider requests PNG, but a single-file edit must retain the selected
// filename. Encode real JPEG/WebP bytes instead of relabeling a PNG as *.jpg.
export async function normalizeFileAiImage(file, path, { signal } = {}) {
  const mime = imageMime(path);
  if (!rasterTypes.has(mime)) throw new Error('AI editing supports PNG, JPEG and WebP files.');
  const png = await normalizeGeneratedImagePng(file, { signal });
  checkAbort(signal);
  if (mime === 'image/png') return new Uint8Array(await abortable(() => png.arrayBuffer(), signal));
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('Saving an AI edit in the original JPEG or WebP format is unavailable in this browser.');
  let bitmap, canvas;
  try {
    bitmap = await abortable(() => createImageBitmap(png), signal, image => image.close());
    checkAbort(signal);
    canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable in this browser.');
    // JPEG cannot retain transparency. Use the normal white document backdrop.
    if (mime === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(bitmap, 0, 0);
    const blob = await abortable(() => new Promise(resolve => canvas.toBlob(resolve, mime, 0.95)), signal);
    checkAbort(signal);
    if (!blob || blob.type !== mime || !blob.size || blob.size > LIMITS.file) throw new Error('The browser could not save the edited image in its original format within 8 MiB.');
    const bytes = new Uint8Array(await abortable(() => blob.arrayBuffer(), signal));
    fileAiImageDataUrl(bytes, path);
    return bytes;
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
