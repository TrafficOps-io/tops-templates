import { useEffect, useState } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import { AssistantRuntimeProvider, AuiIf, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import EmptyState from '../primitives/EmptyState.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import { useChatRuntime } from './useChatRuntime.js';
import { sendToPort } from './chat-model.js';
import { ChatDraftContext } from './RunActions.jsx';
import { ChatComposerContext } from './Composer.jsx';
import { ChatThreadContext } from './MessageActions.jsx';
import Composer from './Composer.jsx';
import { AssistantMessage, UserMessage } from './Messages.jsx';
import ThreadList from './ThreadList.jsx';
import ChatHeader from './ChatHeader.jsx';

const defaultScope = port => ({ kind: port.capabilities?.scopes?.includes('project') || !port.capabilities?.scopes?.length ? 'project' : port.capabilities.scopes[0] });

// StudioChat — chat UI on assistant-ui primitives over a ChatPort (chat/port.d.ts).
//
// port: ChatPort; threadId?: string; onThreadChange?(id) — '' or no threadId is a new conversation, created on the first send;
// launch?: { id, text?, scope?, mentions?, attachments?: File[] } — external launch: an effect keyed on launch.id resets the composer and fills text, scope, mention targets and files;
// actions?: { id, label, danger?, onSelect({ text }) }[] — menu items in the thread header (product actions, e.g. "Create the project anew");
// onScopeChange?(scope) — called on a scope chip change (including its removal) and on every launch, including a launch present
// at mount and a launch that resets the scope to the default; without a launch it is not called on mount;
// disabled?: boolean; footer?: ReactNode; emptyState?: ReactNode; className?: string;
// composerExtra?: ReactNode — product controls in the composer toolbar (Composer extra), e.g. a compact ModelPicker
// Errors (send, thread and card actions) are inline notices; no ToastProvider is needed.
export default function StudioChat({ port, threadId = '', onThreadChange, onScopeChange, launch, actions = [], disabled = false, footer, emptyState, composerExtra, className = '' }) {
  const t = useStudioText();
  const [text, setText] = useState(''), [scope, setScope] = useState(() => defaultScope(port)), [mentions, setMentions] = useState([]), [attachments, setAttachments] = useState([]), [generateImages, setGenerateImages] = useState(false);
  const [notice, setNotice] = useState(null); // { title, message }
  const report = title => cause => setNotice({ title, message: cause?.message || t('Something went wrong.') });
  const sendFailed = report(t('The message was not sent')), actionFailed = report(t('The action failed'));
  const changeScope = next => { setScope(next); onScopeChange?.(next); };

  // External launch: each new launch.id resets the composer and fills text, scope, mention targets and files
  // (Media Studio passes the home screen input here, Landing — a launch from a preview block).
  useEffect(() => {
    if (!launch) return;
    setText(launch.text || ''); changeScope(launch.scope || defaultScope(port)); setMentions(launch.mentions || []); setAttachments(launch.attachments || []); setNotice(null);
  }, [launch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { setText(''); setMentions([]); setAttachments([]); setNotice(null); };
  // A rejected send gives the composer its text, mentions and files back unless the user has started a new message.
  const restore = input => {
    setText(current => (current.trim() ? current : input.text));
    setMentions(current => (current.length ? current : input.mentions));
    setAttachments(current => (current.length ? current : input.attachments));
  };
  const runtime = useChatRuntime(port, threadId, { scope, mentions, attachments, generateImages, onSent: clear, onThreadCreated: onThreadChange, onRestore: restore, onError: sendFailed, onActionError: actionFailed });
  const thread = { port, threadId, onError: actionFailed };

  // The composer sends here instead of composer.send(): the input is cleared at once and restored if the port rejects it,
  // a thread created for a rejected send is removed (sendToPort), and with capabilities.clarifyWhileRunning a message
  // sent during a run goes to the same thread as a clarification. Attachments-only messages take the same path.
  function submitMessage(value) {
    const input = { text: value.trim() ? value : '', mentions, attachments, scope, generateImages };
    clear();
    return sendToPort(port, threadId, input, { onThreadCreated: onThreadChange, onRestore: restore, onError: sendFailed });
  }
  const draft = { text, clear: () => setText('') };
  async function createThread() {
    try { const thread = await port.createThread(); onThreadChange?.(thread.id); } catch (cause) { actionFailed(cause); }
  }

  return <div className={`studio-chat ${className}`.trim()} data-testid="studio-chat">
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="studio-chat-layout">
        <aside className="studio-chat-threads" data-testid="studio-chat-threads">
          <RunningThreadList port={port} threadId={threadId} onThreadChange={onThreadChange} onCreate={createThread} onError={actionFailed} />
        </aside>
        <section className="studio-chat-main" aria-label={t('Project assistant')}>
          <ChatHeader port={port} threadId={threadId} onThreadChange={onThreadChange} onCreate={createThread} actions={actions} composerText={text} onError={actionFailed} />
          <ThreadPrimitive.Root className="studio-chat-thread">
            <ChatDraftContext.Provider value={draft}><ChatThreadContext.Provider value={thread}>
            <ThreadPrimitive.Viewport className="studio-chat-feed" data-testid="studio-chat-feed">
              <AuiIf condition={state => state.thread.isEmpty}>{emptyState || <EmptyState icon={Sparkles} title={t('What shall we create?')} description={t('Describe an idea or a change. Mention sections, scenes and files with @.')} />}</AuiIf>
              <ThreadPrimitive.Messages>{({ message }) => message.role === 'user' ? <UserMessage port={port} /> : <AssistantMessage port={port} />}</ThreadPrimitive.Messages>
            </ThreadPrimitive.Viewport>
            </ChatThreadContext.Provider></ChatDraftContext.Provider>
            <div className="studio-chat-bottom">
              <ThreadPrimitive.ScrollToBottom className="studio-chat-scroll-bottom" aria-label={t('Scroll to the latest message')} title={t('Scroll to the latest message')}><ArrowDown size={16} aria-hidden="true" /></ThreadPrimitive.ScrollToBottom>
              {notice && <InlineNotice tone="danger" title={notice.title} actions={<Button variant="ghost" size="sm" onClick={() => setNotice(null)}>{t('Dismiss')}</Button>}>{notice.message}</InlineNotice>}
              <ChatComposerContext.Provider value={{ onSubmit: submitMessage, clarifyWhileRunning: Boolean(port.capabilities?.clarifyWhileRunning) }}>
                <Composer port={port} value={text} onChange={setText} disabled={disabled} scope={scope} onScopeChange={changeScope} mentions={mentions} onMentionsChange={setMentions}
                  attachments={attachments} onAttachmentsChange={setAttachments} generateImages={generateImages} onGenerateImagesChange={setGenerateImages} extra={composerExtra} />
              </ChatComposerContext.Provider>
              {footer}
            </div>
          </ThreadPrimitive.Root>
        </section>
      </div>
    </AssistantRuntimeProvider>
  </div>;
}

// The list reads the run state of the selected thread from the assistant-ui store (a dot next to the active conversation).
function RunningThreadList(props) {
  const running = useAuiState(state => state.thread.isRunning);
  return <ThreadList {...props} running={running} />;
}
