import { ResizableWorkspace } from '@trafficops/studio-ui/workspace';
import { useStudioText } from './studio-i18n.js';

export default function ShellResizableWorkspace(props) {
  const t = useStudioText();
  return <ResizableWorkspace t={t} {...props} />;
}
