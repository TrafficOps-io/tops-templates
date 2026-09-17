import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { languageFor } from './project.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
monaco.editor.defineTheme('trafficops', {
  base: 'vs', inherit: true,
  rules: [{ token: 'comment', foreground: '766E69' }, { token: 'string', foreground: '537559' }, { token: 'tag', foreground: 'A64734' }],
  colors: { 'editor.background': '#FFFDFB', 'editor.foreground': '#241F1D', 'editorLineNumber.foreground': '#9A8E85', 'editor.lineHighlightBackground': '#FBF7F2', 'editor.selectionBackground': '#F6D7C9', 'editorCursor.foreground': '#E75D45' },
});

export default function CodeEditor({ path, value, onChange }) {
  const container = useRef(null), editor = useRef(null), change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const instance = monaco.editor.create(container.current, {
      value, language: languageFor(path), theme: 'trafficops', automaticLayout: true,
      minimap: { enabled: false }, fontSize: 13, lineHeight: 22, padding: { top: 18 },
      scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, renderLineHighlight: 'line',
      accessibilitySupport: 'on', ariaLabel: `Source code for ${path}`, fixedOverflowWidgets: true,
    });
    editor.current = instance;
    const listener = instance.onDidChangeModelContent(() => change.current(instance.getValue()));
    return () => { listener.dispose(); instance.getModel()?.dispose(); instance.dispose(); editor.current = null; };
  }, [path]);
  useEffect(() => { if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value); }, [value]);
  return <div ref={container} className="code-editor" />;
}
