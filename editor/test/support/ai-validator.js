import { createStudioHost } from '../../src/hosts/StudioHost.js';
import { createAiDraftValidator } from '@trafficops/template-editor-shell/validate-ai-draft';
const host = createStudioHost(), state = await host.project.open();
export const validateDraft = createAiDraftValidator(host.analyzer, () => state);
