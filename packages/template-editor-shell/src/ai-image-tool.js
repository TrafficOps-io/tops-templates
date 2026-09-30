import { tool } from 'ai';
import { z } from 'zod';
import { safePath, validateProject } from './project.js';

// Shared by content and source agents. Binary assets never pass through text tools.
export function draftImageTool({ generateImage, getFiles, commit, signal, onProgress }) {
  let attempted = 0;
  const pending = new Set();
  return tool({
    description: 'Generate an image requested by the user and add it to the draft only. Use its returned local path in an Image field or article. At most 4 image requests per run; do not regenerate existing assets. Reference IDs are optional and refer to attached images.',
    inputSchema: z.object({ path: z.string().describe('A new images/*.png path.'), prompt: z.string().min(1).max(6000), referenceIds: z.array(z.string()).max(4).default([]) }),
    execute: async ({ path, prompt, referenceIds }) => {
      try {
        signal?.throwIfAborted(); safePath(path);
        if (!/^images\/[a-zA-Z0-9_/-]+\.png$/.test(path)) throw new Error('Use a new images/*.png path.');
        if (Object.hasOwn(getFiles(), path) || pending.has(path)) throw new Error('This image path already exists. Reuse it or choose a new path.');
        if (++attempted > 4) throw new Error('The limit of 4 image requests per run was reached.');
        pending.add(path); onProgress?.({ type: 'image-start', path });
        const bytes = await generateImage({ prompt, referenceIds, signal });
        signal?.throwIfAborted();
        const candidate = { ...getFiles(), [path]: bytes };
        validateProject(candidate); commit(candidate, path);
        return { ok: true, path };
      } catch (error) { if (signal?.aborted) throw error; return { ok: false, error: error.message }; }
      finally { pending.delete(path); }
    },
  });
}
