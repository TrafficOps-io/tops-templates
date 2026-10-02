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

export type ResultCardType = 'diff' | 'values' | 'image' | 'audio' | 'video' | 'file' | 'operation' | 'question' | 'step';
export interface DiffCard { type: 'diff'; path: string; added: number; removed: number; before: string; after: string }
export interface ValuesCard { type: 'values'; section: string; changes: { path: string; before: unknown; after: unknown }[] }
export interface ImageCard { type: 'image'; name: string; before?: string; after: string; variants?: string[]; width?: number; height?: number; cost?: number }
/** url и durationMs обязательны при status 'ready' (или без status); при 'generating'/'failed' могут отсутствовать. */
export interface AudioCard { type: 'audio'; name: string; url?: string; durationMs?: number; provider?: string; cost?: number; status?: 'generating' | 'ready' | 'failed'; progress?: number }
/** url и durationMs обязательны при status 'ready' (или без status); при 'generating'/'failed' могут отсутствовать. */
export interface VideoCard { type: 'video'; name: string; url?: string; poster?: string; durationMs?: number; width?: number; height?: number; provider?: string; cost?: number; status?: 'generating' | 'ready' | 'failed'; progress?: number }
export interface FileCard { type: 'file'; name: string; bytes: number; url?: string; raw?: unknown }
export interface OperationCard { type: 'operation'; label: string; target: MentionTarget; before?: string; after?: string }
/** kind 'conflict' с options ['reviewed', 'rebase'] — ворота применения (landing); references — затронутые пути/цели. */
export interface QuestionCard { type: 'question'; questionId: string; text: string; options?: string[]; answered?: boolean; kind?: 'conflict'; references?: string[] }
/**
 * Шаг агента (как в Claude Code): компактная строка «✓ Прочитал сцену 2», «⟳ Подагент storyboard: раскадровка»,
 * «✗ edit_track: durationMs должен быть > 0 (исправляю)». label — что делает шаг; detail — приглушённое пояснение
 * (ошибка инструмента, итог); agent — имя подагента, если шаг выполняет он. Не черновик: Apply/Discard от него не зависят.
 */
export interface StepCard { type: 'step'; label: string; status: 'running' | 'done' | 'error'; detail?: string; agent?: string }
export type ResultCard = DiffCard | ValuesCard | ImageCard | AudioCard | VideoCard | FileCard | OperationCard | QuestionCard | StepCard;

/**
 * Правила контракта:
 * - toolCallId детерминирован и уникален в пределах сообщения (нужен для part-update и стабильных ключей React).
 *   Рекомендуемая форма — `${messageId}:${index}` по позиции части в parts, но порт вправе выбрать другой стабильный ключ
 *   (landing использует путь файла: `r1:diff:index.tpl`). StudioChat сравнивает toolCallId только на равенство.
 * - RunState.id равен id сообщения ассистента (иначе stop/apply/discard(runId) не находят сообщение).
 */
export type MessagePart = { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: ResultCardType; result: ResultCard };
/**
 * Положение сообщения среди соседей — сообщений с тем же parentId (ответы на одно сообщение, правки одного вопроса).
 * index — с нуля; count — число соседей вместе с этим сообщением; siblingIds — id соседей по порядку, siblingIds[index] === id.
 */
export interface MessageBranch { index: number; count: number; siblingIds: string[] }
/**
 * parentId — родитель в дереве диалога (null у первого сообщения). Дерево хранит порт: messages(threadId) отдаёт
 * видимый путь — линейный список от корня до текущего листа; StudioChat показывает переключатель веток при branch.count > 1.
 */
export interface Message { id: string; role: 'user' | 'assistant'; createdAt: string; parts: MessagePart[]; status?: RunState; mentions?: MentionTarget[]; attachments?: Attachment[]; cost?: number; parentId?: string | null; branch?: MessageBranch }
/** cost — итог за диалог (ChatHeader), считает порт. */
export interface Thread { id: string; title: string; createdAt: string; updatedAt: string; archived?: boolean; cost?: number }

