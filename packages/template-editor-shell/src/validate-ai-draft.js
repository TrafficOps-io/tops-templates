import { inputValues, ValidationError, validateProject } from '@trafficops/template-editor-core';

// The host's analyzer owns the dialect and validation policy, including AI edits.
export function createAiDraftValidator(analyzer, getState, getLocale) {
  return async ({ files, values = {}, mode = 'edit', signal, schemaOnly = false }) => {
    validateProject(files);
    const current = getState(), locale = getLocale?.() || current.locale;
    let state = { ...current, files, entrypoint: mode === 'create' ? null : current.entrypoint,
      translations: { ...current.translations, [locale]: values } };
    const schema = await analyzer.analyze(state, { signal });
    if (schemaOnly && (!schema.definition || schema.sourceDiagnostics.length)) throw new ValidationError(schema.sourceDiagnostics.map(issue => issue.message).join(' ') || 'Repair the template source before updating fields.', schema);
    if (schemaOnly) return { files, values: inputValues(schema.definition, values), definition: schema.definition };
    const nextValues = inputValues(schema.definition, values);
    state = { ...state, entrypoint: schema.entrypoint, translations: { [locale]: nextValues }, locale };
    const analysis = await analyzer.analyze(state, { signal });
    const errors = [...analysis.sourceDiagnostics, ...analysis.diagnostics];
    if (errors.length) throw new ValidationError(errors.map(issue => issue.message).join(' '), analysis);
    await analyzer.render(state, { locale, signal });
    return { files, values: nextValues, definition: schema.definition };
  };
}
