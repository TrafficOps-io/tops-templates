import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import './monaco-setup.js';
import { WandSparkles } from 'lucide-react';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import { languageFor } from './project.js';
import { conf as htmlConfiguration } from 'monaco-editor/languages/definitions/html/html.js';
import { language as cssLanguage } from 'monaco-editor/languages/definitions/css/css.js';
import { language as javascriptLanguage } from 'monaco-editor/languages/definitions/javascript/javascript.js';
import { registerTplLanguage } from './tpl-language.js';
import { registerTplIntelliSense } from './tpl-intellisense.js';
import { registerTplFormatting } from './tpl-formatting.js';

registerTplLanguage(monaco, { css: cssLanguage, javascript: javascriptLanguage, htmlConfiguration });

const projectSources = new WeakMap();
registerTplIntelliSense(monaco, { getProjectFiles: model => projectSources.get(model)?.current || {} });
registerTplFormatting(monaco);
monaco.editor.defineTheme('trafficops', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'comment', foreground: '766E69' }, { token: 'string', foreground: '537559' }, { token: 'tag', foreground: 'A64734' },
    { token: 'keyword.directive.tpl', foreground: 'A64734', fontStyle: 'bold' },
    { token: 'type.identifier.tpl', foreground: '7B4D91' }, { token: 'entity.name.function.tpl', foreground: '79552E' },
    { token: 'variable.tpl', foreground: '315E83' }, { token: 'variable.predefined.tpl', foreground: '315E83' },
    { token: 'delimiter.template', foreground: 'A64734' },
    { token: 'attribute.name.tpl', foreground: '79552E' }, { token: 'metatag.tpl', foreground: '766E69' },
    { token: 'number.tpl', foreground: '537559' }, { token: 'keyword.tpl', foreground: '7B4D91' },
  ],
  colors: { 'editor.background': '#FFFDFB', 'editor.foreground': '#241F1D', 'editorLineNumber.foreground': '#9A8E85', 'editor.lineHighlightBackground': '#FBF7F2', 'editor.selectionBackground': '#F6D7C9', 'editorCursor.foreground': '#E75D45' },
});

export default function CodeEditor({ path, value, files, onChange, onOpenFile, reveal, onError }) {
  const container = useRef(null), editor = useRef(null), change = useRef(onChange);
  change.current = onChange;
  const sources = useRef(files), openFile = useRef(onOpenFile);
  sources.current = files; openFile.current = onOpenFile;
  useEffect(() => {
    const model = monaco.editor.createModel(value, languageFor(path), monaco.Uri.from({ scheme: 'trafficops-template', authority: 'project', path: `/${path}` }));
    projectSources.set(model, sources);
    const instance = monaco.editor.create(container.current, {
      model, theme: 'trafficops', automaticLayout: true,
      minimap: { enabled: false }, fontSize: 13, lineHeight: 22, padding: { top: 18 },
      scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, insertSpaces: true, detectIndentation: false, renderLineHighlight: 'line',
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true, wordBasedSuggestions: 'off', snippetSuggestions: 'top',
      parameterHints: { enabled: true }, hover: { enabled: true }, autoIndent: 'full',
      formatOnPaste: false, formatOnType: false,
      accessibilitySupport: 'on', ariaLabel: `Source code for ${path}`, fixedOverflowWidgets: true,
    });
    editor.current = instance;
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor(_source, uri, selection) {
        if (uri.scheme !== model.uri.scheme || uri.authority !== model.uri.authority) return false;
        const target = uri.path.replace(/^\//, '');
        if (typeof sources.current?.[target] !== 'string') return false;
        openFile.current?.(target, selection);
        return true;
      },
    });
    const listener = instance.onDidChangeModelContent(() => change.current(instance.getValue()));
    return () => { opener.dispose(); listener.dispose(); projectSources.delete(model); instance.dispose(); model.dispose(); editor.current = null; };
  }, [path]);
  useEffect(() => { if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value); }, [value]);
  useEffect(() => {
    if (!reveal || !editor.current) return;
    const selection = reveal.selection || { lineNumber: 1, column: 1 };
    if ('startLineNumber' in selection) {
      editor.current.setSelection(selection); editor.current.revealRangeInCenter(selection);
    } else { editor.current.setPosition(selection); editor.current.revealPositionInCenter(selection); }
    editor.current.focus();
  }, [reveal]);
  async function format() {
    try { await editor.current?.getAction('editor.action.formatDocument')?.run(); editor.current?.focus(); }
    catch (error) { onError?.(error instanceof Error ? error.message : String(error)); }
  }
  const canFormat = ['trafficops-tpl', 'html', 'css', 'javascript', 'json'].includes(languageFor(path));
  return <><div className="source-heading"><span>{path}</span><div className="source-tools">{canFormat && <button className="btn btn-ghost btn-xs" title="Format document (Shift+Alt+F)" onClick={format}><WandSparkles size={13} /> Format</button>}<span>UTF-8</span></div></div><div ref={container} className="code-editor" /></>;

}
