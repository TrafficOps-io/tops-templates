import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Archive, MoreHorizontal, Plus, Search } from 'lucide-react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import Menu from '../primitives/Menu.jsx';
import ConfirmDialog from '../primitives/ConfirmDialog.jsx';

// port.threads (ReadableStore<Thread[]>) as React state. subscribe(fn) calls fn(value) on change; the initial value is get().
export function useThreads(port) {
  const subscribe = useCallback(onChange => port.threads.subscribe(() => onChange()), [port]);
  const get = useCallback(() => port.threads.get(), [port]);
  return useSyncExternalStore(subscribe, get, get);
}

// Conversation list over port.threads (assistant-ui ThreadListPrimitive needs its own thread model, see README "Thread model").
// Props: port, threadId, onThreadChange(id), onCreate() — StudioChat's "new conversation" (createThread → onThreadChange),
// running — the selected thread has an active run, onError(error) — StudioChat shows it as an InlineNotice.
// StudioChat wraps it in <aside data-testid="studio-chat-threads">. Below 560 px of chat width the list is hidden by a container query and ChatHeader offers it as a menu.
export default function ThreadList({ port, threadId, onThreadChange, onCreate, running = false, onError }) {
  const t = useStudioText(), threads = useThreads(port);
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState(null), [title, setTitle] = useState(''), [deleting, setDeleting] = useState(null), [busy, setBusy] = useState(false);
  const needle = query.trim().toLowerCase();
  const visible = threads.filter(thread => Boolean(thread.archived) === archived && (!needle || thread.title.toLowerCase().includes(needle)));
  const run = async call => { try { await call(); } catch (error) { onError?.(error); } };

  const renaming = useRef(null); // guards against submit + blur saving twice
  function startRename(thread) { renaming.current = thread.id; setEditing(thread.id); setTitle(thread.title); }
  function cancelRename() { renaming.current = null; setEditing(null); }
  async function saveRename(event) {
    event.preventDefault();
    const id = renaming.current, next = title.trim();
    if (!id) return;
    cancelRename();
    const current = threads.find(thread => thread.id === id);
    if (next && current && next !== current.title) await run(() => port.renameThread(id, next));
  }
  async function confirmDelete() {
    const thread = deleting;
    setBusy(true);
    await run(async () => { await port.deleteThread(thread.id); if (thread.id === threadId) onThreadChange?.(''); });
    setBusy(false); setDeleting(null);
  }
  const empty = needle ? t('No matching conversations.') : archived ? t('No archived conversations.') : t('Your conversations will appear here.');

  return <nav className="studio-chat-threads-nav" aria-label={t('Conversations')}>
    <div className="studio-chat-threads-head">
      <h2 className="studio-chat-threads-title">{t('Conversations')}</h2>
      <Button size="sm" variant="ghost" icon={Plus} aria-label={t('New conversation')} title={t('New conversation')} onClick={onCreate} />
    </div>
    <label className="studio-chat-threads-search">
      <Search size={14} aria-hidden="true" />
      <span className="studio-sr-only">{t('Search conversations')}</span>
      <input type="search" value={query} placeholder={t('Search conversations')} onChange={event => setQuery(event.target.value)} />
    </label>
    <button type="button" className="studio-chat-threads-archive" aria-pressed={archived} onClick={() => setArchived(value => !value)}>
      <Archive size={14} aria-hidden="true" />{t('Archived')}
    </button>
    {visible.length ? <ul className="studio-chat-threads-list">
      {visible.map(thread => {
        const active = thread.id === threadId, working = active && running;
        return <li key={thread.id} className="studio-chat-threads-item">
          {editing === thread.id
            ? <form className="studio-chat-threads-rename" onSubmit={saveRename}>
              <input aria-label={t('Conversation title')} value={title} autoFocus onChange={event => setTitle(event.target.value)}
                onBlur={saveRename} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRename(); } }} />
            </form>
            : <button type="button" className="studio-chat-threads-open" aria-current={active ? 'true' : undefined} title={working ? `${thread.title} · ${t('Working…')}` : thread.title} onClick={() => onThreadChange?.(thread.id)}>
              <span className="studio-chat-threads-label">{thread.title}</span>
              {working && <span className="studio-chat-threads-running" role="img" aria-label={t('Working…')} />}
            </button>}
          <Menu label={t('Conversation actions: {title}', { title: thread.title })} trigger={<MoreHorizontal size={16} aria-hidden="true" />} triggerClassName="studio-chat-threads-more">{({ close }) => <>
            <button type="button" role="menuitem" onClick={() => { close(false); startRename(thread); }}>{t('Rename conversation')}</button>
            <button type="button" role="menuitem" onClick={() => { close(); run(() => port.archiveThread(thread.id, !thread.archived)); }}>{thread.archived ? t('Restore') : t('Archive')}</button>
            <button type="button" role="menuitem" onClick={() => { close(false); setDeleting(thread); }}>{t('Delete conversation')}</button>
          </>}</Menu>
        </li>;
      })}
    </ul> : <p className="studio-chat-threads-empty">{empty}</p>}
    {deleting && <ConfirmDialog title={t('Delete conversation?')} description={t('Messages of this conversation will be deleted. Changes already applied stay in the project.')}
      confirmLabel={t('Delete permanently')} danger busy={busy} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />}
  </nav>;
}
