import { TPL_LANGUAGE_IDS, dialectId } from './dialect.js';

const registrations = new WeakMap();
let formatter;

// Load the same standalone formatter as the VS Code extension only when asked.
// It uses bundled Prettier plugins, never project configuration or executable
// plugins from an imported template archive.
async function formatDocument(source, options) {
  formatter ??= import('@trafficops/template-language/formatter').then(module => module.default);
  return (await formatter).formatDocument(source, options);
}

export function registerTplFormatting(monaco, { getDialect } = {}) {
  if (typeof getDialect !== 'function') throw new TypeError('getDialect must be a function');
  const existing = registrations.get(monaco);
  if (existing) { existing.update(getDialect); return existing.disposable; }
  let readDialect = getDialect, disposed = false;
  const providers = Object.values(TPL_LANGUAGE_IDS).map(id => monaco.languages.registerDocumentFormattingEditProvider(id, {
    displayName: 'TrafficOps TPL',
    async provideDocumentFormattingEdits(model, options, token) {
      const dialect = dialectId(readDialect(model));
      if (disposed || !dialect || token?.isCancellationRequested || model.isDisposed()) return [];
      const source = model.getValue(), version = model.getVersionId();
      const formatted = await formatDocument(source, {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
      });
      // Formatting may finish after the user types, switches files or cancels.
      // Never apply an old snapshot over newer edits.
      if (disposed || dialectId(readDialect(model)) !== dialect || token?.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version || formatted === source) return [];
      // Monaco's Format Document action applies this as one undoable edit.
      // Do not call setValue(), which would discard the model's undo history.
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  }));
  const registration = {
    dispose() {
      if (disposed) return;
      disposed = true;
      registrations.delete(monaco);
      providers.forEach(provider => provider.dispose());
    },
  };
  registrations.set(monaco, { disposable: registration, update(callback) { readDialect = callback; } });
  return registration;
}
