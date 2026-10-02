import Modal from './Modal.jsx';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
export default function ConfirmDialog({ title, description, confirmLabel, danger = false, busy = false, onConfirm, onClose, t: translate }) {
  const context = useStudioText(), t = translate || context;
  return <Modal title={title} confirmLabel={confirmLabel || t('Confirm')} confirmFirst busy={busy} onClose={onClose} onSubmit={event => { event.preventDefault(); onConfirm(); }} confirmClassName={danger ? 'studio-button studio-button-danger studio-button-md btn btn-error' : undefined} t={t}>
    <p className="studio-dialog-description">{description}</p>
  </Modal>;
}
