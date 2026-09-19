import { LIMITS } from './project.js';

// Studio is its own host; imported source files cannot choose this policy.
export const studioDialect = Object.freeze({ schema: 1, id: 'safe-html-v1', allowedEntrypoints: Object.freeze(['index.html']), limits: LIMITS });
