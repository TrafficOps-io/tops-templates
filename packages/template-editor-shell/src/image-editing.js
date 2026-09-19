import { LIMITS } from './project.js';
export const MAX_DIMENSION = 4096;
export function imageTarget(source, config = {}) {
  if (config.sizes?.length) return config.sizes[source?.preset ?? 0];
  const width = source?.width || 1, height = source?.height || 1;
  const ratio = config.aspect_ratio || source?.ratio || width / height;
  const targetWidth = Math.min(source?.outputWidth || Math.min(width, height * ratio), MAX_DIMENSION, MAX_DIMENSION * ratio);
  return { width: Math.max(1, Math.round(targetWidth)), height: Math.max(1, Math.round(targetWidth / ratio)) };
}
export function cropRectangle(source, target) {
  const zoom = Math.max(1, Math.min(8, Number(source.zoom) || 1));
  const scale = Math.max(target.width / source.width, target.height / source.height) * zoom;
  const width = target.width / scale, height = target.height / scale;
  const position = value => Math.max(-1, Math.min(1, Number(value) || 0));
  return { x: (source.width - width) * (position(source.x) + 1) / 2, y: (source.height - height) * (position(source.y) + 1) / 2, width, height };
}
export function imageMime(path) { return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml' })[path.split('.').pop().toLowerCase()] || 'application/octet-stream'; }
export async function openImage(file) {
  if (file.size > LIMITS.file) throw new Error('Choose an image smaller than 8 MiB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024) throw new Error('Choose an image with at most 64 megapixels.');
    return { image, width: image.naturalWidth, height: image.naturalHeight, url };
  } catch (error) { URL.revokeObjectURL(url); throw new Error(error.message || 'This image could not be opened.'); }
}
export async function exportCrop(source, target, name) {
  const canvas = document.createElement('canvas'); canvas.width = target.width; canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable in this browser.');
  const crop = cropRectangle(source, target);
  context.drawImage(source.image, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size > LIMITS.file) throw new Error('The cropped image exceeds 8 MiB. Reduce the output size.');
  const base = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100) || 'image';
  return new File([blob], `${base}-crop.png`, { type: 'image/png' });
}