export type ChatEvent =
  | { type: 'text-delta'; messageId: string; delta: string }
  | { type: 'part-start'; messageId: string; part: MessagePart }
  | { type: 'part-update'; messageId: string; toolCallId: string; result: Partial<ResultCard> }
  | { type: 'part-done'; messageId: string; toolCallId: string }
  | { type: 'status'; messageId: string; status: RunState }
  | { type: 'error'; messageId?: string; code: 'conflict' | 'validation' | 'policy' | 'transport' | 'abort'; message: string };

/** mode — продуктовое поле (landing: «создать проект заново»); StudioChat его не читает. */
export interface SendInput { text: string; mentions: MentionTarget[]; attachments: File[]; scope: Scope; generateImages?: boolean; mode?: 'create' }
/**
 * keepDraft — landing: «Keep draft in editor» для failed/interrupted ранов; conflictReview — порт присылает QuestionCard kind 'conflict';
 * clarifyWhileRunning — порт принимает send() во время рана как уточнение этого рана (тот же тред): композер не блокируется.
 * discardStopped — порт принимает discard() для failed/interrupted/cancelled ранов: «Discard» у такого рана, если у сообщения есть карточки черновика (diff/values/image/file).
 * regenerate, edit, branches — порт поддерживает повтор ответа, правку сообщения пользователя и переключение веток. Кнопки
 * показываются, когда порт реализует метод (regenerate, editMessage, switchBranch) и флаг не равен false; false скрывает их
 * при наличии метода (например, тред только для чтения).
 */
export interface ChatCapabilities { scopes: ScopeKind[]; cost: boolean; previewDraft: boolean; generateImages: boolean; conflictReview?: boolean; keepDraft?: boolean; clarifyWhileRunning?: boolean; discardStopped?: boolean; regenerate?: boolean; edit?: boolean; branches?: boolean }

/** Продуктовые методы (например registerBlockScope) в контракт не входят — они остаются на объекте адаптера. */
export interface ChatPort {
  threads: ReadableStore<Thread[]>;
  messages(threadId: string): ReadableStore<Message[]>;
  events(threadId: string): AsyncIterable<ChatEvent>;
  send(threadId: string, input: SendInput): Promise<void>;
  stop(runId: string): Promise<void>;
  /** runId везде — RunState.id, он же id сообщения ассистента. */
  apply(runId: string, options?: { allowStaleContext?: boolean }): Promise<void>;
  discard(runId: string): Promise<void>;
  previewDraft?(runId: string): Promise<void>;
  answer?(questionId: string, answer: string): Promise<void>;
  continueRun?(runId: string, prompt?: string): Promise<void>;
  /** Перенести черновик рана в редактор без применения (landing). */
  keepDraft?(runId: string): Promise<void>;
  /**
   * Повторить ответ: messageId — сообщение ассистента. Порт создаёт соседа-ассистента (тот же parentId), делает его ветку
   * видимой и запускает ран. Это же «Повторить» у упавшего, остановленного или прерванного рана.
   */
  regenerate?(threadId: string, messageId: string): Promise<void>;
  /**
   * Изменить сообщение пользователя: создаёт соседа-пользователя (тот же parentId, упоминания и вложения исходного,
   * новый текст), делает его ветку видимой и запускает новый ран после него.
   */
  editMessage?(threadId: string, messageId: string, input: { text: string }): Promise<void>;
  /** Сделать видимой ветку, содержащую messageId: порт идёт от него до самого свежего листа и обновляет messages(threadId). */
  switchBranch?(threadId: string, messageId: string): Promise<void>;
  createThread(): Promise<Thread>;
  renameThread(threadId: string, title: string): Promise<void>;
  archiveThread(threadId: string, archived: boolean): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  mentionTargets(query: string, kind?: MentionKind): MentionTarget[];
  openTarget(target: MentionTarget): void;
  attachmentLimits: AttachmentLimits;
  capabilities: ChatCapabilities;
  portalContainer?: HTMLElement;
  /** Освободить подписки и соединения порта (EventSource и т. п.). */
  dispose?(): void;
}
