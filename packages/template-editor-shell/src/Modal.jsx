import { Modal } from '@trafficops/studio-ui/primitives';
import { useStudioText } from './studio-i18n.js';
export default function ShellModal(props) { const t = useStudioText(); return <Modal t={t} {...props} />; }
