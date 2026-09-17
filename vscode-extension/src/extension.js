'use strict';

const vscode = require('vscode');
const language = require('./language');
const { ProjectLoader } = require('./projects');
const { formatDocument } = require('./formatter');

const LANGUAGE_ID = 'fast-landings-tpl';
const selector = { language: LANGUAGE_ID };

function dialectFor(document) {
  const configured = vscode.workspace.getConfiguration('fastLandingsTemplates', document.uri).get('dialect', language.DEFAULT_DIALECT);
  return language.normalizeDialect(configured);
}

function activate(context) {
  const loader = new ProjectLoader(vscode, language);
  const formattingLog = vscode.window.createOutputChannel('TrafficOps Templates');
  context.subscriptions.push(formattingLog);
  const previewDiagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  context.subscriptions.push(previewDiagnostics);
  const validatePreview = document => {
    if (document.languageId !== LANGUAGE_ID) return;
    const parsed = language.parseDocument(document.uri.toString(), document.getText(), { dialect: dialectFor(document) });
    previewDiagnostics.set(document.uri, parsed.diagnostics.map(issue => {
      const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end)), issue.message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'TrafficOps Templates';
      return diagnostic;
    }));
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(validatePreview));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => validatePreview(event.document)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => previewDiagnostics.delete(document.uri)));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    for (const document of vscode.workspace.textDocuments) {
      if (event.affectsConfiguration('fastLandingsTemplates.dialect', document.uri)) validatePreview(document);
    }
  }));
  for (const document of vscode.workspace.textDocuments) validatePreview(document);
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
    async provideDocumentFormattingEdits(document, options, token) {
      const configuration = vscode.workspace.getConfiguration('fastLandingsTemplates', document.uri);
      if (!configuration.get('format.enable', true) || token.isCancellationRequested) return [];
      const original = document.getText();
      const version = document.version;
      try {
        const formatted = await formatDocument(original, {
          tabSize: options.tabSize,
          insertSpaces: options.insertSpaces,
          printWidth: configuration.get('format.printWidth', 100),
        });
        if (token.isCancellationRequested || document.version !== version || formatted === original) return [];
        return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(original.length)), formatted)];
      } catch (error) {
        formattingLog.appendLine(`Formatting failed for ${document.uri.toString()}: ${error.message}`);
        return [];
      }
    },
  }));
  const completionKinds = {
    type: vscode.CompletionItemKind.Struct,
    field: vscode.CompletionItemKind.Field,
    variable: vscode.CompletionItemKind.Variable,
    function: vscode.CompletionItemKind.Function,
    keyword: vscode.CompletionItemKind.Keyword,
    property: vscode.CompletionItemKind.Property,
    file: vscode.CompletionItemKind.File,
    snippet: vscode.CompletionItemKind.Snippet,
  };

  async function detect(document) {
    if (!['html', 'plaintext', 'php'].includes(document.languageId)) return;
    if (!vscode.workspace.getConfiguration('fastLandingsTemplates', document.uri).get('autoDetect', true)) return;
    const prefix = document.getText(new vscode.Range(0, 0, Math.min(document.lineCount, 20), 0));
    if (/^\s*@template\b/.test(prefix.replace(/^\uFEFF/, ''))) {
      await vscode.languages.setTextDocumentLanguage(document, LANGUAGE_ID);
    }
  }

  const detectQuietly = document => { void detect(document).catch(() => {}); };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(detectQuietly));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.contentChanges.some(change => change.range.start.line < 20)) detectQuietly(event.document);
  }));
  for (const document of vscode.workspace.textDocuments) detectQuietly(document);
  context.subscriptions.push(vscode.commands.registerCommand('fastLandingsTemplates.setLanguage', async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (document) await vscode.languages.setTextDocumentLanguage(document, LANGUAGE_ID);
  }));

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    async provideCompletionItems(document, position, token) {
      const offset = document.offsetAt(position);
      const parsed = language.parseDocument(document.uri.toString(), document.getText(), { dialect: dialectFor(document) });
      if (parsed.phpSpans.some(span => span.start <= offset && (offset < span.end || (!span.closed && offset === span.end)))
        || parsed.previewBlocks.some(block => block.bodyStart <= offset && (offset < block.bodyEnd || (!block.closed && offset === document.getText().length)))) return [];
      const before = document.lineAt(position.line).text.slice(0, position.character);
      const include = /^\s*@include\s+(["'])([^"']*)$/.exec(before);
      if (include) {
        const suggestions = await loader.completeIncludes(document, include[2], token);
        if (token.isCancellationRequested) return [];
        return suggestions.map(value => {
          const item = new vscode.CompletionItem(value.label, value.isDirectory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
          item.insertText = value.insertText;
          item.detail = value.detail || 'Path relative to the template package root';
          const suffix = document.lineAt(position.line).text.slice(position.character).match(/^[^"']*/)[0];
          item.range = new vscode.Range(position.line, position.character - include[2].length, position.line, position.character + suffix.length);
          if (value.isDirectory) item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest files' };
          return item;
        });
      }
      const loaded = await loader.load(document, token);
      if (token.isCancellationRequested) return [];
      return language.getCompletions(loaded.project, document.uri.toString(), offset).map(value => {
        const item = new vscode.CompletionItem(value.label, completionKinds[value.kind] ?? vscode.CompletionItemKind.Text);
        item.detail = value.detail;
        if (value.documentation) item.documentation = new vscode.MarkdownString(value.documentation);
        if (value.insertText !== undefined) item.insertText = value.snippet ? new vscode.SnippetString(value.insertText) : value.insertText;
        if (value.range) item.range = new vscode.Range(document.positionAt(value.range.start), document.positionAt(value.range.end));
        return item;
      });
    },
  }, '@', '.', '{', '&', ' ', ':', '(', '"', "'", '/', '['));

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
    async provideDefinition(document, position, token) {
      const loaded = await loader.load(document, token);
      if (token.isCancellationRequested) return null;
      const offset = document.offsetAt(position);
      const include = loaded.includeTargets.get(document.uri.toString())?.find(value => offset >= value.start && offset <= value.end);
      if (include) return new vscode.Location(include.uri, new vscode.Position(0, 0));
      const target = language.getDefinition(loaded.project, document.uri.toString(), offset);
      if (!target) return null;
      const source = loaded.documents.get(target.uri);
      if (!source) return null;
      return new vscode.Location(source.uri, rangeAt(source.text, target.start, target.end));
    },
  }));

  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    async provideHover(document, position, token) {
      const loaded = await loader.load(document, token);
      if (token.isCancellationRequested) return null;
      const value = language.getHover(loaded.project, document.uri.toString(), document.offsetAt(position));
      if (!value) return null;
      return new vscode.Hover(new vscode.MarkdownString(value.contents), new vscode.Range(document.positionAt(value.range.start), document.positionAt(value.range.end)));
    },
  }));

  context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(selector, {
    async provideSignatureHelp(document, position, token) {
      const loaded = await loader.load(document, token);
      if (token.isCancellationRequested) return null;
      const value = language.getSignatureHelp(loaded.project, document.uri.toString(), document.offsetAt(position));
      if (!value) return null;
      const signature = new vscode.SignatureInformation(value.label);
      signature.parameters = value.parameters.map(parameter => new vscode.ParameterInformation(parameter.label, parameter.documentation));
      const result = new vscode.SignatureHelp();
      result.signatures = [signature];
      result.activeSignature = 0;
      result.activeParameter = Math.max(0, Math.min(value.activeParameter, signature.parameters.length - 1));
      return result;
    },
  }, '(', ','));

  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, {
    async provideDocumentSymbols(document, token) {
      const loaded = await loader.load(document, token);
      if (token.isCancellationRequested) return [];
      const kinds = { type: vscode.SymbolKind.Struct, field: vscode.SymbolKind.Field, runtime: vscode.SymbolKind.Field, validation: vscode.SymbolKind.Namespace, variable: vscode.SymbolKind.Variable, function: vscode.SymbolKind.Function, block: vscode.SymbolKind.Function, layout: vscode.SymbolKind.Module, section: vscode.SymbolKind.Namespace };
      const convert = symbol => {
        const result = new vscode.DocumentSymbol(symbol.name, symbol.detail || '', kinds[symbol.kind] ?? vscode.SymbolKind.Variable,
          rangeAt(document.getText(), symbol.start, symbol.end), rangeAt(document.getText(), symbol.selectionStart, symbol.selectionEnd));
        result.children = (symbol.children || []).map(convert);
        return result;
      };
      return language.getSymbols(loaded.project, document.uri.toString()).map(convert);
    },
  }));

  context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(selector, {
    provideFoldingRanges(document, _context, token) {
      const stack = [];
      const folds = [];
      const php = language.phpSpans(document.getText());
      const validation = dialectFor(document) === language.DIALECTS.FAST_LANDINGS_V1 ? '|validation' : '';
      const block = new RegExp(`^\\s*@(end)?(type|section|block|layout|each|if|previewData${validation})\\b`);
      for (let line = 0; line < Math.min(document.lineCount, 20000); line++) {
        if (token.isCancellationRequested) return [];
        const offset = document.offsetAt(new vscode.Position(line, document.lineAt(line).firstNonWhitespaceCharacterIndex));
        if (php.some(span => span.start <= offset && offset < span.end)) continue;
        const match = block.exec(document.lineAt(line).text);
        if (!match) continue;
        if (!match[1]) stack.push({ name: match[2], line });
        else {
          const index = stack.findLastIndex(entry => entry.name === match[2]);
          if (index === -1) continue;
          const start = stack[index].line;
          stack.splice(index);
          if (line > start + 1) folds.push(new vscode.FoldingRange(start, line - 1, vscode.FoldingRangeKind.Region));
        }
      }
      return folds;
    },
  }));
}

function rangeAt(text, start, end) {
  const position = offset => {
    const before = text.slice(0, Math.max(0, offset));
    const lines = before.split(/\r\n|\r|\n/);
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
  };
  return new vscode.Range(position(start), position(end));
}

module.exports = { activate };
