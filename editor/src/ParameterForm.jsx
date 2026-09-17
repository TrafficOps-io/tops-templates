import { Plus, Trash2 } from 'lucide-react';

function defaults(fields = []) {
  return Object.fromEntries(fields.map(field => [field.name, field.default ?? (field.type === 'group' ? defaults(field.fields) : field.type === 'repeater' ? [] : field.type === 'checkbox' ? false : '')]));
}

function Field({ field, value, onChange, prefix = '' }) {
  const id = `setting-${prefix}${field.name}`;
  const children = field.fields || [];
  if (field.type === 'group') {
    return <fieldset className="field-group"><legend>{field.label || field.name}</legend>{children.map(child => <Field key={child.name} field={child} value={value?.[child.name]} prefix={`${prefix}${field.name}-`} onChange={next => onChange({ ...(value || {}), [child.name]: next })} />)}</fieldset>;
  }
  if (field.type === 'repeater') {
    const items = Array.isArray(value) ? value : [];
    return <fieldset className="field-group"><legend>{field.label || field.name} <span className="count">{items.length}</span></legend>
      {field.help && <p className="field-help">{field.help}</p>}
      {items.map((item, index) => <div className="repeater-item" key={index}><div className="repeater-heading"><span>Item {index + 1}</span><button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove ${field.label} item ${index + 1}`} disabled={items.length <= (field.min_items || 0)} onClick={() => onChange(items.filter((_, at) => at !== index))}><Trash2 size={13} /></button></div>{children.map(child => <Field key={child.name} field={child} value={item?.[child.name]} prefix={`${prefix}${field.name}-${index}-`} onChange={next => onChange(items.map((old, at) => at === index ? { ...old, [child.name]: next } : old))} />)}</div>)}
      <button type="button" className="btn btn-outline btn-sm w-full" disabled={items.length >= (field.max_items ?? 50)} onClick={() => onChange([...items, defaults(children)])}><Plus size={14} /> Add item</button>
    </fieldset>;
  }
  const shared = { id, required: field.required, 'aria-describedby': field.help || field.type === 'image' ? `${id}-help` : undefined };
  return <div className={`field ${field.type === 'checkbox' ? 'field-switch' : ''}`}>
    <label htmlFor={id}>{field.label || field.name}{field.required && <span className="required"> *</span>}</label>
    {field.type === 'checkbox' ? <input {...shared} type="checkbox" className="toggle toggle-sm toggle-primary" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
      : field.type === 'select' ? <select {...shared} className="select select-bordered w-full" value={String(value ?? '')} onChange={event => onChange(event.target.value)}><option value="">Choose…</option>{Object.entries(field.options || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      : ['textarea', 'markdown', 'wysiwyg'].includes(field.type) ? <textarea {...shared} className="textarea textarea-bordered w-full" rows={4} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />
      : field.type === 'color' ? <div className="color-input"><input type="color" aria-label={`Choose ${field.label}`} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#e75d45'} onChange={event => onChange(event.target.value)} /><input {...shared} className="input input-bordered w-full" value={String(value ?? '')} onChange={event => onChange(event.target.value)} /></div>
      : <input {...shared} className="input input-bordered w-full" type={['number', 'range'].includes(field.type) ? 'number' : ['url', 'email'].includes(field.type) ? field.type : 'text'} min={field.min} max={field.max} step={field.step ?? 'any'} value={value ?? ''} placeholder={field.type === 'image' ? 'images/photo.jpg' : undefined} onChange={event => onChange(['number', 'range'].includes(field.type) && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}
    {(field.help || field.type === 'image') && <p className="field-help" id={`${id}-help`}>{field.help || 'Use a path relative to this page. No image uploads or hosting.'}</p>}
  </div>;
}

export default function ParameterForm({ definition, values, onChange }) {
  return <div className="parameter-form">{definition.sections.map(section => <section className="parameter-section" key={section.id}><h3>{section.label}</h3>{section.fields.map(field => <Field key={field.name} field={field} value={values[field.name]} onChange={next => onChange({ ...values, [field.name]: next })} />)}</section>)}{!definition.fields?.length && !definition.sections.some(section => section.fields.length) && <p className="muted">Add @param declarations to build your form.</p>}</div>;
}
