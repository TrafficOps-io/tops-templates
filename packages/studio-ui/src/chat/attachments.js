// Pure attachment helpers for the chat composer (no React, loadable by node --test).
// Limits (port.attachmentLimits: { count, bytesPerFile, bytesTotal, accept }) are checked before a file is added.

// Finder and some clipboard sources omit the MIME type; the server still inspects the bytes.
const MIME_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff',
};

const extension = name => { const dot = String(name || '').lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot + 1).toLowerCase(); };
export const fileMime = file => (file.type && file.type !== 'application/octet-stream' ? file.type : MIME_BY_EXTENSION[extension(file.name)] || file.type || '');

// File with a missing MIME type gets one by extension (browser only: File is re-created).
export function normalizeFile(file) {
  const mime = MIME_BY_EXTENSION[extension(file.name)];
  if (!mime || (file.type && file.type !== 'application/octet-stream') || typeof File !== 'function' || !(file instanceof File)) return file;
  return new File([file], file.name, { type: mime, lastModified: file.lastModified });
}

export function attachmentType(file) {
  const kind = fileMime(file).split('/')[0];
  return kind === 'image' || kind === 'audio' || kind === 'video' ? kind : 'document';
}

// accept: the same syntax as <input accept>: "image/*,audio/mpeg,.docx". Empty — anything goes.
export function matchesAccept(file, accept) {
  const tokens = String(accept || '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const mime = fileMime(file).toLowerCase(), name = String(file.name || '').toLowerCase();
  return tokens.some(token => token.startsWith('.') ? name.endsWith(token)
    : token.endsWith('/*') ? mime.startsWith(token.slice(0, -1))
    : mime === token);
}

const totalBytes = files => files.reduce((sum, file) => sum + (file.size || 0), 0);

// current: File[] already attached; files: incoming File[]; limits?: AttachmentLimits (absent — no limits).
// → { accepted: File[] (incoming order), rejected: { file, reason: 'count' | 'size' | 'total' | 'type' }[] }
export function appendAttachments(current = [], files = [], limits) {
  const accepted = [], rejected = [];
  for (const raw of files) {
    const file = normalizeFile(raw);
    if (limits) {
      const kept = [...current, ...accepted];
      let reason = null;
      if (!matchesAccept(file, limits.accept)) reason = 'type';
      else if (!file.size || (Number.isFinite(limits.bytesPerFile) && file.size > limits.bytesPerFile)) reason = 'size';
      else if (Number.isFinite(limits.count) && kept.length >= limits.count) reason = 'count';
      else if (Number.isFinite(limits.bytesTotal) && totalBytes(kept) + file.size > limits.bytesTotal) reason = 'total';
      if (reason) { rejected.push({ file, reason }); continue; }
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

// Counter for the toolbar: "N of count · X of total".
export function attachmentUsage(current = [], limits) {
  return { count: current.length, maxCount: limits?.count, bytes: totalBytes(current), maxBytes: limits?.bytesTotal };
}

// DataTransfer → File[]. A FileList and items normally hold the same files; never take both.
function filesFromTransfer(data) {
  if (!data) return [];
  const files = Array.from(data.files || []);
  if (files.length) return files;
  return Array.from(data.items || []).filter(item => item.kind === 'file').flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
}
export const filesFromClipboard = event => filesFromTransfer(event?.clipboardData);
export const filesFromDrop = event => filesFromTransfer(event?.dataTransfer);
