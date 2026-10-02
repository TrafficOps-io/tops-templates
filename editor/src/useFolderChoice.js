import { useRef, useState } from 'react';
import { createFolderChoice } from './folder-choice.js';

/** React state for createFolderChoice: `choice` is the pending question for FolderChoiceDialog. `mode()` returns the
 *  storage mode ('folder' | 'opfs'); it is read at call time. */
export function useFolderChoice(mode) {
  const [choice, setChoice] = useState(null), controller = useRef(null);
  controller.current ||= createFolderChoice({ show: setChoice, mode });
  return { choice, ...controller.current };
}
