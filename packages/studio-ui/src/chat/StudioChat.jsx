import { useEffect, useState } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import { AssistantRuntimeProvider, AuiIf, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import EmptyState from '../primitives/EmptyState.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import { useChatRuntime } from './useChatRuntime.js';
import { ChatComposerContext } from './Composer.jsx';
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
// disabled?: boolean; footer?: ReactNode; emptyState?: ReactNode; className?: string
// Errors (send, thread and card actions) are inline notices; no ToastProvider is needed.
export default function StudioChat({ port, threadId = '', onThreadChange, launch, actions = [], disabled = false, footer, emptyState, className = '' }) {
  const t = useStudioText();
  const [text, setText] = useState(''), [scope, setScope] = useState(() => defaultScope(port)), [mentions, setMentions] = useState([]), [attachments, setAttachments] = useState([]), [generateImages, setGenerateImages] = useState(false);
  const [notice, setNotice] = useState(null); // { title, message }
  const report = title => cause => setNotice({ title, message: cause?.message || t('Something went wrong.') });
  const sendFailed = report(t('The message was not sent')), actionFailed = report(t('The action failed'));

  // External launch: each new launch.id resets the composer and fills text, scope, mention targets and files
  // (Media Studio passes the home screen input here, Landing — a launch from a preview block).
  useEffect(() => {
    if (!launch) return;
    setText(launch.text || ''); setScope(launch.scope || defaultScope(port)); setMentions(launch.mentions || []); setAttachments(launch.attachments || []); setNotice(null);
  }, [launch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { setText(''); setMentions([]); setAttachments([]); setNotice(null); };
  const runtime = useChatRuntime(port, threadId, { scope, mentions, attachments, generateImages, onSent: clear, onThreadCreated: onThreadChange, onError: sendFailed });

  // Attachments-only message: ComposerPrimitive.Send is disabled for empty text, so the composer calls this instead.
  async function submitEmpty() {
    try {
      let target = threadId;
      if (!target) { const thread = await port.createThread(); target = thread.id; onThreadChange?.(thread.id); }
      await port.send(target, { text: '', mentions, attachments, scope, generateImages });
      setMentions([]); setAttachments([]); setNotice(null);
    } catch (cause) { sendFailed(cause); }
  }
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
            <ThreadPrimitive.Viewport className="studio-chat-feed" data-testid="studio-chat-feed">
              <AuiIf condition={state => state.thread.isEmpty}>{emptyState || <EmptyState icon={Sparkles} title={t('What shall we create?')} description={t('Describe an idea or a change. Mention sections, scenes and files with @.')} />}</AuiIf>
              <ThreadPrimitive.Messages>{({ message }) => message.role === 'user' ? <UserMessage port={port} /> : <AssistantMessage port={port} />}</ThreadPrimitive.Messages>
            </ThreadPrimitive.Viewport>
            <div className="studio-chat-bottom">
              <ThreadPrimitive.ScrollToBottom className="studio-chat-scroll-bottom" aria-label={t('Scroll to the latest message')} title={t('Scroll to the latest message')}><ArrowDown size={16} aria-hidden="true" /></ThreadPrimitive.ScrollToBottom>
              {notice && <InlineNotice tone="danger" title={notice.title} actions={<Button variant="ghost" size="sm" onClick={() => setNotice(null)}>{t('Dismiss')}</Button>}>{notice.message}</InlineNotice>}
              <ChatComposerContext.Provider value={{ onSubmitEmpty: submitEmpty }}>
                <Composer port={port} value={text} onChange={setText} disabled={disabled} scope={scope} onScopeChange={setScope} mentions={mentions} onMentionsChange={setMentions}
                  attachments={attachments} onAttachmentsChange={setAttachments} generateImages={generateImages} onGenerateImagesChange={setGenerateImages} />
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
