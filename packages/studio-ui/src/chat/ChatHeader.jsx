import { useRef, useState } from 'react';
import { MessagesSquare, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import Menu from '../primitives/Menu.jsx';
import { formatCost } from './cards/CardFrame.jsx';
import { useThreads } from './ThreadList.jsx';

// Thread header: the conversations menu (shown only when the chat is narrower than 560 px, container query), the title with
// in-place rename, the conversation total (Thread.cost, when capabilities.cost) and product actions.
// actions: { id, label, danger?, onSelect({ text }) }[] — onSelect receives the current composer text.
export default function ChatHeader({ port, threadId, onThreadChange, onCreate, onManage, actions = [], composerText = '', onError }) {
  const t = useStudioText(), threads = useThreads(port), thread = threads.find(item => item.id === threadId);
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(''), renaming = useRef(false);
  const showCost = port.capabilities?.cost && Number.isFinite(thread?.cost);
  const open = threads.filter(item => !item.archived);

  function startRename() { renaming.current = true; setTitle(thread.title); setEditing(true); }
  function stopRename() { renaming.current = false; setEditing(false); }
  async function saveRename(event) {
    event.preventDefault();
    if (!renaming.current) return;
    stopRename();
    const next = title.trim();
    if (next && thread && next !== thread.title) {
      try { await port.renameThread(thread.id, next); } catch (error) { onError?.(error); }
    }
  }

  return <header className="studio-chat-header">
    <Menu label={t('Conversations')} className="studio-chat-header-threads" triggerClassName="studio-chat-header-button" trigger={<MessagesSquare size={16} aria-hidden="true" />}>{({ close }) => <>
      <button type="button" role="menuitem" onClick={() => { close(); onCreate?.(); }}><Plus size={14} aria-hidden="true" /><span>{t('New conversation')}</span></button>
      {open.length > 0 && <hr />}
      {open.map(item => <button key={item.id} type="button" role="menuitem" aria-current={item.id === threadId ? 'true' : undefined} onClick={() => { close(); onThreadChange?.(item.id); }}><span>{item.title}</span></button>)}
      {onManage && <><hr /><button type="button" role="menuitem" onClick={() => { close(); onManage(); }}>{t('Manage conversations')}</button></>}
    </>}</Menu>
    {editing
      ? <form className="studio-chat-header-rename" onSubmit={saveRename}>
        <input aria-label={t('Conversation title')} value={title} autoFocus onChange={event => setTitle(event.target.value)} onBlur={saveRename}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopRename(); } }} />
      </form>
      : <h2 className="studio-chat-header-title" title={thread?.title}>{thread?.title ?? t('New conversation')}</h2>}
    {thread && !editing && <Button variant="ghost" size="sm" icon={Pencil} aria-label={t('Rename conversation')} title={t('Rename conversation')} onClick={startRename} />}
    {showCost && <span className="studio-chat-header-cost" title={t('Conversation cost')}>{formatCost(thread.cost)}</span>}
    {actions.length > 0 && <Menu label={t('More actions')} className="studio-chat-header-actions" triggerClassName="studio-chat-header-button" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>{({ close }) => <>
      {actions.map(action => <button key={action.id} type="button" role="menuitem" className={action.danger ? 'studio-menu-danger' : undefined} onClick={() => { close(); action.onSelect?.({ text: composerText }); }}>{action.label}</button>)}
    </>}</Menu>}
  </header>;
}
