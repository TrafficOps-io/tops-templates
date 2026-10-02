import { useEffect, useId, useRef } from 'react';
import { FolderOpen, X } from 'lucide-react';

/** A folder decision: { title, message, actions: [{ id, label, primary? }] }. Cancel is always offered. onChoose(id) runs
 *  synchronously inside the click, so an action may open a folder picker there (spec A8). */
export default function FolderChoiceDialog({ choice, onChoose }) {
  const dialog = useRef(null), titleId = useId();
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onChoose('cancel'); }}><div className="modal-box">
    <div className="dialog-heading"><div><span className="section-kicker">PROJECT FOLDER</span><h2 id={titleId}>{choice.title}</h2></div><button type="button" className="btn btn-ghost btn-sm btn-square" aria-label="Close folder choice" onClick={() => onChoose('cancel')}><X size={18} /></button></div>
    <p>{choice.message}</p>
    <div className="modal-action"><button type="button" className="btn btn-ghost" onClick={() => onChoose('cancel')}>Cancel</button>{choice.actions.map(action => <button type="button" key={action.id} className={`btn ${action.primary ? 'btn-primary' : 'btn-outline'}`} onClick={() => onChoose(action.id)}>{(action.pick || action.root) && <FolderOpen size={15} />}{action.label}</button>)}</div>
  </div></dialog>;
}
