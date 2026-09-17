import { TPL_LANGUAGE_ID } from './tpl-language.js';

const registrations = new WeakMap();
let formatter;

// Load the same standalone formatter as the VS Code extension only when asked.
// It uses bundled Prettier plugins, never project configuration or executable
// plugins from an imported template archive.
async function formatDocument(source, options) {
  formatter ??= import('tops-templates/src/formatter.js').then(module => module.default);
  return (await formatter).formatDocument(source, options);
}

export function registerTplFormatting(monaco) {
  if (registrations.has(monaco)) return registrations.get(monaco);
  const provider = monaco.languages.registerDocumentFormattingEditProvider(TPL_LANGUAGE_ID, {
    displayName: 'TrafficOps TPL',
    async provideDocumentFormattingEdits(model, options, token) {
      if (token?.isCancellationRequested || model.isDisposed()) return [];
      const source = model.getValue(), version = model.getVersionId();
      const formatted = await formatDocument(source, {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
      });
      // Formatting may finish after the user types, switches files or cancels.
      // Never apply an old snapshot over newer edits.
      if (token?.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version || formatted === source) return [];
      // Monaco's Format Document action applies this as one undoable edit.
      // Do not call setValue(), which would discard the model's undo history.
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
  const registration = {
    dispose() {
      if (registrations.get(monaco) !== registration) return;
      registrations.delete(monaco);
      provider.dispose();
    },
  };
  registrations.set(monaco, registration);
  return registration;
}
