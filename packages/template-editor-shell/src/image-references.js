// Images a generate_image call may be based on (input_references). One catalog
// per run: images shown to the model now (attached to this message, then
// @-mentioned project images, in the order of the vision parts), then images
// attached to earlier messages of the visible branch (listed, not re-sent).
// Each entry gets a short handle (ref1, ref2…) that the model passes back;
// UUIDs are easy to mistype and a rejected id used to make it drop references.
import { LIMITS, safePath } from './project.js';

export const IMAGE_REFERENCE_LIMIT = 8;
export const MAX_IMAGE_REFERENCES = 3;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const usable = item => item && typeof item.id === 'string' && IMAGE_TYPES.has(item.mime) && typeof item.dataUrl === 'string' && item.dataUrl.startsWith(`data:${item.mime};base64,`);

/** history — branchHistory() output (root first). Image attachments of earlier user messages, most recent first, deduplicated by id. */
export function earlierImageAttachments(history = []) {
  const seen = new Set(), out = [];
  for (const message of [...history].reverse()) {
    if (message?.role !== 'user' || !Array.isArray(message.attachments)) continue;
    for (const item of message.attachments) if (usable(item) && !seen.has(item.id)) { seen.add(item.id); out.push({ id: item.id, name: String(item.name || 'Image').slice(0, 160), mime: item.mime, dataUrl: item.dataUrl }); }
  }
  return out;
}

function sniff(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
}
function dataUrlOf(bytes, mime) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}
// A PNG/JPEG/WebP file of the CURRENT draft, so images generated earlier in the run work too.
function projectImage(token, files) {
  let path;
  try { path = safePath(token); } catch { return undefined; }
  const bytes = files?.[path];
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > LIMITS.file || !/\.(?:png|jpe?g|webp)$/i.test(path)) return undefined;
  const mime = sniff(bytes);
  return mime ? { name: path, path, mime, dataUrl: dataUrlOf(bytes, mime), source: 'project' } : undefined;
}
const HANDLE = /^ref\s*-?\s*(\d+)$/i;

/**
 * attachments — validated images sent to the model with this message (mention-derived ones have ids `mention-…`).
 * earlier — earlierImageAttachments() of the visible branch.
 */
export function imageReferenceCatalog({ attachments = [], earlier = [], limit = IMAGE_REFERENCE_LIMIT } = {}) {
  const seen = new Set(), entries = [];
  const add = (item, source) => {
    if (!usable(item) || seen.has(item.id) || entries.length >= limit) return;
    seen.add(item.id);
    entries.push({ handle: `ref${entries.length + 1}`, id: item.id, name: String(item.name || 'Image').slice(0, 160), mime: item.mime, dataUrl: item.dataUrl, source, ...(item.useOnPage ? { useOnPage: true } : {}) });
  };
  for (const item of attachments) add(item, item.id.startsWith('mention-') ? 'mentioned' : 'current');
  for (const item of earlier) add(item, 'earlier');
  const valid = () => entries.length ? `Use one of: ${entries.map(entry => `${entry.handle} (${entry.name})`).join(', ')}, or a PNG/JPEG/WebP project image path.` : 'No image references are attached in this dialog; omit references or pass a PNG/JPEG/WebP project image path.';
  function find(raw, files) {
    const token = String(raw ?? '').trim().replace(/^@/, '');
    const handle = token.match(HANDLE);
    return (handle && entries[Number(handle[1]) - 1]) || entries.find(entry => entry.id === token) || entries.find(entry => entry.name === token) || projectImage(token, files);
  }
  return {
    entries,
    /** Tokens from generate_image → [{ name, mime, dataUrl, source }]. Throws with the valid handles for an unknown token. */
    resolve(tokens = [], files = {}) {
      const out = [];
      for (const token of tokens) {
        const found = find(token, files);
        if (!found) throw new Error(entries.length ? `Unknown image reference "${String(token).slice(0, 80)}". ${valid()}` : valid());
        if (!out.some(item => item.dataUrl === found.dataUrl)) out.push({ name: found.name, mime: found.mime, dataUrl: found.dataUrl, source: found.source, ...(found.handle ? { handle: found.handle } : {}) });
      }
      if (out.length > MAX_IMAGE_REFERENCES) throw new Error(`Pass at most ${MAX_IMAGE_REFERENCES} image references to generate_image.`);
      return out;
    },
    /** Workflow context lines for the model. */
    describe() {
      const label = { current: 'attached to this message, shown above', mentioned: 'mentioned project image, shown above', earlier: 'attached earlier in this dialog; not shown again' };
      const lines = entries.map(entry => `- ${entry.handle} — ${entry.name} (${label[entry.source]}${entry.useOnPage ? `; page asset images/reference-${entry.id}.${entry.mime.split('/')[1].replace('jpeg', 'jpg')}` : ''})`);
      return `Image references for generate_image.references (pass the handle):\n${lines.length ? lines.join('\n') : '- none attached in this dialog'}\nA PNG/JPEG/WebP project image path from the current draft (for example img/hero.png, including an image generated earlier in this run) can also be passed as a reference.`;
    },
  };
}
