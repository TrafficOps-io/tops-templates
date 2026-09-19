// @ts-check
import { imageDimensions } from './image-dimensions.js';
import { parseProject, generateProject, getDefaults, validateValues } from '@trafficops/template-runtime';
import { runOperation, ValidationError } from '@trafficops/template-editor-core';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldsOf = definition => definition.sections.flatMap(section => section.fields);
export function knownValues(fields, values = {}) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(values, field.name)).map(field => {
    const value = values[field.name];
    return [field.name, field.type === 'group' && object(value) ? knownValues(field.fields, value)
      : field.type === 'repeater' && Array.isArray(value) ? value.map(row => object(row) ? knownValues(field.fields, row) : row) : value];
  }));
}
const relaxed = field => ({ ...field, required: false, ...(field.fields ? { fields: field.fields.map(relaxed) } : {}) });
export function studioDiagnostics(project, translations) {
  const errors = [];
  function visit(fields, values, prefix, section, locale) {
    for (const field of fields) {
      const path = prefix + field.name;
      const value = values?.[field.name] ?? getDefaults({ fields: [field] })[field.name];
      let test = field;
      if (field.fields && object(value) && field.type === 'group') {
        visit(field.fields, value, `${path}.`, section, locale); test = { ...field, fields: field.fields.map(relaxed) };
      } else if (field.fields && Array.isArray(value) && field.type === 'repeater') {
        value.forEach((row, index) => { if (object(row)) visit(field.fields, row, `${path}.${index}.`, section, locale); });
        test = { ...field, fields: field.fields.map(relaxed) };
      }
      try {
        validateValues({ fields: [test] }, knownValues([test], { [field.name]: value }));
        if (field.type === 'image' && value && typeof value === 'string' && !/^https?:\/\//i.test(value)) {
          const path = value.split(/[?#]/)[0];
          if (!Object.hasOwn(project.files, path)) throw Object.assign(new Error('The image is missing from this project.'), { code: 'image_missing' });
          if (field.sizes || field.aspect_ratio) {
            const size = imageDimensions(path, project.files[path]);
            if (!size || field.sizes && !field.sizes.some(preset => preset.width === size.width && preset.height === size.height)
              || field.aspect_ratio && Math.abs(size.width - size.height * field.aspect_ratio) > Math.max(1, field.aspect_ratio)) {
              throw Object.assign(new Error('Crop the image to the required size or aspect ratio.'), { code: 'image_dimensions' });
            }
          }
        }
      } catch (cause) {
        const blank = value === null || value === undefined || value === '' || Array.isArray(value) && value.length === 0;
        const code = cause.code || (blank && field.required ? 'required' : 'invalid_value');
        errors.push({ locale, section: section.id, sectionLabel: section.label, path, label: field.label || field.name, code,
          message: code === 'required' ? 'This field is required.' : cause.message });
      }
    }
  }
  for (const [locale, values] of Object.entries(translations)) for (const section of project.definition.sections) visit(section.fields, values, '', section, locale);
  return errors;
}
export function analyzeStudioProject(state) {
  try {
    const project = parseProject(state.files), pages = project.pages.map(page => page.entrypoint);
    const entrypoint = state.entrypoint || pages[0];
    if (!pages.includes(entrypoint)) throw new Error(`The entry page is missing: ${entrypoint}`);
    return { definition: project.definition, pages, entrypoint, diagnostics: studioDiagnostics(project, state.translations), sourceDiagnostics: [], previewAvailable: true };
  } catch (cause) {
    const match = /^(.+?):(?:(\d+):)?\s*(.*)$/.exec(cause.message);
    const file = cause.file || (match && Object.hasOwn(state.files, match[1]) ? match[1] : null);
    return { definition: null, pages: [], entrypoint: state.entrypoint, diagnostics: [],
      sourceDiagnostics: [{ file, line: cause.line || (file && match?.[2] ? Number(match[2]) : null), message: cause.message, code: 'source.invalid' }], previewAvailable: false };
  }
}
/** @returns {import('@trafficops/template-editor-core').AnalyzerPort} */
export function createStudioAnalyzer() {
  return {
    analyze(state, { signal } = {}) { return runOperation(signal, () => analyzeStudioProject(state), 'validation'); },
    render(state, { signal, locale }) {
      return runOperation(signal, () => {
        const project = parseProject(state.files);
        return generateProject(state.files, knownValues(fieldsOf(project.definition), state.translations[locale]), { locale }, { draft: true });
      }, 'validation');
    },
  };
}
export function assertStudioExport(state, locale) {
  const analysis = analyzeStudioProject(state);
  const diagnostics = analysis.diagnostics.filter(issue => issue.locale === locale);
  if (!analysis.definition || analysis.sourceDiagnostics.length || diagnostics.length) throw new ValidationError('Fix the project issues before exporting HTML.', { diagnostics, sourceDiagnostics: analysis.sourceDiagnostics });
  return { ...analysis, definition: analysis.definition };
}
