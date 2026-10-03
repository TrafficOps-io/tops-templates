// Tests exercise the same published ZIPs that Studio downloads, without embedding a second catalog in JS.
import { readFileSync } from 'node:fs';
import { readZipProject } from '@trafficops/template-editor-core';
import { starterProject as blankProject } from '../../src/starter.js';
import { parseRepositoryIndex, repositoryTemplates } from '../../src/template-repositories.js';

const root = new URL('../../public/template-repositories/trafficops/', import.meta.url);
const catalog = parseRepositoryIndex(JSON.parse(readFileSync(new URL('index.json', root))), 'https://studio.example/template-repositories/trafficops/index.json');
export const studioStarters = repositoryTemplates({ id: 'trafficops', url: 'https://studio.example/template-repositories/trafficops/index.json', builtin: true, catalog }).map(template => {
  const archive = readZipProject(new Uint8Array(readFileSync(new URL(`${template.templateId}.zip`, root))));
  return { ...template, ...archive, files: { ...archive.files } };
});
export function starterProject(blank = false) {
  return blank ? blankProject() : structuredClone(studioStarters[0].files);
}
