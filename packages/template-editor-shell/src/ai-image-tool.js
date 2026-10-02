import { tool } from 'ai';
import { z } from 'zod';
import { safePath, validateProject } from './project.js';
import { normalizeAiProviderError, isTerminalImageError } from './ai-provider-errors.js';
import { MAX_IMAGE_REFERENCES } from './image-references.js';

/** Shared by the agent and content instructions: when generate_image must carry references. */
export const IMAGE_REFERENCE_GUIDANCE = 'generate_image has two modes: from scratch (omit references) or based on 1–3 reference images (pass their handles such as ref1 from the image reference list, or project image paths such as img/hero.png, in references). When the user asks for an image based on, like, matching, edited from or restyled from an attached, earlier or mentioned image, or to keep the same person, product, character or scene, you MUST pass that reference; never drop it after a failed call. The prompt then states what to keep from the reference and what to change.';
const IMAGE_TOOL_DESCRIPTION = 'Generate an image requested by the user and add it to the draft only. Two modes: from scratch (omit references), or based on 1–3 reference images (references: handles such as ref1 from the image reference list, or project image paths such as img/hero.png, including images generated earlier in this run). You MUST pass references when the user asks to base an image on, match, edit, restyle or vary an attached, earlier or mentioned image, or to keep its person or product; the prompt then describes what to keep and what to change. If a reference is rejected, correct it from the listed handles instead of dropping it. Follow the image count in the user brief; generate no images when none are requested. Use its returned local path in an Image field or article. Do not regenerate existing assets.';

// The workflow creates one generateImage closure per run and shares it across
// writer passes. A denied request must not be repeated by subsequent revisions.
const terminalFailures = new WeakMap();

// Shared by content and source agents. Binary assets never pass through text tools.
export function draftImageTool({ generateImage, getFiles, commit, signal, onProgress }) {
  const pending = new Set();
  return tool({
    description: IMAGE_TOOL_DESCRIPTION,
    inputSchema: z.object({ path: z.string().describe('A new safe relative project PNG path, such as img/hero.png or assets/photos/hero.png.'), prompt: z.string().min(1).max(6000).describe('What to draw; with references, what to keep from them and what to change.'),
      references: z.array(z.string()).max(MAX_IMAGE_REFERENCES).optional().describe('0–3 image references the new image is based on: handles such as ref1 from the reference list, or project image paths such as img/hero.png. Omit to generate from scratch.'),
      referenceIds: z.array(z.string()).max(MAX_IMAGE_REFERENCES).optional().describe('Deprecated alias of references.') }),
    execute: async ({ path, prompt, references, referenceIds }) => {
      let reserved = false;
      try {
        signal?.throwIfAborted(); safePath(path);
        if (!/\.png$/i.test(path)) throw new Error('Use a new relative project path ending in .png.');
        if (Object.hasOwn(getFiles(), path) || pending.has(path)) throw new Error('This image path already exists. Reuse it or choose a new path.');
        if (terminalFailures.has(generateImage)) throw terminalFailures.get(generateImage);
        const tokens = references?.length ? references : referenceIds || [];
        // Resolve before the paid request: an unknown handle returns the valid ones to the model.
        const resolved = typeof generateImage.resolveReferences === 'function' ? generateImage.resolveReferences(tokens, getFiles()) : tokens.map(name => ({ name }));
        pending.add(path); reserved = true; onProgress?.({ type: 'image-start', path, references: resolved.length, referenceNames: resolved.map(item => item.name) });
        const bytes = await generateImage({ prompt, references: resolved, referenceIds: tokens, signal });
        signal?.throwIfAborted();
        const candidate = { ...getFiles(), [path]: bytes };
        validateProject(candidate); commit(candidate, path);
        return { ok: true, path, ...(resolved.length ? { references: resolved.length } : {}) };
      } catch (error) {
        const failure = normalizeAiProviderError(error);
        if (isTerminalImageError(failure)) terminalFailures.set(generateImage, failure);
        onProgress?.({ type: 'image-error', path, error: failure.message, statusCode: failure.statusCode, code: failure.code, provider: failure.provider, generationId: failure.generationId, retryable: failure.retryable, terminal: failure.terminalImage });
        if (signal?.aborted) throw failure;
        return { ok: false, error: failure.message, statusCode: failure.statusCode, retryable: failure.retryable, terminal: failure.terminalImage };
      }
      finally { if (reserved) pending.delete(path); }
    },
  });
}
