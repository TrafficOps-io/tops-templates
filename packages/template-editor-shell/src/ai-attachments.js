const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const ATTACHMENT_LIMITS = Object.freeze({ count: 4, bytes: 4 * 1024 * 1024, total: 12 * 1024 * 1024 });

export function attachmentBytes(attachment) {
  const prefix = `data:${attachment.mime};base64,`;
  if (!TYPES[attachment.mime] || typeof attachment.dataUrl !== 'string' || !attachment.dataUrl.startsWith(prefix)) throw new Error('Attach PNG, JPEG or WebP images.');
  const encoded = attachment.dataUrl.slice(prefix.length);
  if (encoded.length > Math.ceil(ATTACHMENT_LIMITS.bytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Each reference image must be at most 4 MiB.');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (!bytes.length || bytes.length > ATTACHMENT_LIMITS.bytes) throw new Error('Each reference image must be at most 4 MiB.');
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!(attachment.mime === 'image/png' ? png : attachment.mime === 'image/jpeg' ? jpg : webp)) throw new Error('The image contents do not match its format.');
  return bytes;
}

export function validateAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length > ATTACHMENT_LIMITS.count) throw new Error('Attach up to 4 reference images.');
  let total = 0;
  const ids = new Set();
  return attachments.map(item => {
    if (typeof item?.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid reference image.');
    ids.add(item.id);
    total += attachmentBytes(item).length;
    if (total > ATTACHMENT_LIMITS.total) throw new Error('Reference images must total at most 12 MiB.');
    return { id: item.id, name: String(item.name || 'Image').slice(0, 160), mime: item.mime, dataUrl: item.dataUrl, useOnPage: item.useOnPage === true };
  });
}

export async function readImageAttachments(files, existing = []) {
  validateAttachments(existing);
  if (files.length + existing.length > ATTACHMENT_LIMITS.count) throw new Error('Attach up to 4 reference images.');
  if (files.reduce((total, file) => total + file.size, 0) + existing.reduce((total, item) => total + attachmentBytes(item).length, 0) > ATTACHMENT_LIMITS.total) throw new Error('Reference images must total at most 12 MiB.');
  const added = [];
  for (const file of files) {
    if (!TYPES[file.type] || !file.size || file.size > ATTACHMENT_LIMITS.bytes) throw new Error('Attach PNG, JPEG or WebP images, at most 4 MiB each.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (typeof createImageBitmap === 'function') {
      const decoded = await createImageBitmap(file).catch(() => { throw new Error('The image could not be opened. Choose a valid PNG, JPEG or WebP.'); });
      decoded.close();
    }
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    added.push({ id: crypto.randomUUID(), name: file.name, mime: file.type, dataUrl: `data:${file.type};base64,${btoa(binary)}`, useOnPage: false });
  }
  return validateAttachments([...existing, ...added]);
}

export function attachmentAssets(attachments) {
  return Object.fromEntries(validateAttachments(attachments).filter(item => item.useOnPage).map(item => [`images/reference-${item.id}.${TYPES[item.mime]}`, attachmentBytes(item)]));
}

export function attachmentMessage(text, attachments = []) {
  if (!attachments.length) return text;
  return [{ type: 'text', text }, ...validateAttachments(attachments).flatMap(item => [
    { type: 'text', text: `Attached image: ${item.name}. ${item.useOnPage ? `Available page asset: images/reference-${item.id}.${TYPES[item.mime]}` : 'Visual reference only; do not embed this screenshot or photo in the page.'}` },
    { type: 'file', data: item.dataUrl, mediaType: item.mime },
  ])];
}
