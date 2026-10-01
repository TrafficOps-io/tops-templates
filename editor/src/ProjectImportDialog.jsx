import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { transferFileChanges } from './project-transfer.js';

export default function ProjectImportDialog({ choice, busy, onChoose, onClose }) {
  const dialog = useRef(null), [kind, setKind] = useState(choice.imported.metadata?.kind || (choice.directory ? 'landing' : 'template'));
  useEffect(() => { dialog.current.showModal(); }, []);
  const changes = transferFileChanges(choice.existing, choice.imported);
  const valuesChanged = JSON.stringify(choice.existing.settings || {}) !== JSON.stringify(choice.imported.settings || {});
  return <dialog ref={dialog} className="modal" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="import-project-title"><div className="modal-box">
    <div className="dialog-heading"><h2 id="import-project-title">{choice.transfer ? 'Review folder changes' : 'Continue this project or create a copy?'}</h2><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close import" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <p>{choice.transfer ? 'Saving this project will replace these files in the selected folder. Review the changes before continuing.' : `“${choice.existing.name}” already exists on this device. Continuing keeps the same project and dialogue history${choice.directory ? ' and connects the selected folder' : ' using this device as its save location'}.`}</p>
    <p>{choice.fileName}: {changes.length} file changes{valuesChanged ? ' and changed content values' : ''}.</p>
    {changes.length > 0 && <div className="conversation-diff"><ul>{changes.map(change => <li key={change.path}><strong>{change.status}</strong> {change.path}</li>)}</ul></div>}
    {!choice.imported.metadata && !choice.transfer && <label className="field"><span>Project type</span><select className="select w-full" value={kind} onChange={event => setKind(event.target.value)}><option value="landing">Landing page</option><option value="template">Reusable template</option></select></label>}
    {!choice.transfer && <p className="library-storage-note">A copy gets its own files and dialogues. The original project stays available.</p>}
    <div className="modal-action"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>{!choice.transfer && <button className="btn btn-outline" disabled={busy} onClick={() => onChoose('copy', kind)}>Create independent copy</button>}<button className="btn btn-primary" disabled={busy} onClick={() => onChoose('continue', kind)}>{busy ? 'Saving…' : choice.transfer ? 'Save project to this folder' : 'Continue project'}</button></div>
  </div></dialog>;
}
