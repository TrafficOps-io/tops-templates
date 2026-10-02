import { createAiDraftValidator } from '@trafficops/template-editor-shell/validate-ai-draft';
import { memoryFolderHost } from './folder-host.js';
const host = await memoryFolderHost(), state = await host.project.open();
export const validateDraft = createAiDraftValidator(host.analyzer, () => state);
