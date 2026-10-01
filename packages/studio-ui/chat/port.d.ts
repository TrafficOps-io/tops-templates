/** Контракт между продуктом и StudioChat. Никаких React- и assistant-ui-типов наружу: продукт отдаёт данные, пакет рендерит. */
export interface ReadableStore<T> { get(): T; subscribe(listener: (value: T) => void): () => void }

export type MentionKind = 'section' | 'scene' | 'track' | 'file' | 'asset' | 'field';
/** section: landing — секция превью, Media — область проекта; file — только landing; scene, track, asset — только Media. */
export interface MentionTarget { kind: MentionKind; id: string; label: string; detail?: string }

export type AttachmentType = 'image' | 'audio' | 'video' | 'document';
export interface Attachment { id: string; name: string; type: AttachmentType; bytes: number; url?: string }
export interface AttachmentLimits { count: number; bytesPerFile: number; bytesTotal: number; accept: string }

export type ScopeKind = 'project' | 'file' | 'block' | 'content' | 'discussion' | 'scene' | 'audio' | 'script';
export interface Scope { kind: ScopeKind; targetId?: string; label?: string }

export type RunStatus = 'queued' | 'running' | 'ready' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'applied' | 'discarded';
export interface RunState { id: string; status: RunStatus; progress?: number; etaSeconds?: number; step?: { current: number; total: number }; cost?: number; message?: string }

export type ResultCardType = 'diff' | 'values' | 'image' | 'audio' | 'video' | 'file' | 'operation' | 'question';
export interface DiffCard { type: 'diff'; path: string; added: number; removed: number; before: string; after: string }
export interface ValuesCard { type: 'values'; section: string; changes: { path: string; before: unknown; after: unknown }[] }
export interface ImageCard { type: 'image'; name: string; before?: string; after: string; variants?: string[]; width?: number; height?: number }
export interface AudioCard { type: 'audio'; name: string; url: string; durationMs: number; provider?: string; status?: 'generating' | 'ready' | 'failed'; progress?: number }
export interface VideoCard { type: 'video'; name: string; url: string; poster?: string; durationMs: number; width?: number; height?: number; provider?: string; cost?: number; status?: 'generating' | 'ready' | 'failed'; progress?: number }
export interface FileCard { type: 'file'; name: string; bytes: number; url?: string; raw?: unknown }
export interface OperationCard { type: 'operation'; label: string; target: MentionTarget; before?: string; after?: string }
export interface QuestionCard { type: 'question'; questionId: string; text: string; options?: string[]; answered?: boolean }
export type ResultCard = DiffCard | ValuesCard | ImageCard | AudioCard | VideoCard | FileCard | OperationCard | QuestionCard;

export type MessagePart = { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: ResultCardType; result: ResultCard };
export interface Message { id: string; role: 'user' | 'assistant'; createdAt: string; parts: MessagePart[]; status?: RunState; mentions?: MentionTarget[]; attachments?: Attachment[]; cost?: number }
export interface Thread { id: string; title: string; createdAt: string; updatedAt: string; archived?: boolean; cost?: number }

export type ChatEvent =
  | { type: 'text-delta'; messageId: string; delta: string }
  | { type: 'part-start'; messageId: string; part: MessagePart }
  | { type: 'part-update'; messageId: string; toolCallId: string; result: Partial<ResultCard> }
  | { type: 'part-done'; messageId: string; toolCallId: string }
  | { type: 'status'; messageId: string; status: RunState }
  | { type: 'error'; messageId?: string; code: 'conflict' | 'validation' | 'policy' | 'transport' | 'abort'; message: string };

export interface SendInput { text: string; mentions: MentionTarget[]; attachments: File[]; scope: Scope; generateImages?: boolean }
export interface ChatCapabilities { scopes: ScopeKind[]; cost: boolean; previewDraft: boolean; generateImages: boolean }

export interface ChatPort {
  threads: ReadableStore<Thread[]>;
  messages(threadId: string): ReadableStore<Message[]>;
  events(threadId: string): AsyncIterable<ChatEvent>;
  send(threadId: string, input: SendInput): Promise<void>;
  stop(runId: string): Promise<void>;
  apply(runId: string): Promise<void>;
  discard(runId: string): Promise<void>;
  previewDraft?(runId: string): Promise<void>;
  answer?(questionId: string, answer: string): Promise<void>;
  createThread(): Promise<Thread>;
  renameThread(threadId: string, title: string): Promise<void>;
  archiveThread(threadId: string, archived: boolean): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  mentionTargets(query: string, kind?: MentionKind): MentionTarget[];
  openTarget(target: MentionTarget): void;
  attachmentLimits: AttachmentLimits;
  capabilities: ChatCapabilities;
  portalContainer?: HTMLElement;
}
