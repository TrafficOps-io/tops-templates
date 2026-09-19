/** Every value crossing the host boundary is declared here. No React or compiler types. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Values = { [key: string]: Json };
export type ProjectFiles = Record<string, string | Uint8Array>;
export type Revision = string | number;
export type ErrorCode = 'conflict' | 'validation' | 'policy' | 'transport' | 'abort';
export interface SourceDiagnostic { file: string | null; line: number | null; column?: number; message: string; code?: string }
export interface FieldDiagnostic { locale: string; section: string; sectionLabel?: string; path: string; label: string; message: string; code?: string }
export interface ErrorDetails { cause?: unknown; diagnostics?: FieldDiagnostic[]; sourceDiagnostics?: SourceDiagnostic[]; status?: number }
export class EditorError extends Error { constructor(code: ErrorCode, message: string, details?: ErrorDetails); code: ErrorCode; diagnostics: FieldDiagnostic[]; sourceDiagnostics: SourceDiagnostic[]; status?: number }
export class ConflictError extends EditorError { constructor(message?: string, details?: ErrorDetails) }
export class ValidationError extends EditorError { constructor(message?: string, details?: ErrorDetails) }
export class PolicyError extends EditorError { constructor(message?: string, details?: ErrorDetails) }
export class TransportError extends EditorError { constructor(message?: string, details?: ErrorDetails) }
export class AbortError extends EditorError { constructor(message?: string, details?: ErrorDetails) }
export function normalizeError(error: unknown, fallback?: ErrorCode): EditorError;
export function throwIfAborted(signal?: AbortSignal): void;
export function runOperation<T>(signal: AbortSignal | undefined, operation: () => T | Promise<T>, fallback?: ErrorCode): Promise<T>;
export interface Limits { count: number; file: number; text: number; total: number; archive: number }
export interface DialectDescriptor { schema: 1; id: string; allowedEntrypoints: readonly string[]; limits: Limits }
export function validateDialectDescriptor(descriptor: unknown, knownIds: Iterable<string>): descriptor is DialectDescriptor;
export interface FieldDefinition {
  name: string; type: string; label?: string; help?: string; default?: Json; required?: boolean;
  fields?: FieldDefinition[]; options?: Record<string, string>;
  min?: number; max?: number; step?: number; min_items?: number; max_items?: number;
  aspect_ratio?: number; sizes?: { width: number; height: number; label?: string }[]; aiInstructions?: string;
}
export interface SectionDefinition { id: string; label: string; fields: FieldDefinition[] }
export interface TemplateDefinition { version: number; name: string; description?: string; sections: SectionDefinition[]; html: string; pages?: Record<string, string> }
export interface Analysis {
  definition: TemplateDefinition | null; entrypoint: string | null; pages: string[];
  diagnostics: FieldDiagnostic[]; sourceDiagnostics: SourceDiagnostic[]; previewAvailable: boolean;
}
export interface ActionDescriptor { id: string; label: string; intent?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; confirmation?: string; input?: { label: string; value?: string; maxLength?: number; help?: string } }
export interface HistoryTarget { group: string; id: string }
export interface HistoryAction extends ActionDescriptor { operation: 'preview' | 'export' | 'lifecycle'; target: HistoryTarget; format?: 'source' | 'html'; url?: string }
export interface HistoryRow { id: string; title: string; badge?: string; meta: string[]; actions: HistoryAction[] }
export interface HistoryGroup { id: string; label: string; count: number; rows: HistoryRow[]; empty: { title: string; description: string } }
export interface ProjectState {
  name: string; revision: Revision; files: ProjectFiles; folders: string[];
  entrypoint: string | null; locale: string; translations: Record<string, Values>;
  status: string; availability: { inlinePreview: boolean; externalPreview: boolean; ai: boolean };
  actions: ActionDescriptor[]; history: HistoryGroup[]; analysis?: Analysis;
}
export interface OperationOptions { signal?: AbortSignal }
export interface LocaleOptions extends OperationOptions { locale: string }
export interface ImportedProject { files: ProjectFiles; folders: string[]; settings: Values; entrypoint?: string | null }
export interface ExportOptions extends LocaleOptions { format: 'source' | 'html'; continueUrl?: string; history?: HistoryTarget }
export interface Download { name: string; bytes: Uint8Array; mime: string }
export interface ProjectPort {
  open(options?: OperationOptions): Promise<ProjectState>;
  save(state: ProjectState, options?: OperationOptions): Promise<ProjectState>;
  import(bytes: Uint8Array, options?: OperationOptions): Promise<ImportedProject>;
  export(state: ProjectState, options: ExportOptions): Promise<Download>;
}
export interface AnalyzerPort {
  analyze(state: ProjectState, options?: OperationOptions): Promise<Analysis>;
  render(state: ProjectState, options: LocaleOptions): Promise<ProjectFiles>;
}
export interface SharedPreview { id: string; url: string; expiresAt?: string }
export interface PreviewPort {
  create(state: ProjectState, options: LocaleOptions & { shared?: boolean }): Promise<SharedPreview>;
  revoke(preview: SharedPreview, options?: OperationOptions): Promise<void>;
  history(target: HistoryTarget, options: LocaleOptions): Promise<SharedPreview>;
}
export interface LifecycleResult { state: ProjectState; persisted: boolean; notice: string }
export interface LifecyclePort {
  run(action: string, state: ProjectState, options: LocaleOptions & { target?: HistoryTarget; inputValue?: string }): Promise<LifecycleResult>;
}
export interface AiSettings { configured: boolean; model: string; imageModel: string; apiKey?: string }
export interface AiConnection extends AiSettings { apiKey: string; fetchImpl: typeof fetch; timeoutMs?: number }
export interface AiSettingsBase { load(options?: OperationOptions): Promise<AiSettings>; test(options?: OperationOptions): Promise<{ message: string }> }
export interface UserAiSettings extends AiSettingsBase { owner: 'user'; save(settings: AiSettings, options?: OperationOptions): Promise<AiSettings>; remove(options?: OperationOptions): Promise<void> }
export interface HostAiSettings extends AiSettingsBase { owner: 'host'; url?: string }
export interface InitialAiRequest { id: string; prompt: string; mode: 'create' | 'edit'; autoStart: boolean; claim(options?: OperationOptions): Promise<boolean> }
export interface AiPort { begin(options?: OperationOptions): Promise<AiConnection>; finish(options?: OperationOptions): Promise<void>; settings: UserAiSettings | HostAiSettings; initialRequest?: InitialAiRequest }
export interface Capabilities {
  inlinePreview: boolean; preview: boolean; lifecycle: boolean; ai: boolean;
  locales: boolean; entrypoint: boolean; autosave: boolean; sourceExport: boolean; htmlExport: boolean;
}
export interface EditorHost {
  language: string; messages: Record<string, string>; capabilities: Readonly<Capabilities>;
  dialect: DialectDescriptor; project: ProjectPort; analyzer: AnalyzerPort;
  preview?: PreviewPort; lifecycle?: LifecyclePort; ai?: AiPort;
  dispose?(): void | Promise<void>;
}
export type HostFactory = () => EditorHost | Promise<EditorHost>;
export interface ConformanceOptions { knownIds: Iterable<string>; faults?: Partial<Record<ErrorCode, (host: EditorHost) => Promise<unknown>>> }
export function runHostConformance(factory: HostFactory, options: ConformanceOptions): Promise<{ checks: string[] }>;
export const LIMITS: Readonly<Limits>;
export function safePath(path: string): string;
export function isTemplate(path: string): boolean;
export function isText(path: string): boolean;
export function byteSize(value: string | Uint8Array): number;
export function contentsEqual(left: string | Uint8Array, right: string | Uint8Array): boolean;
export function outputPath(path: string): string;
export function validateProject<T extends ProjectFiles>(files: T, options?: { generated?: boolean }): T;
export function validateFolders(files: ProjectFiles, folders?: string[]): string[];
export function projectFolders(files: ProjectFiles, folders?: string[]): string[];
export function readZip(bytes: Uint8Array): ProjectFiles;
export function readZipProject(bytes: Uint8Array): ImportedProject;
export function inspectZip(bytes: Uint8Array): Map<string, { size: number; directory: boolean }>;
export function createZip(files: ProjectFiles, options?: { generated?: boolean; directories?: string[]; settings?: Values }): Uint8Array;
export function renameFile(files: ProjectFiles, from: string, to: string): ProjectFiles;
export function encodeProject(files: ProjectFiles): Record<string, { text: string } | { base64: string }>;
export function decodeProject(files: Record<string, { text: string } | { base64: string }>): ProjectFiles;
export function inputValues(definition: TemplateDefinition | null, saved?: Values): Values;
export function changedProjectFiles(files: ProjectFiles, baseline?: ProjectFiles): Record<string, 'added' | 'modified'>;
export function moveEntry(files: ProjectFiles, folders: string[], entry: { path: string }, destination: string): { files: ProjectFiles; folders: string[] };
export function readUploads(list: { name: string; arrayBuffer(): Promise<ArrayBuffer> }[], folder: string, files: ProjectFiles): Promise<ProjectFiles>;
