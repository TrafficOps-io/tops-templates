import type { EditorHost, ProjectPort, AnalyzerPort, PreviewPort, LifecyclePort, AiPort, DialectDescriptor } from '@trafficops/template-editor-core';
import { createStudioHost } from '../src/hosts/StudioHost.js';
import { thirdHost } from './support/third-host.js';
import { createStudioAiPort } from '../src/hosts/StudioAiPort.js';
const third: EditorHost = thirdHost();
const userAi: AiPort = createStudioAiPort();
import { createHttpHost } from '../embedded/src/HttpHost.js';
const studio: EditorHost = createStudioHost();
const http: Promise<EditorHost> = createHttpHost({ endpoint: '/project', csrf: 'test' });
// The adapters are checked directly; these assertions prevent a disconnected
// declaration-only contract from passing while implementations drift.
const project: ProjectPort = studio.project;
const analyzer: AnalyzerPort = studio.analyzer;
http.then(host => {
  const preview: PreviewPort | undefined = host.preview;
  const lifecycle: LifecyclePort | undefined = host.lifecycle;
  const ai: AiPort | undefined = host.ai;
  return [preview, lifecycle, ai];
});
// @ts-expect-error revisions are optimistic tokens, not optional metadata.
project.save({ files: {} });
// @ts-expect-error every render names the content locale.
analyzer.render({} as Parameters<AnalyzerPort['render']>[0], {});
// @ts-expect-error host-managed settings cannot expose key mutation.
const settings: AiPort['settings'] = { owner: 'host', load: async () => ({configured: true, model: '', imageModel: ''}), test: async () => ({message: ''}), save: async () => ({}) };
// @ts-expect-error descriptor schema and whitelist must be explicit.
const dialect: DialectDescriptor = { id: 'safe-html-v1' };
void [project, analyzer, settings, dialect];
