import { useStudioText } from './studio-i18n.js';
import ImageField from './ImageField.jsx';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { prepareRichTextValues } from './rich-text-value.js';

const RichTextEditor = lazy(() => import('./RichTextEditor.jsx'));

function defaults(fields = []) {
  return Object.fromEntries(fields.map(field => [field.name, field.default ?? (field.type === 'group' ? defaults(field.fields) : field.type === 'repeater' ? [] : field.type === 'checkbox' ? false : '')]));
}


function Field({ field, value, onChange, prefix = '', projectImages, onImageUpload, files, aiEnabled, onSettings, errors = [], disabled = false }) {
  const t = useStudioText();
  const id = `setting-${prefix}${field.name}`.replaceAll('.', '-');
  const children = field.fields || [];
  const fieldErrors = errors.filter(error => error.path === `${prefix}${field.name}`);
  const errorMessage = fieldErrors.length > 0 && <div id={`${id}-error`} className="inline-error" role="alert">{fieldErrors.map((error, index) => <p key={index}>{error.message}</p>)}</div>;
  const formatHelp = field.type === 'wysiwyg' ? t('Format text and insert images with the toolbar.')
    : field.type === 'markdown' ? t('Use the formatting toolbar or switch to Markdown source.') : null;
  const describedBy = [field.help || field.type === 'image' ? `${id}-help` : '', formatHelp ? `${id}-format-help` : '', fieldErrors.length ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  if (field.type === 'group') {
    return <fieldset className="field-group" id={id} tabIndex={-1} aria-invalid={fieldErrors.length > 0 || undefined} aria-describedby={describedBy}><legend>{field.label || field.name}</legend>{errorMessage}{children.map(child => <Field key={child.name} field={child} value={value?.[child.name]} prefix={`${prefix}${field.name}.`} projectImages={projectImages} onImageUpload={onImageUpload} files={files} aiEnabled={aiEnabled} onSettings={onSettings} errors={errors} disabled={disabled} onChange={next => onChange({ ...(value || {}), [child.name]: next })} />)}</fieldset>;
  }
  if (field.type === 'repeater') {
    const items = Array.isArray(value) ? value : [];
    return <fieldset className="field-group" id={id} tabIndex={-1} aria-invalid={fieldErrors.length > 0 || undefined} aria-describedby={describedBy}><legend>{field.label || field.name} <span className="count">{items.length}</span></legend>
      {field.help && <p className="field-help" id={`${id}-help`}>{field.help}</p>}{errorMessage}
      {items.map((item, index) => <div className="repeater-item" key={index}><div className="repeater-heading"><span>{t("Item")} {index + 1}</span><button type="button" className="btn btn-ghost btn-sm" aria-label={t("Remove {label} item {number}", { label: field.label, number: index + 1 })} disabled={items.length <= (field.min_items || 0)} onClick={() => onChange(items.filter((_, at) => at !== index))}><Trash2 size={13} /></button></div>{children.map(child => <Field key={child.name} field={child} value={item?.[child.name]} prefix={`${prefix}${field.name}.${index}.`} projectImages={projectImages} onImageUpload={onImageUpload} files={files} aiEnabled={aiEnabled} onSettings={onSettings} errors={errors} disabled={disabled} onChange={next => onChange(items.map((old, at) => at === index ? { ...old, [child.name]: next } : old))} />)}</div>)}
      <button type="button" className="btn btn-outline btn-sm w-full" disabled={items.length >= (field.max_items ?? 50)} onClick={() => onChange([...items, defaults(children)])}><Plus size={14} /> {t("Add item")}</button>
    </fieldset>;
  }
  const shared = { id, required: field.required, 'aria-describedby': describedBy, 'aria-invalid': fieldErrors.length > 0 || undefined };
  return <div className={`field ${field.type === 'checkbox' ? 'field-switch' : ''}`}>
    <label htmlFor={id}>{field.label || field.name}{field.required && <span className="required"> *</span>}</label>
    {field.type === 'checkbox' ? <input {...shared} type="checkbox" className="toggle toggle-sm toggle-primary" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
      : field.type === 'image' ? <ImageField id={id} field={field} value={value} onChange={onChange} projectImages={projectImages} onImageUpload={onImageUpload} files={files} aiEnabled={aiEnabled} onSettings={onSettings} errors={errors} />
      : field.type === 'select' ? <select {...shared} className="select select-bordered w-full" value={String(value ?? '')} onChange={event => onChange(event.target.value)}><option value="">{t("Choose…")}</option>{Object.entries(field.options || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      : ['markdown', 'wysiwyg'].includes(field.type) ? <Suspense fallback={<p className="field-help">{t('Loading editor…')}</p>}><RichTextEditor id={id} field={field} value={value} onChange={onChange} projectImages={projectImages} onImageUpload={onImageUpload} files={files} describedBy={describedBy} invalid={fieldErrors.length > 0} disabled={disabled} /></Suspense>
      : field.type === 'textarea' ? <textarea {...shared} className="textarea textarea-bordered w-full" rows={4} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />
      : field.type === 'color' ? <div className="color-input"><input type="color" aria-label={t("Choose {label}", { label: field.label })} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#e75d45'} onChange={event => onChange(event.target.value)} /><input {...shared} className="input input-bordered w-full" value={String(value ?? '')} onChange={event => onChange(event.target.value)} /></div>
      : <input {...shared} className="input input-bordered w-full" type={['number', 'range'].includes(field.type) ? 'number' : ['url', 'email'].includes(field.type) ? field.type : 'text'} min={field.min} max={field.max} step={field.step ?? 'any'} value={value ?? ''} placeholder={field.type === 'image' ? 'images/photo.jpg' : undefined} onChange={event => onChange(['number', 'range'].includes(field.type) && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}
    {errorMessage}
    {formatHelp && <p className="field-help" id={`${id}-format-help`}>{formatHelp}</p>}
    {formatHelp && typeof field.default === 'string' && value !== field.default && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(field.default)}><RotateCcw size={13} />{t('Use template default')}</button>}
    {(field.help || field.type === 'image') && <p className="field-help" id={`${id}-help`}>{field.help || t("Choose an image already in the project or add one from your computer.")}</p>}
  </div>;
}

export default function ParameterForm({ definition, values, onChange, projectImages = [], onImageUpload, files, aiEnabled, onSettings, errors = [], disabled = false, sectionTitles = true }) {
  const t = useStudioText();
  useEffect(() => {
    if (disabled) return;
    const next = prepareRichTextValues(definition.sections.flatMap(section => section.fields), values);
    if (next !== values) onChange(next);
  }, [definition, values, disabled, onChange]);
  return <div className="parameter-form">{definition.sections.map(section => <section className="parameter-section" key={section.id} aria-label={sectionTitles ? undefined : section.label}>{sectionTitles && <h3>{section.label}</h3>}{section.fields.map(field => <Field key={field.name} field={field} value={values[field.name]} projectImages={projectImages} onImageUpload={onImageUpload} files={files} aiEnabled={aiEnabled} onSettings={onSettings} errors={errors} disabled={disabled} onChange={next => onChange({ ...values, [field.name]: next })} />)}</section>)}{!definition.fields?.length && !definition.sections.some(section => section.fields.length) && <p className="muted">{t("Add @param declarations to build your form.")}</p>}</div>;
}
