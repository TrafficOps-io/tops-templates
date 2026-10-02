// StudioChat — chat UI on assistant-ui primitives over a ChatPort (chat/port.d.ts). Skeleton: the implementation lands with the runtime, composer and thread list.
//
// port: ChatPort; threadId?: string; onThreadChange?(id);
// launch?: { id, text?, scope?, mentions?, attachments?: File[] } — external launch: an effect keyed on launch.id resets the composer and fills text, scope, mention targets and files;
// actions?: { id, label, danger?, onSelect({ text }) }[] — menu items in the thread header (product actions, e.g. "Create the project anew");
// disabled?: boolean; footer?: ReactNode; emptyState?: ReactNode; className?: string
export default function StudioChat({ port, threadId, onThreadChange, launch, actions = [], disabled = false, footer, emptyState, className = '' }) {
  return null;
}
