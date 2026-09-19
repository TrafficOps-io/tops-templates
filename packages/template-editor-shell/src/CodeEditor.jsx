import { useStudioHost } from './host-context.js';
import { useStudioText } from './studio-i18n.js';
import { useEffect, useLayoutEffect, useRef, useId } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import '@trafficops/template-editor-monaco/setup';
import { PanelRightClose, PanelRightOpen, WandSparkles } from 'lucide-react';
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
import { registerTplLanguage } from '@trafficops/template-editor-monaco/language';
import { registerTplIntelliSense } from '@trafficops/template-editor-monaco/intellisense';
import { registerTplFormatting } from '@trafficops/template-editor-monaco/formatting';
import { dialectId, modelLanguage, templateFile } from '@trafficops/template-editor-monaco/dialect';

registerTplLanguage(monaco, { css: cssLanguage, javascript: javascriptLanguage, htmlConfiguration });

const projectSources = new WeakMap();
const dialectForModel = model => projectSources.get(model)?.dialect.current;
registerTplIntelliSense(monaco, { getProjectFiles: model => projectSources.get(model)?.files.current || {}, getDialect: dialectForModel });
registerTplFormatting(monaco, { getDialect: dialectForModel });
monaco.editor.defineTheme('trafficops', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '8D817A' }, { token: 'string', foreground: '9CC8AF' }, { token: 'tag', foreground: 'FF9677' },
    { token: 'keyword.directive.tpl', foreground: 'FF8068', fontStyle: 'bold' },
    { token: 'type.identifier.tpl', foreground: 'D4A6D9' }, { token: 'entity.name.function.tpl', foreground: 'E6C386' },
    { token: 'variable.tpl', foreground: '9FC5E8' }, { token: 'variable.predefined.tpl', foreground: '9FC5E8' },
    { token: 'delimiter.template', foreground: 'FF8068' },
    { token: 'attribute.name.tpl', foreground: 'E6C386' }, { token: 'metatag.tpl', foreground: '8D817A' },
    { token: 'number.tpl', foreground: '9CC8AF' }, { token: 'keyword.tpl', foreground: 'D4A6D9' },
  ],
  colors: { 'editor.background': '#211E1C', 'editor.foreground': '#F7F0EB', 'editorLineNumber.foreground': '#6F645E', 'editorLineNumber.activeForeground': '#B7AAA2', 'editor.lineHighlightBackground': '#2A2523', 'editor.selectionBackground': '#5B3833', 'editorCursor.foreground': '#FF8068', 'editorIndentGuide.background1': '#332E2B', 'editorIndentGuide.activeBackground1': '#5A4D47' },
});

monaco.editor.defineTheme('trafficops-light', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#FBF7F2', 'editor.foreground': '#241F1D' } });

export default function CodeEditor({ path, value, files, dialect, onChange, onOpenFile, reveal, onError, previewVisible, onTogglePreview, readOnly = false }) {
  const t = useStudioText();
  const projectId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const host = useStudioHost();
  const syncing = useRef(false);
  const container = useRef(null), editor = useRef(null), change = useRef(onChange);
  change.current = onChange;
  const descriptor = useRef(dialect); descriptor.current = dialect;
  const sources = useRef(files), openFile = useRef(onOpenFile);
  sources.current = files; openFile.current = onOpenFile;
  useEffect(() => {
    const model = monaco.editor.createModel(value, modelLanguage(path, descriptor.current, languageFor(path)), monaco.Uri.from({ scheme: 'trafficops-template', authority: `project-${projectId}`, path: `/${path}` }));
    projectSources.set(model, { files: sources, dialect: descriptor });
    const instance = monaco.editor.create(container.current, {
      model, readOnly, theme: 'trafficops', automaticLayout: true,
      minimap: { enabled: false }, fontSize: 13, lineHeight: 22, padding: { top: 18 },
      scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2, insertSpaces: true, detectIndentation: false, renderLineHighlight: 'line',
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true, wordBasedSuggestions: 'off', snippetSuggestions: 'top',
      parameterHints: { enabled: true }, hover: { enabled: true }, autoIndent: 'full',
      formatOnPaste: false, formatOnType: false,
      accessibilitySupport: 'on', ariaLabel: `Source code for ${path}`, fixedOverflowWidgets: true,
    });
    editor.current = instance;
    const syncTheme = () => monaco.editor.setTheme(host && getComputedStyle(container.current).colorScheme === 'light' ? 'trafficops-light' : 'trafficops');
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    if (host) themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor(_source, uri, selection) {
        if (uri.scheme !== model.uri.scheme || uri.authority !== model.uri.authority) return false;
        const target = uri.path.replace(/^\//, '');
        if (typeof sources.current?.[target] !== 'string') return false;
        openFile.current?.(target, selection);
        return true;
      },
    });
    const listener = instance.onDidChangeModelContent(() => { if (!syncing.current) change.current(instance.getValue()); });
    return () => { themeObserver.disconnect(); opener.dispose(); listener.dispose(); projectSources.delete(model); instance.dispose(); model.dispose(); editor.current = null; };
  }, [path]);
  // Sync controlled values during commit, before another keystroke can update Monaco.
  useLayoutEffect(() => { if (editor.current && editor.current.getValue() !== value) { syncing.current = true; try { editor.current.setValue(value); } finally { syncing.current = false; } } }, [value]);
  useEffect(() => { editor.current?.updateOptions({ readOnly }); }, [readOnly]);
  useEffect(() => { const model = editor.current?.getModel(); if (model) monaco.editor.setModelLanguage(model, modelLanguage(path, dialect, languageFor(path))); }, [path, dialect?.id, dialect?.schema]);
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
  const canFormat = ['html', 'css', 'javascript', 'json'].includes(languageFor(path)) || templateFile(path, dialect);
  return <><div className="source-heading"><span>{path}</span><div className="source-tools">{canFormat && !readOnly && <button className="btn btn-ghost btn-xs" title={t("Format document (Shift+Alt+F)")} onClick={format}><WandSparkles size={13} /> {t("Format")}</button>}{onTogglePreview && <button className="btn btn-ghost btn-xs preview-toggle-button" aria-controls="preview-panel" aria-expanded={previewVisible} onClick={onTogglePreview}>{previewVisible ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}{previewVisible ? t("Hide preview") : t("Show preview")}</button>}<span>UTF-8</span></div></div><div ref={container} className="code-editor" /></>;

}
