// editor.api supplies the editor shell; these contributions provide its authoring UI.
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js';
import { registerHTMLLanguageService } from 'monaco-editor/languages/features/html/register.js';
import 'monaco-editor/languages/features/css/register.js';
import 'monaco-editor/languages/features/typescript/register.js';
import 'monaco-editor/languages/features/json/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (['html', 'handlebars', 'razor', 'trafficops-tpl'].includes(label)) return new HtmlWorker();
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['typescript', 'javascript'].includes(label)) return new TypeScriptWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

// Keep HTML authoring assistance inside TPL while its own formatter handles DSL blocks.
registerHTMLLanguageService('trafficops-tpl', undefined, {
  completionItems: true, hovers: true,
  documentFormattingEdits: false, documentRangeFormattingEdits: false,
});
