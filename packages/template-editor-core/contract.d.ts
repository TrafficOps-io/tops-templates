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
export interface Limits { count: number; file: number; text: number; total: number; archive: number; portableArchive: number }
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
  projectId?: string; contentRevision?: number; appliedAiRuns?: string[];
  name: string; revision: Revision; files: ProjectFiles; folders: string[];
  entrypoint: string | null; locale: string; translations: Record<string, Values>;
  status: string; availability: { inlinePreview: boolean; externalPreview: boolean; ai: boolean };
  actions: ActionDescriptor[]; history: HistoryGroup[]; analysis?: Analysis;
}
export interface OperationOptions { signal?: AbortSignal }
export interface LocaleOptions extends OperationOptions { locale: string }
export interface PortableMetadata { schema: 1; projectId: string; kind: 'landing' | 'template'; name: string; contentRevision: number; metadataRevision: number; createdAt?: number; sourceTemplateId?: string; appliedAiRuns?: string[]; contentHash?: string }
export interface ConversationEntry { id: string; [key: string]: any }
export interface ConversationDocument { schema: 1; projectId: string; revision: number; threads: ConversationEntry[]; runs: ConversationEntry[]; storageWarning?: string; [key: string]: any }
/** Conversation revisions are independent of project content and published versions. */
export interface ConversationPort { readonly projectId: string; load(): Promise<ConversationDocument>; save(document: ConversationDocument, options: { expectedRevision: number }): Promise<ConversationDocument>; subscribe?(listener: (document: ConversationDocument) => void): () => void }
/** One dialogue file of folder format v1; large values are { $trafficopsBlob, encoding, size, mime? } references. */
export interface ConversationThreadFile { schema: 1; id: string; revision: number; title?: string; updatedAt?: number; createdBy?: { id: string; name: string }; messages: ConversationEntry[]; runs: ConversationEntry[]; [key: string]: any }
export interface ConversationStore {
  listThreads(options?: { signal?: AbortSignal }): Promise<ConversationThreadFile[]>;
  /** expectedRevision 0 creates; a mismatch rejects with ConflictError. The body revision is ignored. */
  writeThread(thread: ConversationThreadFile, options: { expectedRevision: number; signal?: AbortSignal }): Promise<{ revision: number }>;
  /** A missing thread resolves. */
  deleteThread(id: string, options: { expectedRevision: number; signal?: AbortSignal }): Promise<void>;
  putBlob(sha256: string, bytes: Uint8Array, options?: { signal?: AbortSignal }): Promise<void>;
  getBlob(sha256: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  watch?(onChange: () => void): () => void;
  /** References are computed from persisted threads; unreferenced blobs inside the grace period are kept. */
  collectGarbage?(options?: { signal?: AbortSignal }): Promise<void>;
}
/** Editable-ZIP history in the folder layout: validated split dialogue files and their blobs by sha256. */
export interface ConversationFiles { threads: ConversationThreadFile[]; blobs: Map<string, Uint8Array> }
/** history: Studio's editable-project import. Allows LIMITS.portableArchive and `.trafficops/conversations/**` entries. */
export interface ZipReadOptions { history?: boolean }
export interface ImportedProject { files: ProjectFiles; folders: string[]; settings: Values; entrypoint?: string | null; metadata?: PortableMetadata; conversations?: ConversationDocument; conversationFiles?: ConversationFiles }
export interface ExportOptions extends LocaleOptions { format: 'source' | 'html'; continueUrl?: string; history?: HistoryTarget; includeHistory?: boolean }
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
export type ValuePath = (string | number)[];
export interface PreviewBlockSource { id: string; label: string; path: string; start: number; end: number; content: string }
export interface PreviewBlockInstance { id: string; sourceId: string; label: string; page: string; parentId?: string; valuePaths: ValuePath[] }
export interface PreviewValueUse { path: ValuePath; instanceIds: string[]; page: string; control?: boolean }
/** Source/value provenance stays in the parent; only display identifiers enter the iframe. */
export interface PreviewSelection { version: 1; token: string; blockSources: PreviewBlockSource[]; blockInstances: PreviewBlockInstance[]; valueUses: PreviewValueUse[] }
export interface BlockEditScope {
  version: 1; page: string; locale: string; blockSources: PreviewBlockSource[];
  blockInstances: (Omit<PreviewBlockInstance, 'valuePaths'> & { valuePaths: (ValuePath | string)[] })[];
  valueUses: (Omit<PreviewValueUse, 'path'> & { path: ValuePath | string })[];
  selectedInstanceIds: string[]; baselineFiles?: ProjectFiles; baselineRawValues?: Values;
  baselineEffectiveValues?: Values; intent?: 'source' | 'content' | 'mixed';
}
/** A host-owned interactive frame. It never runs with the editor's origin. */
export interface PreviewFrame { html?: string; url?: string; id?: string; page: string; readyToken?: string; selection?: PreviewSelection; dispose?(): void }
export interface LivePreviewPort {
  render(state: ProjectState, options: LocaleOptions & { page?: string; keepRevisionId?: string }): Promise<PreviewFrame>;
  dispose?(): void | Promise<void>;
}
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
export interface AiAttachment { id: string; name: string; mime: string; dataUrl: string; useOnPage: boolean }
export interface InitialAiRequest { attachments?: AiAttachment[]; generateImages?: boolean; id: string; prompt: string; mode: 'create' | 'edit'; autoStart: boolean; claim(options?: OperationOptions): Promise<boolean> }
/** Completed draft data only; connections and provider diagnostics never enter recovery. */
export interface AiRecoveryDraft { token: string; kind: 'create' | 'edit' | 'content'; prompt: string; clarifications?: string[]; generateImages?: boolean; editScope?: BlockEditScope; attachments: AiAttachment[]; files: ProjectFiles; values: Values; valid: boolean; steps: number; summary: string }
export interface AiRecoveryRecord extends AiRecoveryDraft { projectId: string; baseRevision: number }
export interface AiRecoveryPort {
  load(): Promise<{ record: AiRecoveryRecord; conflict: boolean } | null>;
  save(draft: AiRecoveryDraft): Promise<AiRecoveryRecord>;
  applied(token: string): Promise<void>;
  discard(token: string): Promise<void>;
  export(token: string): Promise<Download>;
  download(draft: AiRecoveryDraft): Promise<Download>;
  subscribe?(listener: (message: string) => void): () => void;
}
export interface AiOperationOptions extends OperationOptions { runId?: string }
export interface AiPort { begin(options?: AiOperationOptions): Promise<AiConnection>; finish(options?: AiOperationOptions): Promise<void>; settings: UserAiSettings | HostAiSettings; initialRequest?: InitialAiRequest; recovery?: AiRecoveryPort }
export interface Capabilities {
  inlinePreview: boolean; preview: boolean; lifecycle: boolean; ai: boolean;
  locales: boolean; entrypoint: boolean; autosave: boolean; sourceExport: boolean; htmlExport: boolean;
}
export interface EditorHost {
  language: string; messages: Record<string, string>; capabilities: Readonly<Capabilities>;
  dialect: DialectDescriptor; project: ProjectPort; analyzer: AnalyzerPort;
  preview?: PreviewPort; livePreview?: LivePreviewPort; lifecycle?: LifecyclePort; ai?: AiPort;
  conversations?: ConversationPort;
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
export function readZip(bytes: Uint8Array, options?: ZipReadOptions): ProjectFiles;
export function readZipProject(bytes: Uint8Array, options?: ZipReadOptions): ImportedProject;
export function inspectZip(bytes: Uint8Array, options?: ZipReadOptions): Map<string, { size: number; directory: boolean; kind: 'user' | 'sidecar' | 'thread' | 'blob' | 'historyFolder' }>;
export const CONVERSATION_LIMITS: Readonly<{ threads: number; runs: number; messages: number; total: number; nodes: number; depth: number; encoded: number; threadEncoded: number; blob: number }>;
export function clonePortablePayload<T>(value: T): T;
export function validateConversationDocument(value: unknown, expectedProjectId?: string): ConversationDocument;
export const BLOB_TAG: '$trafficopsBlob';
export interface ConversationSplitCache { readonly runs: Map<string, unknown>; readonly attachments: Map<string, unknown> }
export function createSplitCache(): ConversationSplitCache;
export function seedSplitCache(cache: ConversationSplitCache, thread: ConversationThreadFile): ConversationSplitCache;
export function threadsOf(document: ConversationDocument): ConversationThreadFile[];
export function documentOf(projectId: string, threads: ConversationThreadFile[], revision: number): ConversationDocument;
export function threadHash(thread: ConversationThreadFile): Promise<string>;
export function sha256Hex(bytes: Uint8Array): Promise<string>;
export function blobReferences(value: unknown, found?: Set<string>): Set<string>;
export function validateBlobRef<T>(value: T): T;
export function toBase64(bytes: Uint8Array): string;
export function fromBase64(text: string): Uint8Array;
export function canonicalJson(value: unknown): string;
// The './conversation-store-contract' subpath is test tooling and stays untyped (JS only).
export function createStoreConversationPort(store: ConversationStore, options: { projectId: string; hashBlob?: (bytes: Uint8Array) => Promise<string>; onError?: (error: unknown) => void; now?: () => number }): ConversationPort;
export function createMemoryConversationStore(options?: { now?: () => number; graceMs?: number; refreshMs?: number }): ConversationStore;
export function splitThread(thread: ConversationThreadFile, options?: { cache?: ConversationSplitCache; nextCache?: ConversationSplitCache; hash?: (bytes: Uint8Array) => Promise<string> }): Promise<{ thread: ConversationThreadFile; blobs: Map<string, Uint8Array> }>;
export function joinThread(thread: ConversationThreadFile, getBlob: (sha256: string) => Uint8Array | Promise<Uint8Array>): Promise<ConversationThreadFile>;
export function validateThreadFile(value: unknown): ConversationThreadFile;
/** `<id>.json` for ids matching /^[a-z0-9_-]{1,200}$/, else `~<sha256 hex of the UTF-8 id>.json`. */
export function conversationThreadFileName(id: string): string;
export function conversationFilesFromDocument(document: ConversationDocument): Promise<ConversationFiles>;
/** Verifies blob hashes and joins; threads in the result carry no store revision. */
export function conversationDocumentFromFiles(files: { threads: ConversationThreadFile[]; blobs: Map<string, Uint8Array> | Record<string, Uint8Array> }, projectId: string): Promise<ConversationDocument>;
export function validatePortableMetadata(value: unknown): PortableMetadata;
export function encodePortablePayload(value: unknown): string;
export function decodePortablePayload(text: string): any;
export function createZip(files: ProjectFiles, options?: { generated?: boolean; directories?: string[]; settings?: Values; metadata?: PortableMetadata; conversations?: ConversationDocument; conversationFiles?: ConversationFiles }): Uint8Array;
export function renameFile(files: ProjectFiles, from: string, to: string): ProjectFiles;
export function encodeProject(files: ProjectFiles): Record<string, { text: string } | { base64: string }>;
export function decodeProject(files: Record<string, { text: string } | { base64: string }>): ProjectFiles;
export function inputValues(definition: TemplateDefinition | null, saved?: Values): Values;
export function changedProjectFiles(files: ProjectFiles, baseline?: ProjectFiles): Record<string, 'added' | 'modified'>;
export function moveEntry(files: ProjectFiles, folders: string[], entry: { path: string }, destination: string): { files: ProjectFiles; folders: string[] };
export function readUploads(list: { name: string; arrayBuffer(): Promise<ArrayBuffer> }[], folder: string, files: ProjectFiles): Promise<ProjectFiles>;
