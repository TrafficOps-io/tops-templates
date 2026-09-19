import { LIMITS } from './project.js';
export const OPENROUTER_IMAGE_ENDPOINT = 'https://openrouter.ai/api/v1/images';
export function imageFromResponse(payload) {
  const item = payload?.data?.[0];
  const type = item?.media_type || 'image/png';
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[type];
  if (!extension || typeof item?.b64_json !== 'string' || !item.b64_json) throw new Error('The model did not return a PNG, JPEG or WebP image. Choose a raster image model in Settings.');
  if (item.b64_json.length > Math.ceil(LIMITS.file * 4 / 3) + 4) throw new Error('The generated image exceeds 8 MiB. Request a smaller image.');
  let bytes;
  try { bytes = Uint8Array.from(atob(item.b64_json), character => character.charCodeAt(0)); }
  catch { throw new Error('The provider returned invalid image data.'); }
  if (!bytes.length || bytes.length > LIMITS.file) throw new Error('The generated image is empty or too large.');
  return new File([bytes], `ai-image-${Date.now()}.${extension}`, { type });
}
export async function generateImageWithOpenRouter({ apiKey, imageModel, prompt, field = {}, signal, fetchImpl = globalThis.fetch }) {
  if (!apiKey?.trim() || !imageModel?.trim()) throw new Error('Set an OpenRouter API key and image model in Settings first.');
  if (!prompt?.trim() || prompt.length > 6000) throw new Error('Describe your image in 1–6,000 characters.');
  try {
    const response = await fetchImpl(OPENROUTER_IMAGE_ENDPOINT, { method: 'POST', signal, headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Landing Studio by TrafficOps' }, body: JSON.stringify({ model: imageModel.trim(), prompt: `Create an image for a landing page. ${field.label ? `Image role: ${field.label}.` : ''} ${field.help || ''}\n${prompt.trim()}${field.sizes?.[0] ? `\nCompose for a ${field.sizes[0].width}x${field.sizes[0].height} crop.` : field.aspect_ratio ? `\nCompose for width/height ratio ${field.aspect_ratio}.` : ''}`, n: 1, output_format: 'png' }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenRouter: ${payload?.error?.message || `Image generation failed (${response.status}).`}`);
    return imageFromResponse(payload);
  } catch (error) {
    if (signal?.aborted) throw new Error('Image generation cancelled or timed out.');
    throw new Error(String(error.message || error).replaceAll(apiKey.trim(), '[redacted]').slice(0, 500));
  }
}
