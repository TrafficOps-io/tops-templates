import { inputValues, ValidationError, validateProject } from '@trafficops/template-editor-core';

const sameJson = (left, right) => { try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; } };

// The host's analyzer owns the dialect and validation policy, including AI edits.
// One analyzer pass per call: a second pass is only needed when the analyzer
// must see field defaults the draft values do not carry yet (in hosted mode each
// pass is an HTTP request with the whole project).
export function createAiDraftValidator(analyzer, getState, getLocale) {
  return async ({ files, values = {}, mode = 'edit', signal, schemaOnly = false }) => {
    validateProject(files);
    const current = getState(), locale = getLocale?.() || current.locale;
    // Only the edited locale matters: the definition and entrypoint do not depend on translations.
    let state = { ...current, files, entrypoint: mode === 'create' ? null : current.entrypoint, translations: { [locale]: values }, locale };
    const schema = await analyzer.analyze(state, { signal });
    if (schemaOnly && (!schema.definition || schema.sourceDiagnostics.length)) throw new ValidationError(schema.sourceDiagnostics.map(issue => issue.message).join(' ') || 'Repair the template source before updating fields.', schema);
    if (schemaOnly) return { files, values: inputValues(schema.definition, values), definition: schema.definition };
    const nextValues = schema.definition ? inputValues(schema.definition, values) : values;
    const firstEntrypoint = state.entrypoint;
    state = { ...state, entrypoint: schema.entrypoint, translations: { [locale]: nextValues } };
    // The first pass already analyzed exactly this state when the values carry
    // every default and the analyzer kept (or itself chose) the entrypoint; a
    // broken source has nothing more to analyze.
    const reusable = !schema.definition || sameJson(nextValues, values) && (firstEntrypoint == null || firstEntrypoint === schema.entrypoint);
    const analysis = reusable ? schema : await analyzer.analyze(state, { signal });
    const errors = [...analysis.sourceDiagnostics, ...analysis.diagnostics];
    if (errors.length) throw new ValidationError(errors.map(issue => issue.message).join(' '), analysis);
    await analyzer.render(state, { locale, signal });
    return { files, values: nextValues, definition: schema.definition };
  };
}
