import { ResizableWorkspace } from '@trafficops/studio-ui/workspace';
import { useStudioText } from './studio-i18n.js';

const legacyMinimums = { sidebar: 176, author: 288, preview: 240 };
export default function ShellResizableWorkspace(props) {
  const t = useStudioText();
  return <ResizableWorkspace t={t} minimums={legacyMinimums} {...props} />;
}
