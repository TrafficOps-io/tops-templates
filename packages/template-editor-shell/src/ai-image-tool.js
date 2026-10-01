import { tool } from 'ai';
import { z } from 'zod';
import { safePath, validateProject } from './project.js';
import { normalizeAiProviderError, isTerminalImageError } from './ai-provider-errors.js';

// The workflow creates one generateImage closure per run and shares it across
// writer passes. A denied request must not be repeated by subsequent revisions.
const terminalFailures = new WeakMap();

// Shared by content and source agents. Binary assets never pass through text tools.
export function draftImageTool({ generateImage, getFiles, commit, signal, onProgress }) {
  const pending = new Set();
  return tool({
    description: 'Generate an image requested by the user and add it to the draft only. Follow the image count in the user brief; generate no images when none are requested. Use its returned local path in an Image field or article. Do not regenerate existing assets. Reference IDs are optional and refer to attached images.',
    inputSchema: z.object({ path: z.string().describe('A new safe relative project PNG path, such as img/hero.png or assets/photos/hero.png.'), prompt: z.string().min(1).max(6000), referenceIds: z.array(z.string()).max(4).default([]) }),
    execute: async ({ path, prompt, referenceIds }) => {
      let reserved = false;
      try {
        signal?.throwIfAborted(); safePath(path);
        if (!/\.png$/i.test(path)) throw new Error('Use a new relative project path ending in .png.');
        if (Object.hasOwn(getFiles(), path) || pending.has(path)) throw new Error('This image path already exists. Reuse it or choose a new path.');
        if (terminalFailures.has(generateImage)) throw terminalFailures.get(generateImage);
        pending.add(path); reserved = true; onProgress?.({ type: 'image-start', path });
        const bytes = await generateImage({ prompt, referenceIds, signal });
        signal?.throwIfAborted();
        const candidate = { ...getFiles(), [path]: bytes };
        validateProject(candidate); commit(candidate, path);
        return { ok: true, path };
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
