const IMAGE_MIMES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon',
});

export function projectFileImageMime(path) {
  const extension = String(path).split('.').at(-1).toLowerCase();
  return Object.hasOwn(IMAGE_MIMES, extension) ? IMAGE_MIMES[extension] : null;
}

// Previews only read project bytes: file paths and text can never become remote URLs.
export function createProjectFilePreview(path, value, urls = globalThis.URL) {
  const mime = projectFileImageMime(path);
  if (!mime || !(value instanceof Uint8Array) || !value.byteLength || typeof urls?.createObjectURL !== 'function') return null;
  let url;
  try { url = urls.createObjectURL(new Blob([value], { type: mime })); }
  catch { return null; }
  let disposed = false;
  return { url, dispose() { if (!disposed) { disposed = true; urls.revokeObjectURL(url); } } };
}
