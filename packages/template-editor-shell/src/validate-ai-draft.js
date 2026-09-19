import { inputValues, ValidationError, validateProject } from '@trafficops/template-editor-core';

// The host's analyzer owns the dialect and validation policy, including AI edits.
export function createAiDraftValidator(analyzer, getState, getLocale) {
  return async ({ files, values = {}, mode = 'edit', signal }) => {
    validateProject(files);
    const current = getState(), locale = getLocale?.() || current.locale;
    let state = { ...current, files, entrypoint: mode === 'create' ? null : current.entrypoint,
      translations: { ...current.translations, [locale]: mode === 'create' ? {} : values } };
    const schema = await analyzer.analyze(state, { signal });
    const nextValues = inputValues(schema.definition, mode === 'create' ? {} : values);
    state = { ...state, entrypoint: schema.entrypoint, translations: { [locale]: nextValues }, locale };
    const analysis = await analyzer.analyze(state, { signal });
    const errors = [...analysis.sourceDiagnostics, ...analysis.diagnostics];
    if (errors.length) throw new ValidationError(errors.map(issue => issue.message).join(' '), analysis);
    await analyzer.render(state, { locale, signal });
    return { files, values: nextValues };
  };
}
