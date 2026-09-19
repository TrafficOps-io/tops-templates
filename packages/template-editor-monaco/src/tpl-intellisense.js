import language from '@trafficops/template-language';
import { TPL_LANGUAGE_IDS, dialectId, templateFile } from './dialect.js';

const registrations = new WeakMap();
const pathOf = model => model.uri.path.replace(/^\/+/, '');
const markdown = value => ({ value: String(value), isTrusted: false, supportHtml: false });
const cancelled = (model, token, version) => token?.isCancellationRequested || model.isDisposed?.() || model.getVersionId() !== version;
const kinds = { keyword: 'Keyword', variable: 'Variable', field: 'Field', property: 'Property', type: 'Struct', function: 'Function', file: 'File' };

// Both the shared language core and Monaco use UTF-16 offsets. Do not convert
// offsets through UTF-8 bytes or count Unicode code points here.
export function modelRange(model, range) {
  const start = model.getPositionAt(range.start), end = model.getPositionAt(range.end);
  return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
}

export function completionItem(monaco, model, value, offset) {
  return {
    label: value.label,
    kind: monaco.languages.CompletionItemKind[kinds[value.kind] || 'Text'],
    insertText: value.insertText ?? value.label,
    range: modelRange(model, value.range || { start: offset, end: offset }),
    ...(value.snippet ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
    ...(value.detail ? { detail: value.detail } : {}),
    ...(value.documentation ? { documentation: markdown(value.documentation) } : {}),
  };
}

function positionInText(text, offset) {
  offset = Math.max(0, Math.min(offset, text.length));
  let lineNumber = 1, start = 0;
  const newline = /\r\n|\r|\n/g;
  let match;
  while ((match = newline.exec(text)) && match.index + match[0].length <= offset) { lineNumber++; start = match.index + match[0].length; }
  return { lineNumber, column: offset - start + 1 };
}
function textRange(text, start, end) {
  const first = positionInText(text, start), last = positionInText(text, end);
  return { startLineNumber: first.lineNumber, startColumn: first.column, endLineNumber: last.lineNumber, endColumn: last.column };
}
function isOpaque(document, offset) {
  return document.phpSpans.some(span => span.start <= offset && (offset < span.end || !span.closed && offset === span.end))
    || document.previewBlocks.some(block => block.bodyStart <= offset && (offset < block.bodyEnd || !block.closed && offset === document.text.length));
}
function includeCompletions(snapshot, model, position, offset) {
  const document = snapshot.project.documents.get(snapshot.uri);
  if (isOpaque(document, offset)) return null;
  const prefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const match = /^\s*@include\s+(["'])([^"']*)$/.exec(prefix);
  if (!match) return null;
  const directory = snapshot.path.includes('/') ? snapshot.path.slice(0, snapshot.path.lastIndexOf('/') + 1) : '';
  const suffix = model.getLineContent(position.lineNumber).slice(position.column - 1).match(/^[^"']*/)[0];
  const range = { start: offset - match[2].length, end: offset + suffix.length };
  return snapshot.entries.filter(([path]) => path !== snapshot.path && path.startsWith(directory))
    .map(([path]) => path.slice(directory.length))
    .filter(path => path.startsWith(match[2]))
    .map(path => ({ label: path, kind: 'file', detail: 'Template source relative to this file', range }));
}

/**
 * Register once per Monaco instance. Model URIs use /<project-relative-path>;
 * scheme and authority identify the project and are retained for sibling URIs.
 * getProjectFiles(model) returns a synchronous Record<string, string|Uint8Array>.
 * Re-registering updates the callback and invalidates caches without installing
 * duplicate providers. Dispose only when the application/editor service closes.
 */
export function registerTplIntelliSense(monaco, { getProjectFiles, getDialect }) {
  if (typeof getDialect !== 'function') throw new TypeError('getDialect must be a function');
  if (typeof getProjectFiles !== 'function') throw new TypeError('getProjectFiles must be a function');
  const existing = registrations.get(monaco);
  if (existing) { existing.update(getProjectFiles, getDialect); return existing.disposable; }
  let readFiles = getProjectFiles, readDialect = getDialect, cache = new WeakMap();
  const load = (model, token) => {
    const descriptor = readDialect(model), dialect = dialectId(descriptor);
    if (!dialect) return null;
    const version = model.getVersionId();
    if (cancelled(model, token, version)) return null;
    const uri = model.uri.toString(), path = pathOf(model), text = model.getValue();
    const files = readFiles(model) || {};
    if (cancelled(model, token, version)) return null;
    // Put the live model first and omit its stale snapshot copy. The core uses
    // first declaration wins, so appending an unsaved duplicate would be wrong.
    const entries = [[path, text], ...Object.entries(files)
      .filter(([name, value]) => name !== path && templateFile(name, descriptor) && typeof value === 'string')
      .sort(([a], [b]) => a.localeCompare(b))];
    const previous = cache.get(model);
    if (previous?.version === version && previous.dialect === dialect && previous.uri === uri && previous.entries.length === entries.length
      && entries.every(([name, value], index) => previous.entries[index][0] === name && previous.entries[index][1] === value)) return previous;
    const documents = entries.map(([name, value]) => ({ uri: name === path ? uri : model.uri.with({ path: `/${name}` }).toString(), text: value }));
    const project = language.buildProject(documents, { dialect });
    if (cancelled(model, token, version)) return null;
    const snapshot = { version, uri, path, entries, project, dialect };
    cache.set(model, snapshot);
    return snapshot;
  };
  const providers = [];
  for (const languageId of Object.values(TPL_LANGUAGE_IDS)) {
  providers.push(monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['@', '{', '.', '&', ' ', ':', '(', '"', "'", '/', '[', ','],
    provideCompletionItems(model, position, _context, token) {
      const snapshot = load(model, token);
      if (!snapshot) return { suggestions: [] };
      const offset = model.getOffsetAt(position);
      const values = includeCompletions(snapshot, model, position, offset) ?? language.getCompletions(snapshot.project, snapshot.uri, offset);
      if (cancelled(model, token, snapshot.version)) return { suggestions: [] };
      return { suggestions: values.map(value => completionItem(monaco, model, value, offset)) };
    },
  }));
  providers.push(monaco.languages.registerHoverProvider(languageId, {
    provideHover(model, position, token) {
      const snapshot = load(model, token);
      if (!snapshot) return null;
      const result = language.getHover(snapshot.project, snapshot.uri, model.getOffsetAt(position));
      if (!result || cancelled(model, token, snapshot.version)) return null;
      return { contents: [markdown(result.contents)], range: modelRange(model, result.range) };
    },
  }));
  providers.push(monaco.languages.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [',', ' '],
    provideSignatureHelp(model, position, token) {
      const snapshot = load(model, token);
      if (!snapshot) return null;
      const result = language.getSignatureHelp(snapshot.project, snapshot.uri, model.getOffsetAt(position));
      if (!result || cancelled(model, token, snapshot.version)) return null;
      return {
        value: {
          signatures: [{ label: result.label, parameters: result.parameters.map(parameter => ({ label: parameter.label, ...(parameter.documentation ? { documentation: markdown(parameter.documentation) } : {}) })) }],
          activeSignature: 0,
          activeParameter: Math.max(0, Math.min(result.activeParameter, result.parameters.length - 1)),
        },
        dispose() {},
      };
    },
  }));
  providers.push(monaco.languages.registerDefinitionProvider(languageId, {
    provideDefinition(model, position, token) {
      const snapshot = load(model, token);
      if (!snapshot) return null;
      const offset = model.getOffsetAt(position);
      const document = snapshot.project.documents.get(snapshot.uri);
      if (isOpaque(document, offset)) return null;
      const include = document.includes.find(value => value.start <= offset && offset <= value.end);
      let target;
      if (include) {
        // Browser runtime resolves includes from the current source directory.
        const directory = snapshot.path.split('/').slice(0, -1);
        const targetUri = model.uri.with({ path: `/${[...directory, include.path].join('/')}` }).toString();
        if (snapshot.project.documents.has(targetUri)) target = { uri: targetUri, start: 0, end: 0 };
      } else target = language.getDefinition(snapshot.project, snapshot.uri, offset);
      if (!target || cancelled(model, token, snapshot.version)) return null;
      const targetDocument = snapshot.project.documents.get(target.uri);
      if (!targetDocument) return null;
      return { uri: monaco.Uri.parse(target.uri), range: textRange(targetDocument.text, target.start, target.end) };
    },
  }));
  }
  let disposed = false;
  const disposable = { dispose() {
    if (disposed) return;
    disposed = true; providers.forEach(provider => provider.dispose()); cache = new WeakMap(); registrations.delete(monaco);
  } };
  registrations.set(monaco, { disposable, update(callback, dialectCallback) { readFiles = callback; readDialect = dialectCallback; cache = new WeakMap(); } });
  return disposable;
}
